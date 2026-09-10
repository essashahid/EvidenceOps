import { NonRetriableError, RetryAfterError } from "inngest";
import { documentProcessRequested, documentRetryRequested, evaluationRequested, inngest } from "./client";
import { RETRY_SCHEDULE_MS } from "@/lib/config";
import {
  buildStepContext,
  markDocumentOutcome,
  markRunRunning,
  stepChunk,
  stepConfidence,
  stepEmbed,
  stepExtract,
  stepFinalize,
  stepParse,
  stepRoute,
  stepValidate,
  stepVerify,
} from "@/lib/pipeline/process-document";
import { outcomeFor } from "@/lib/pipeline/orchestrate";
import { StepFailure } from "@/lib/pipeline/steps-runner";
import { logEvent } from "@/lib/pipeline/events";

/**
 * Durable per-document pipeline (spec section 34). Each pipeline step is both an Inngest step
 * (memoized inside the Inngest run) and a DB-backed run_steps row (memoized across runs). Retryable
 * failures throw RetryAfterError with the RETRY_DELAYS_MS schedule; exhausted or non-retryable
 * failures become NonRetriableError after the run_steps row has been dead-lettered.
 */
function translate(err: unknown, attempt: number): never {
  if (err instanceof StepFailure && err.retryable) {
    const delay = RETRY_SCHEDULE_MS[Math.min(attempt, RETRY_SCHEDULE_MS.length - 1)] ?? 2000;
    throw new RetryAfterError(err.message, delay);
  }
  if (err instanceof StepFailure) throw new NonRetriableError(err.message, { cause: err });
  throw err;
}

type StepRun = { run: (name: string, fn: () => Promise<unknown>) => Promise<unknown> };

async function processDocument(processingRunId: string, documentVersionId: string, step: StepRun, attempt: number) {
  await step.run("mark-running", () => markRunRunning(processingRunId));
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
    const validate = await guarded("deterministic_validate", () => stepValidate(ctx, extract.output));
    const verify = await guarded("independent_verify", () => stepVerify(ctx, extract.output, validate.output));
    const confidence = await guarded("calculate_confidence", () => stepConfidence(ctx, extract.output, validate.output, verify.output));
    const route = await guarded("route_review", () => stepRoute(ctx, extract.output, validate.output, verify.output, confidence.output, ctx.runType));
    try {
      await guarded("embed", () => stepEmbed(ctx));
    } catch (err) {
      if (err instanceof RetryAfterError) throw err;
      await step.run("embed-warn", () => logEvent(processingRunId, documentVersionId, "warn", "embed.dead_letter", `embedding failed: ${err instanceof Error ? err.message : String(err)}`, {}));
    }
    const outcome = outcomeFor(route.output);
    await guarded("finalize", () => stepFinalize(ctx, outcome));
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

async function failDocumentJob({ event, error }: { event: { data: { event: { data: { processingRunId: string; documentVersionId: string } } } }; error: Error }) {
  const { processingRunId, documentVersionId } = event.data.event.data;
  const ctx = await buildStepContext(processingRunId, documentVersionId);
  await logEvent(processingRunId, documentVersionId, "error", "job.exhausted", error.message, {});
  await markDocumentOutcome(ctx, "failed");
}

const retries = Math.min(20, RETRY_SCHEDULE_MS.length) as 0 | 1 | 2 | 3 | 4 | 5;

export const processDocumentFn = inngest.createFunction(
  { id: "process-document", triggers: [documentProcessRequested], retries, concurrency: { limit: 4 }, onFailure: failDocumentJob },
  async ({ event, step, attempt }) => processDocument(event.data.processingRunId, event.data.documentVersionId, step as unknown as StepRun, attempt),
);

export const retryDocumentFn = inngest.createFunction(
  { id: "retry-document", triggers: [documentRetryRequested], retries, concurrency: { limit: 4 }, onFailure: failDocumentJob },
  async ({ event, step, attempt }) => processDocument(event.data.processingRunId, event.data.documentVersionId, step as unknown as StepRun, attempt),
);

export const evaluationFn = inngest.createFunction(
  {
    id: "evaluate-corpus", triggers: [evaluationRequested], retries: 3, concurrency: { limit: 1 },
    onFailure: async ({ event, error }) => {
      const { getDb, schema } = await import("@/lib/db/client");
      const { eq } = await import("drizzle-orm");
      await getDb().update(schema.evalRuns).set({ status: "failed", errorMessage: error.message, completedAt: new Date() }).where(eq(schema.evalRuns.id, event.data.event.data.evalRunId));
    },
  },
  async ({ event, step }) => {
    const { runEvaluation } = await import("@/lib/eval/run");
    const checkpoint = <T>(name: string, fn: () => Promise<T>) => step.run(name, fn) as Promise<T>;
    const outcome = await runEvaluation({ ...event.data, checkpoint });
    if (event.data.processingRunId) await step.run("qa-report", async () => {
      const { generateQaReport } = await import("@/lib/report/qa-report");
      const report = await generateQaReport({ processingRunId: event.data.processingRunId!, evalRunId: outcome.evalRunId });
      if (report.status !== "generated") throw new Error(report.error ?? "QA report generation failed");
      return report;
    });
    return { evalRunId: outcome.evalRunId, passed: outcome.regression.passed };
  },
);

export const functions = [processDocumentFn, retryDocumentFn, evaluationFn];
