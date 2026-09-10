import { NonRetriableError, RetryAfterError } from "inngest";
import { documentProcessRequested, documentRetryRequested, inngest } from "./client";
import { RETRY_SCHEDULE_MS } from "@/lib/config";
import {
  buildStepContext,
  markDocumentOutcome,
  markRunRunning,
  stepChunk,
  stepEmbed,
  stepExtract,
  stepParse,
  stepScoreAndRoute,
  stepValidate,
  stepVerify,
} from "@/lib/pipeline/process-document";
import { outcomeFor } from "@/lib/pipeline/orchestrate";
import { StepFailure } from "@/lib/pipeline/steps-runner";
import { logEvent } from "@/lib/pipeline/events";

/**
 * Durable per-document pipeline. Each pipeline step is both an Inngest step (memoized inside the
 * Inngest run) and a DB-backed run_steps row (memoized across runs). Retryable failures throw
 * RetryAfterError with the 2 s / 8 s / 30 s schedule; exhausted or non-retryable failures become
 * NonRetriableError after the run_steps row has been dead-lettered.
 */
function translate(err: unknown, attempt: number): never {
  if (err instanceof StepFailure && err.retryable) {
    const delay = RETRY_SCHEDULE_MS[Math.min(attempt, RETRY_SCHEDULE_MS.length - 1)]!;
    throw new RetryAfterError(err.message, delay);
  }
  if (err instanceof StepFailure) throw new NonRetriableError(err.message, { cause: err });
  throw err;
}

type StepRun = { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> };

async function processDocument(processingRunId: string, documentVersionId: string, step: StepRun, attempt: number) {
  await markRunRunning(processingRunId);
  const ctx = await buildStepContext(processingRunId, documentVersionId);
  const guarded = <T>(name: string, fn: () => Promise<T>): Promise<T> =>
    step.run(name, async () => {
      try {
        return await fn();
      } catch (err) {
        translate(err, attempt);
      }
    }) as Promise<T>;
  try {
    const parse = await guarded("parse", () => stepParse(ctx));
    if (parse.output.status === "unsupported") {
      await step.run("finalize-unsupported", () => markDocumentOutcome(ctx, "unsupported"));
      return { outcome: "unsupported" };
    }
    await guarded("chunk", () => stepChunk(ctx));
    const extract = await guarded("extract", () => stepExtract(ctx));
    const validate = await guarded("validate", () => stepValidate(ctx, extract.output));
    const verify = await guarded("verify", () => stepVerify(ctx, extract.output, validate.output));
    const score = await guarded("score_and_route", () => stepScoreAndRoute(ctx, extract.output, validate.output, verify.output, ctx.runType));
    try {
      await guarded("embed", () => stepEmbed(ctx));
    } catch (err) {
      if (err instanceof RetryAfterError) throw err;
      await step.run("embed-warn", () => logEvent(processingRunId, documentVersionId, "warn", "embed.dead_letter", `embedding failed: ${err instanceof Error ? err.message : String(err)}`, {}));
    }
    const outcome = outcomeFor(score.output);
    await step.run("finalize", () => markDocumentOutcome(ctx, outcome));
    return { outcome };
  } catch (err) {
    if (err instanceof RetryAfterError) throw err;
    await step.run("finalize-failed", async () => {
      await logEvent(processingRunId, documentVersionId, "error", "document.failed", err instanceof Error ? err.message : String(err), {});
      await markDocumentOutcome(ctx, "failed");
    });
    return { outcome: "failed" };
  }
}

export const processDocumentFn = inngest.createFunction(
  { id: "process-document", triggers: [documentProcessRequested], retries: RETRY_SCHEDULE_MS.length, concurrency: { limit: 4 } },
  async ({ event, step, attempt }) => processDocument(event.data.processingRunId, event.data.documentVersionId, step as unknown as StepRun, attempt),
);

export const retryDocumentFn = inngest.createFunction(
  { id: "retry-document", triggers: [documentRetryRequested], retries: RETRY_SCHEDULE_MS.length, concurrency: { limit: 4 } },
  async ({ event, step, attempt }) => processDocument(event.data.processingRunId, event.data.documentVersionId, step as unknown as StepRun, attempt),
);

export const functions = [processDocumentFn, retryDocumentFn];
