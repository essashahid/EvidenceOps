import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

export async function getDashboardStats(workspaceId: string) {
  const db = getDb();
  const [docs] = await db.select({ n: count() }).from(schema.documents).where(eq(schema.documents.workspaceId, workspaceId));
  const [versions] = await db.select({ n: count() }).from(schema.documentVersions).where(eq(schema.documentVersions.workspaceId, workspaceId));
  const [openReview] = await db
    .select({ n: count() })
    .from(schema.reviewItems)
    .where(and(eq(schema.reviewItems.workspaceId, workspaceId), eq(schema.reviewItems.status, "open")));
  const runsByStatus = await db
    .select({ status: schema.processingRuns.status, n: count() })
    .from(schema.processingRuns)
    .where(eq(schema.processingRuns.workspaceId, workspaceId))
    .groupBy(schema.processingRuns.status);
  const [totals] = await db
    .select({
      cost: sum(schema.processingRuns.estimatedCostUsd),
      inputTokens: sum(schema.processingRuns.inputTokens),
      outputTokens: sum(schema.processingRuns.outputTokens),
      embeddingTokens: sum(schema.processingRuns.embeddingTokens),
    })
    .from(schema.processingRuns)
    .where(eq(schema.processingRuns.workspaceId, workspaceId));
  const [deadOpen] = await db
    .select({ n: count() })
    .from(schema.deadLetters)
    .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.deadLetters.processingRunId))
    .where(and(eq(schema.processingRuns.workspaceId, workspaceId), sql`${schema.deadLetters.status} <> 'resolved'`));

  const runs: Record<string, number> = {};
  let runsTotal = 0;
  for (const r of runsByStatus) {
    runs[r.status] = Number(r.n);
    runsTotal += Number(r.n);
  }
  return {
    documents: Number(docs?.n ?? 0),
    versions: Number(versions?.n ?? 0),
    openReviewItems: Number(openReview?.n ?? 0),
    runsByStatus: runs,
    runsTotal,
    deadLettersOpen: Number(deadOpen?.n ?? 0),
    costUsd: Number(totals?.cost ?? 0),
    inputTokens: Number(totals?.inputTokens ?? 0),
    outputTokens: Number(totals?.outputTokens ?? 0),
    embeddingTokens: Number(totals?.embeddingTokens ?? 0),
  };
}

export async function listRecentRuns(workspaceId: string, limit = 10) {
  return getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.workspaceId, workspaceId)).orderBy(desc(schema.processingRuns.createdAt)).limit(limit);
}
