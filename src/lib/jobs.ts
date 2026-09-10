import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getDb, schema } from "@/lib/db/client";
import { processDocumentInline, retryDocumentInline } from "@/lib/pipeline/orchestrate";
import { reopenStep } from "@/lib/pipeline/steps-runner";
import { maybeFinalizeRun } from "@/lib/pipeline/process-document";

/** Dispatch every document of a run to the configured job driver. */
export async function dispatchRun(processingRunId: string) {
  const [run] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`run ${processingRunId} not found`);
  const ids = run.configJson.documentVersionIds ?? [];
  if (ids.length === 0) {
    await maybeFinalizeRun(processingRunId);
    return { driver: env().JOB_DRIVER, dispatched: 0 };
  }
  if (env().JOB_DRIVER === "inline") {
    for (const id of ids) await processDocumentInline(processingRunId, id);
    await maybeFinalizeRun(processingRunId);
    return { driver: "inline" as const, dispatched: ids.length };
  }
  const { inngest } = await import("@/inngest/client");
  await inngest.send(ids.map((documentVersionId) => ({ name: "document.process.requested" as const, data: { processingRunId, documentVersionId } })));
  return { driver: "inngest" as const, dispatched: ids.length };
}

/** Admin action: retry a dead-lettered step (re-runs the document; completed steps are reused). */
export async function dispatchRetry(processingRunId: string, documentVersionId: string, stepName: string) {
  await reopenStep(processingRunId, documentVersionId, stepName);
  if (env().JOB_DRIVER === "inline") {
    const outcome = await retryDocumentInline(processingRunId, documentVersionId);
    return { driver: "inline" as const, outcome };
  }
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (run) {
    await db
      .update(schema.processingRuns)
      .set({ status: "running", completedAt: null, errorMessage: null, documentsFailed: Math.max(0, run.documentsFailed - 1) })
      .where(eq(schema.processingRuns.id, processingRunId));
  }
  const { inngest } = await import("@/inngest/client");
  await inngest.send({ name: "document.retry.requested", data: { processingRunId, documentVersionId } });
  return { driver: "inngest" as const, outcome: "queued" as const };
}
