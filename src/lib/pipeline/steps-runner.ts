import { and, eq, sql } from "drizzle-orm";
import { getDb, getSql, schema } from "@/lib/db/client";
import { PIPELINE_VERSION, CHUNKING, MAX_ATTEMPTS } from "@/lib/config";
import { logEvent } from "./events";

export class StepFailure extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StepFailure";
  }
}

export type StepContext = {
  processingRunId: string;
  workspaceId: string;
  documentVersionId: string;
  modelConfigHash: string;
  provider: string;
  injectFailure?: { step: string; attempts: number };
};

export function idempotencyKey(ctx: StepContext, stepName: string): string {
  if (stepName === "finalize") return `${ctx.processingRunId}:${ctx.documentVersionId}:finalize`;
  if (stepName === "chunk") return `${ctx.workspaceId}:${ctx.documentVersionId}:chunk:chunk-v1:${CHUNKING.targetTokens}:${CHUNKING.overlapTokens}`;
  if (stepName === "parse") return `${ctx.workspaceId}:${ctx.documentVersionId}:parse:parser-v1`;
  return `${ctx.workspaceId}:${ctx.documentVersionId}:${stepName}:${PIPELINE_VERSION}:${ctx.modelConfigHash}`;
}

/**
 * Execute a durable step exactly once per idempotency key. If a succeeded run_steps row
 * already exists for the key (from any previous run of the same version+pipeline+model config),
 * the stored output is returned and the body is not executed. Failures are recorded with attempt
 * counts; the caller (Inngest or the inline runner) decides whether to retry.
 */
async function runStepUnlocked<T>(ctx: StepContext, stepName: string, body: () => Promise<T>): Promise<{ output: T; reused: boolean }> {
  const db = getDb();
  const key = idempotencyKey(ctx, stepName);
  const [existing] = await db.select().from(schema.runSteps).where(eq(schema.runSteps.idempotencyKey, key)).limit(1);
  if (existing?.status === "succeeded") {
    if (existing.processingRunId !== ctx.processingRunId) {
      await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "step.reused", `${stepName}: reused output from run ${existing.processingRunId}`, { stepName, key });
    }
    return { output: existing.outputJson as T, reused: true };
  }
  const started = Date.now();
  const attempt = (existing?.attemptCount ?? 0) + 1;
  if (existing) {
    await db
      .update(schema.runSteps)
      .set({ status: "running", attemptCount: attempt, startedAt: new Date(), processingRunId: ctx.processingRunId, errorCode: null, errorMessage: null })
      .where(eq(schema.runSteps.id, existing.id));
  } else {
    await db.insert(schema.runSteps).values({
      processingRunId: ctx.processingRunId,
      documentVersionId: ctx.documentVersionId,
      stepName,
      idempotencyKey: key,
      status: "running",
      attemptCount: attempt,
      startedAt: new Date(),
    });
  }
  await db.update(schema.processingRuns).set({ currentStep: stepName }).where(eq(schema.processingRuns.id, ctx.processingRunId));
  if (attempt > 1) {
    await db.update(schema.processingRuns).set({ retries: sql`${schema.processingRuns.retries} + 1` }).where(eq(schema.processingRuns.id, ctx.processingRunId));
  }
  await logEvent(ctx.processingRunId, ctx.documentVersionId, "debug", "step.started", `${stepName}: attempt ${attempt}`, { stepName, attempt });

  try {
    if (ctx.injectFailure && ctx.injectFailure.step === stepName && attempt <= ctx.injectFailure.attempts) {
      throw new StepFailure(`injected failure on ${stepName} attempt ${attempt}`, "injected_failure", true);
    }
    const output = await body();
    await db
      .update(schema.runSteps)
      .set({ status: "succeeded", completedAt: new Date(), latencyMs: Date.now() - started, outputJson: output as unknown as object, errorCode: null, errorMessage: null })
      .where(eq(schema.runSteps.idempotencyKey, key));
    await db.update(schema.deadLetters).set({ status: "resolved", resolvedAt: new Date() }).where(and(eq(schema.deadLetters.documentVersionId, ctx.documentVersionId), eq(schema.deadLetters.failedStep, stepName), eq(schema.deadLetters.status, "retrying")));
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "step.succeeded", `${stepName}: succeeded in ${Date.now() - started} ms`, { stepName, attempt, latencyMs: Date.now() - started });
    return { output, reused: false };
  } catch (err) {
    const failure = err instanceof StepFailure ? err : new StepFailure(err instanceof Error ? err.message : String(err), (err as { code?: string })?.code ?? "step_error", isRetryable(err));
    const exhausted = attempt >= MAX_ATTEMPTS || !failure.retryable;
    await db
      .update(schema.runSteps)
      .set({ status: exhausted ? "dead_letter" : "failed", completedAt: new Date(), latencyMs: Date.now() - started, errorCode: failure.code, errorMessage: failure.message })
      .where(eq(schema.runSteps.idempotencyKey, key));
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "error", "step.failed", `${stepName}: ${failure.message}`, { stepName, attempt, code: failure.code, retryable: failure.retryable, exhausted });
    if (exhausted) {
      await db.insert(schema.deadLetters).values({
        processingRunId: ctx.processingRunId,
        documentVersionId: ctx.documentVersionId,
        failedStep: stepName,
        errorCode: failure.code,
        errorMessage: failure.message,
        attemptCount: attempt,
        retryable: failure.retryable,
        status: "open",
      });
      throw new StepFailure(failure.message, failure.code, false);
    }
    throw failure;
  }
}

function isRetryable(err: unknown): boolean {
  if (err && typeof err === "object" && "retryable" in err) return Boolean((err as { retryable: boolean }).retryable);
  return true;
}

/** Reset a dead-lettered step so it can be retried by hand. */
export async function reopenStep(processingRunId: string, documentVersionId: string, stepName: string) {
  const db = getDb();
  await db
    .update(schema.runSteps)
    .set({ status: "failed" })
    .where(and(eq(schema.runSteps.processingRunId, processingRunId), eq(schema.runSteps.documentVersionId, documentVersionId), eq(schema.runSteps.stepName, stepName)));
  await db
    .update(schema.deadLetters)
    .set({ status: "retrying" })
    .where(and(eq(schema.deadLetters.processingRunId, processingRunId), eq(schema.deadLetters.documentVersionId, documentVersionId), eq(schema.deadLetters.failedStep, stepName)));
}

/** A session advisory lock prevents simultaneous deliveries from repeating paid work. */
export async function runStep<T>(ctx: StepContext, stepName: string, body: () => Promise<T>): Promise<{ output: T; reused: boolean }> {
  const connection = await getSql().reserve();
  const key = idempotencyKey(ctx, stepName);
  try {
    await connection`select pg_advisory_lock(hashtextextended(${key}, 0))`;
    return await runStepUnlocked(ctx, stepName, body);
  } finally {
    try { await connection`select pg_advisory_unlock(hashtextextended(${key}, 0))`; } finally { connection.release(); }
  }
}
