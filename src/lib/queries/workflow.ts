import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

/**
 * The handful of numbers that say where a workspace is in the upload → extract →
 * review → ask → evaluate flow. Cheap enough to sit on every dashboard load.
 */
export type WorkflowSnapshot = {
  documents: number;
  versions: number;
  versionsProcessing: number;
  versionsCompleted: number;
  versionsFailed: number;
  openReview: number;
  resolvedReview: number;
  firstOpenReviewId: string | null;
  questions: number;
  evalRuns: number;
  latestEval: { id: string; status: string; regressionPassed: boolean | null } | null;
  activeRun: { id: string; status: string } | null;
};

export async function getWorkflowSnapshot(workspaceId: string): Promise<WorkflowSnapshot> {
  const db = getDb();
  const [docs, versionsByStatus, reviewByStatus, firstOpen, questions, evals, latestEval, activeRun] = await Promise.all([
    db.select({ n: count() }).from(schema.documents).where(eq(schema.documents.workspaceId, workspaceId)),
    db
      .select({ status: schema.documentVersions.processingStatus, n: count() })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.workspaceId, workspaceId))
      .groupBy(schema.documentVersions.processingStatus),
    db
      .select({ status: schema.reviewItems.status, n: count() })
      .from(schema.reviewItems)
      .where(eq(schema.reviewItems.workspaceId, workspaceId))
      .groupBy(schema.reviewItems.status),
    db
      .select({ id: schema.reviewItems.id })
      .from(schema.reviewItems)
      .where(and(eq(schema.reviewItems.workspaceId, workspaceId), eq(schema.reviewItems.status, "open")))
      .orderBy(sql`case when ${schema.reviewItems.priority} = 'high' then 0 else 1 end`, desc(schema.reviewItems.createdAt))
      .limit(1),
    db.select({ n: count() }).from(schema.ragQueries).where(eq(schema.ragQueries.workspaceId, workspaceId)),
    db.select({ n: count() }).from(schema.evalRuns).where(eq(schema.evalRuns.workspaceId, workspaceId)),
    db
      .select({ id: schema.evalRuns.id, status: schema.evalRuns.status, regressionPassed: schema.evalRuns.regressionPassed })
      .from(schema.evalRuns)
      .where(eq(schema.evalRuns.workspaceId, workspaceId))
      .orderBy(desc(schema.evalRuns.startedAt))
      .limit(1),
    db
      .select({ id: schema.processingRuns.id, status: schema.processingRuns.status })
      .from(schema.processingRuns)
      .where(and(eq(schema.processingRuns.workspaceId, workspaceId), inArray(schema.processingRuns.status, ["queued", "running"])))
      .orderBy(desc(schema.processingRuns.createdAt))
      .limit(1),
  ]);

  const v: Record<string, number> = {};
  let versions = 0;
  for (const row of versionsByStatus) {
    v[row.status] = Number(row.n);
    versions += Number(row.n);
  }
  const r: Record<string, number> = {};
  for (const row of reviewByStatus) r[row.status] = Number(row.n);

  return {
    documents: Number(docs[0]?.n ?? 0),
    versions,
    versionsProcessing: (v.queued ?? 0) + (v.processing ?? 0),
    versionsCompleted: (v.completed ?? 0) + (v.completed_with_review ?? 0),
    versionsFailed: (v.failed ?? 0) + (v.unsupported ?? 0),
    openReview: (r.open ?? 0) + (r.needs_source ?? 0),
    resolvedReview: (r.resolved ?? 0) + (r.rejected ?? 0),
    firstOpenReviewId: firstOpen[0]?.id ?? null,
    questions: Number(questions[0]?.n ?? 0),
    evalRuns: Number(evals[0]?.n ?? 0),
    latestEval: latestEval[0] ?? null,
    activeRun: activeRun[0] ?? null,
  };
}
