"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runEvaluation } from "@/lib/eval/run";
import { latestCorpusRun } from "@/lib/eval/corpus";
import { generateQaReport } from "@/lib/report/qa-report";
import { getEvalRun } from "@/lib/queries/evals";
import { isAdmin, requireWorkspace } from "@/lib/workspace";

/** Runs the whole golden suite inline (slow) and lands on the new eval run page. */
export async function runEvaluationAction(): Promise<void> {
  const { user, workspace } = await requireWorkspace();
  if (!isAdmin(workspace.role)) redirect(`/evals?error=${encodeURIComponent("Only admins can run evaluations.")}`);
  let evalRunId: string;
  try {
    const corpusRun = await latestCorpusRun(workspace.workspaceId);
    const outcome = await runEvaluation({ workspaceId: workspace.workspaceId, userId: user.id, processingRunId: corpusRun?.id ?? null, log: (m) => console.log(`[eval] ${m}`) });
    evalRunId = outcome.evalRunId;
  } catch (err) {
    redirect(`/evals?error=${encodeURIComponent(err instanceof Error ? err.message : String(err))}`);
  }
  revalidatePath("/evals");
  revalidatePath("/");
  redirect(`/evals/${evalRunId}`);
}

/** Generate the QA report for an eval run's processing run (or the latest corpus run) and open it. */
export async function generateEvalReportAction(formData: FormData): Promise<void> {
  const { workspace } = await requireWorkspace();
  const evalRunId = String(formData.get("evalRunId") ?? "");
  const back = `/evals/${evalRunId}`;
  if (!isAdmin(workspace.role)) redirect(`${back}?error=${encodeURIComponent("Only admins can generate QA reports.")}`);
  const evalRun = await getEvalRun(workspace.workspaceId, evalRunId);
  if (!evalRun) redirect(`/evals?error=${encodeURIComponent("Eval run not found.")}`);
  const processingRunId = evalRun.processingRunId ?? (await latestCorpusRun(workspace.workspaceId))?.id ?? null;
  if (!processingRunId) redirect(`${back}?error=${encodeURIComponent("No processing run is available to report on. Ingest the corpus first.")}`);
  const result = await generateQaReport({ processingRunId, evalRunId });
  revalidatePath(back);
  revalidatePath(`/runs/${processingRunId}`);
  if (result.status !== "generated") redirect(`${back}?error=${encodeURIComponent(`Report generation failed: ${result.error ?? "unknown error"}`)}`);
  redirect(`/reports/${result.reportId}`);
}
