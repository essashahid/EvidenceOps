import { RETRY_SCHEDULE_MS } from "@/lib/config";
import {
  buildStepContext,
  markDocumentOutcome,
  markRunRunning,
  maybeFinalizeRun,
  stepChunk,
  stepConfidence,
  stepEmbed,
  stepExtract,
  stepFinalize,
  stepParse,
  stepRoute,
  stepValidate,
  stepVerify,
  type RouteStepOutput,
} from "./process-document";
import { StepFailure, type StepContext } from "./steps-runner";
import { logEvent } from "./events";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export type Sleeper = (ms: number) => Promise<void>;
const realSleep: Sleeper = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry wrapper for the inline runner: RETRY_DELAYS_MS between attempts (2 s, 8 s, 30 s by default). */
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
 * failure resumes from the earliest incomplete step without re-parsing or re-paying for model calls.
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
    const confidence = await withRetries(() => stepConfidence(ctx, extract.output, validate.output, verify.output), sleep);
    const route = await withRetries(() => stepRoute(ctx, extract.output, validate.output, verify.output, confidence.output, ctx.runType), sleep);
    await embedOrWarn(ctx, sleep);
    const outcome = outcomeFor(route.output);
    await withRetries(() => stepFinalize(ctx, outcome), sleep);
    await maybeFinalizeRun(processingRunId);
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
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "warn", "embed.dead_letter", `embedding failed; the version is excluded from retrieval until the step is retried: ${err instanceof Error ? err.message : String(err)}`, {});
  }
}

export function outcomeFor(route: RouteStepOutput): "completed" | "completed_with_review" {
  return route.review + route.blocked > 0 ? "completed_with_review" : "completed";
}

export async function runProcessingRunInline(processingRunId: string, opts: { sleep?: Sleeper } = {}) {
  const [run] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`run ${processingRunId} not found`);
  const ids = run.configJson.documentVersionIds ?? [];
  const outcomes: Record<string, DocumentOutcome> = {};
  for (const id of ids) outcomes[id] = await processDocumentInline(processingRunId, id, opts);
  const finalRun = await maybeFinalizeRun(processingRunId);
  return { run: finalRun, outcomes };
}

/** Retry a dead-lettered step by re-running the document; every succeeded step is reused. */
export async function retryDocumentInline(processingRunId: string, documentVersionId: string, opts: { sleep?: Sleeper } = {}) {
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`run ${processingRunId} not found`);
  await db
    .update(schema.processingRuns)
    .set({ status: "running", completedAt: null, errorMessage: null, documentsFailed: Math.max(0, run.documentsFailed - 1) })
    .where(eq(schema.processingRuns.id, processingRunId));
  return processDocumentInline(processingRunId, documentVersionId, opts);
}
