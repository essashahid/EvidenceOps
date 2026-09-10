"use server";

import { revalidatePath } from "next/cache";
import { dispatchRetry } from "@/lib/jobs";
import { getRun } from "@/lib/queries/runs";
import { latestCompletedEvalRun } from "@/lib/queries/evals";
import { generateQaReport } from "@/lib/report/qa-report";
import { isAdmin, requireWorkspace } from "@/lib/workspace";

export type RetryState = { ok: boolean; message: string } | null;

export async function retryDeadLetterAction(_prev: RetryState, formData: FormData): Promise<RetryState> {
  const { workspace } = await requireWorkspace();
  if (!isAdmin(workspace.role)) return { ok: false, message: "Only admins can retry failed steps." };
  const runId = String(formData.get("runId") ?? "");
  const documentVersionId = String(formData.get("documentVersionId") ?? "");
  const failedStep = String(formData.get("failedStep") ?? "");
  if (!runId || !documentVersionId || !failedStep) return { ok: false, message: "Missing retry parameters." };
  const run = await getRun(workspace.workspaceId, runId);
  if (!run) return { ok: false, message: "Run not found in this workspace." };
  try {
    const result = await dispatchRetry(runId, documentVersionId, failedStep);
    revalidatePath(`/runs/${runId}`);
    revalidatePath("/runs");
    revalidatePath("/");
    return { ok: true, message: result.driver === "inline" ? `retry finished: ${result.outcome}` : "retry queued" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Generate the QA report for this run, attaching the workspace's latest completed eval run when one exists. */
export async function generateRunReportAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const runId = String(formData.get("runId") ?? "");
  if (!runId) return;
  if (!isAdmin(workspace.role)) return;
  const run = await getRun(workspace.workspaceId, runId);
  if (!run) return;
  const evalRun = await latestCompletedEvalRun(workspace.workspaceId);
  await generateQaReport({ processingRunId: run.id, evalRunId: evalRun?.id ?? null });
  revalidatePath(`/runs/${runId}`);
}
