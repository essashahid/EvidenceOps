import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth/session";
import { getWorkspaceForUser } from "@/lib/workspace";
import { getRun, listRunDocuments, listRunSteps } from "@/lib/queries/runs";
import { DOCUMENT_STEPS } from "@/lib/pipeline/process-document";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same resolution as requireWorkspace, minus the redirect: a route answers 401 instead. */
async function resolveWorkspaceId(): Promise<string | null> {
  const user = await getCurrentUser();
  if (user) return (await getWorkspaceForUser(user.id))?.workspaceId ?? null;
  if (env().PUBLIC_DEMO_MODE) {
    const [ws] = await getDb().select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.slug, "default")).limit(1);
    return ws?.id ?? null;
  }
  return null;
}

/** Per-document step state for a run, shaped for the live progress panel. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  // A malformed id is a 404, not a database error surfacing as a 500.
  if (!UUID.test(runId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const workspaceId = await resolveWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const run = await getRun(workspaceId, runId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const versionIds = run.configJson.documentVersionIds ?? [];
  const [docs, steps] = await Promise.all([listRunDocuments(workspaceId, versionIds), listRunSteps(run.id)]);

  // Steps arrive oldest first, so a retried step's later row wins.
  const latest = new Map<string, Map<string, string>>();
  for (const s of steps) {
    if (!s.documentVersionId) continue;
    const m = latest.get(s.documentVersionId) ?? new Map<string, string>();
    m.set(s.stepName, s.status);
    latest.set(s.documentVersionId, m);
  }

  const documents = docs.map((d) => {
    const m = latest.get(d.version.id) ?? new Map<string, string>();
    const stepList = DOCUMENT_STEPS.map((name) => ({ name, status: m.get(name) ?? "pending" }));
    const succeeded = stepList.filter((s) => s.status === "succeeded" || s.status === "skipped").length;
    const failed = stepList.some((s) => s.status === "failed" || s.status === "dead_letter");
    const currentStep = stepList.find((s) => s.status === "running")?.name ?? (failed ? null : (stepList.find((s) => s.status === "pending")?.name ?? null));
    return {
      versionId: d.version.id,
      documentId: d.document.id,
      logicalKey: d.document.logicalKey,
      displayName: d.document.displayName,
      versionNumber: d.version.versionNumber,
      processingStatus: d.version.processingStatus,
      steps: stepList,
      succeeded,
      failed,
      currentStep,
    };
  });

  return NextResponse.json(
    {
      id: run.id,
      status: run.status,
      documentsTotal: run.documentsTotal,
      documentsCompleted: run.documentsCompleted,
      documentsFailed: run.documentsFailed,
      reviewItemsCreated: run.reviewItemsCreated,
      retries: run.retries,
      totalSteps: DOCUMENT_STEPS.length,
      documents,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
