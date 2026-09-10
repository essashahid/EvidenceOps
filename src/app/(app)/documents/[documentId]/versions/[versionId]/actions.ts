"use server";
import { redirect } from "next/navigation";
import { assertMutation } from "@/lib/access";
import { requireWorkspace } from "@/lib/workspace";
import { getVersion } from "@/lib/queries/documents";
import { createProcessingRun } from "@/lib/pipeline/ingest";
import { dispatchRun } from "@/lib/jobs";
export async function reprocessVersionAction(data: FormData) {
  const context = await requireWorkspace();
  await assertMutation(context, "reprocess", ["admin"]);
  const version = await getVersion(context.workspace.workspaceId, String(data.get("versionId")));
  if (!version) throw new Error("Document version not found");
  const run = await createProcessingRun({ workspaceId: context.workspace.workspaceId, userId: context.user.id, runType: "reprocess", documentVersionIds: [version.version.id] });
  await dispatchRun(run.id);
  redirect(`/runs/${run.id}`);
}
