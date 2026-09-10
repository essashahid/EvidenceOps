import { RETRY_SCHEDULE_MS } from "@/lib/config";
import {
  buildStepContext,
  markDocumentOutcome,
  markRunRunning,
  maybeFinalizeRun,
  stepChunk,
  stepEmbed,
  stepExtract,
  stepParse,
  stepScoreAndRoute,
  stepValidate,
  stepVerify,
  type ScoreStepOutput,
} from "./process-document";
import { StepFailure, type StepContext } from "./steps-runner";
import { logEvent } from "./events";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export type Sleeper = (ms: number) => Promise<void>;
const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry wrapper for the inline runner: 2 s, 8 s, 30 s between attempts, then give up.
 * (The Inngest runner uses the same schedule via RetryAfterError.)
 */
async function withRetries<T>(fn: () => Promise<T>, sleep: Sleeper): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof StepFailure ? err.retryable : true;
      const delay = RETRY_SCHEDULE_MS[attempt];
      if (!retryable || delay === undefined) throw err;
      attempt++;
      await sleep(delay);
    }
  }
}

export type DocumentOutcome = "completed" | "completed_with_review" | "failed" | "unsupported";

/**
 * Process one document version through every durable step, sequentially, with retries.
 * Steps that already succeeded for the same idempotency key are reused, so a re-run after a
 * failure resumes from the last incomplete step without re-parsing or re-paying for LLM calls.
 */
export async function processDocumentInline(processingRunId: string, documentVersionId: string, opts: { sleep?: Sleeper } = {}): Promise<DocumentOutcome> {
  const sleep = opts.sleep ?? realSleep;
  await markRunRunning(processingRunId);
  const ctx = await buildStepContext(processingRunId, documentVersionId);
  try {
    const parse = await withRetries(() => stepParse(ctx), sleep);
    if (parse.output.status === "unsupported") {
      await markDocumentOutcome(ctx, "unsupported");
      return "unsupported";
    }
    await withRetries(() => stepChunk(ctx), sleep);
    const extract = await withRetries(() => stepExtract(ctx), sleep);
    const validate = await withRetries(() => stepValidate(ctx, extract.output), sleep);
    const verify = await withRetries(() => stepVerify(ctx, extract.output, validate.output), sleep);
    const score = await withRetries(() => stepScoreAndRoute(ctx, extract.output, validate.output, verify.output, ctx.runType), sleep);
    await embedOrWarn(ctx, sleep);
    const outcome = outcomeFor(score.output);
    await markDocumentOutcome(ctx, outcome);
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent(processingRunId, documentVersionId, "error", "document.failed", message, { code: (err as { code?: string })?.code ?? "error" });
    await markDocumentOutcome(ctx, "failed");
    return "failed";
  }
}

export async function embedOrWarn(ctx: StepContext, sleep: Sleeper) {
  try {
    await withRetries(() => stepEmbed(ctx), sleep);
  } catch (err) {
    // Extraction remains usable; RAG is disabled for this version until the embed step is retried.
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "warn", "embed.dead_letter", `embedding failed; document is searchable only after retry: ${err instanceof Error ? err.message : String(err)}`, {});
  }
}

export function outcomeFor(score: ScoreStepOutput): DocumentOutcome {
  return score.review + score.blocked > 0 ? "completed_with_review" : "completed";
}

/** Process every document version attached to a run, in order. */
export async function runProcessingRunInline(processingRunId: string, opts: { sleep?: Sleeper } = {}) {
  const [run] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`run ${processingRunId} not found`);
  const ids = run.configJson.documentVersionIds ?? [];
  const outcomes: Record<string, DocumentOutcome> = {};
  for (const id of ids) outcomes[id] = await processDocumentInline(processingRunId, id, opts);
  const finalRun = await maybeFinalizeRun(processingRunId);
  return { run: finalRun, outcomes };
}

/**
 * Retry a dead-lettered step for one document by re-running the whole document pipeline;
 * every step that already succeeded is reused, so only the failed step (and those after it) execute.
 */
export async function retryDocumentInline(processingRunId: string, documentVersionId: string, opts: { sleep?: Sleeper } = {}) {
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`run ${processingRunId} not found`);
  // Reopen the run so the document can be counted again.
  await db
    .update(schema.processingRuns)
    .set({ status: "running", completedAt: null, errorMessage: null, documentsFailed: Math.max(0, run.documentsFailed - 1) })
    .where(eq(schema.processingRuns.id, processingRunId));
  const outcome = await processDocumentInline(processingRunId, documentVersionId, opts);
  return outcome;
}
