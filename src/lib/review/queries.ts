import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { excerpt } from "@/lib/text";
import { fieldLabel } from "@/lib/schema/report";

export type ReviewFilters = { priority?: "normal" | "high"; status?: "open" | "resolved" | "rejected" | "needs_source" | "superseded" | "all"; documentVersionId?: string; fieldPath?: string; minConfidence?: number; maxConfidence?: number };

export async function listReviewItems(workspaceId: string, filters: ReviewFilters = {}) {
  const db = getDb();
  const conds = [eq(schema.reviewItems.workspaceId, workspaceId)];
  if (filters.status && filters.status !== "all") conds.push(eq(schema.reviewItems.status, filters.status));
  if (filters.priority) conds.push(eq(schema.reviewItems.priority, filters.priority));
  if (filters.documentVersionId) conds.push(eq(schema.reviewItems.documentVersionId, filters.documentVersionId));
  if (filters.fieldPath) {
    const pattern = filters.fieldPath.includes("%") ? filters.fieldPath : `${filters.fieldPath.replace(/\[\d+\]$/, "")}%`;
    conds.push(sql`${schema.reviewItems.fieldPath} like ${pattern}`);
  }
  if (filters.minConfidence !== undefined) conds.push(sql`${schema.fieldValues.confidence} >= ${filters.minConfidence}`);
  if (filters.maxConfidence !== undefined) conds.push(sql`${schema.fieldValues.confidence} < ${filters.maxConfidence}`);
  const rows = await db
    .select({
      item: schema.reviewItems,
      field: schema.fieldValues,
      version: { id: schema.documentVersions.id, versionNumber: schema.documentVersions.versionNumber, sourceFilename: schema.documentVersions.sourceFilename },
      document: {
        id: schema.documents.id,
        // Prefer the extracted report title so the queue names documents the way the rest of the app does.
        displayName: sql<string>`coalesce(${schema.recordVersions.payloadJson}->>'report_title', ${schema.documents.displayName})`,
        logicalKey: schema.documents.logicalKey,
      },
    })
    .from(schema.reviewItems)
    .innerJoin(schema.fieldValues, eq(schema.fieldValues.id, schema.reviewItems.fieldValueId))
    .innerJoin(schema.recordVersions, eq(schema.recordVersions.id, schema.reviewItems.recordVersionId))
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.reviewItems.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(...conds))
    .orderBy(sql`case when ${schema.reviewItems.priority} = 'high' then 0 else 1 end`, desc(schema.reviewItems.createdAt));
  return rows.map((r) => ({ ...r, fieldLabel: fieldLabel(r.item.fieldPath) }));
}

export async function reviewCounts(workspaceId: string) {
  const db = getDb();
  const rows = await db
    .select({ status: schema.reviewItems.status, n: sql<number>`count(*)::int` })
    .from(schema.reviewItems)
    .where(eq(schema.reviewItems.workspaceId, workspaceId))
    .groupBy(schema.reviewItems.status);
  const out: Record<string, number> = { open: 0, resolved: 0, rejected: 0, needs_source: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Everything the reviewer screen needs for one item: candidate, components, evidence, context, source. */
export async function getReviewItemDetail(workspaceId: string, reviewItemId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      item: schema.reviewItems,
      field: schema.fieldValues,
      version: schema.documentVersions,
      document: schema.documents,
      record: schema.recordVersions,
      documentTitle: sql<string>`coalesce(${schema.recordVersions.payloadJson}->>'report_title', ${schema.documents.displayName})`,
    })
    .from(schema.reviewItems)
    .innerJoin(schema.fieldValues, eq(schema.fieldValues.id, schema.reviewItems.fieldValueId))
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.reviewItems.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .innerJoin(schema.recordVersions, eq(schema.recordVersions.id, schema.reviewItems.recordVersionId))
    .where(and(eq(schema.reviewItems.id, reviewItemId), eq(schema.reviewItems.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const evidence = await db.select().from(schema.fieldEvidence).where(eq(schema.fieldEvidence.fieldValueId, row.field.id));
  const ev = evidence.find((e) => e.exactMatch) ?? evidence[0] ?? null;
  const block = ev?.sourceBlockId ? (await db.select().from(schema.sourceBlocks).where(eq(schema.sourceBlocks.id, ev.sourceBlockId)).limit(1))[0] ?? null : null;
  const context =
    block && ev && ev.quoteStart !== null && ev.quoteEnd !== null
      ? excerpt(block.normalizedText, ev.quoteStart, ev.quoteEnd, 500)
      : block
        ? { before: block.normalizedText.slice(0, 1000), match: "", after: "" }
        : null;
  const [extraction] = row.record.extractionRunId
    ? await db.select().from(schema.extractionRuns).where(eq(schema.extractionRuns.id, row.record.extractionRunId)).limit(1)
    : [];
  const [currentRecord] = await db
    .select({ id: schema.recordVersions.id, versionNumber: schema.recordVersions.versionNumber })
    .from(schema.recordVersions)
    .where(and(eq(schema.recordVersions.documentVersionId, row.version.id), eq(schema.recordVersions.isCurrent, true)))
    .limit(1);
  const actions = await db
    .select({ action: schema.reviewActions, reviewer: { email: schema.appUsers.email, displayName: schema.appUsers.displayName } })
    .from(schema.reviewActions)
    .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.reviewActions.reviewerUserId))
    .where(eq(schema.reviewActions.reviewItemId, reviewItemId))
    .orderBy(desc(schema.reviewActions.createdAt));
  return {
    ...row,
    fieldLabel: fieldLabel(row.item.fieldPath),
    evidence: ev,
    allEvidence: evidence,
    block,
    context,
    extraction: extraction ?? null,
    currentRecord: currentRecord ?? null,
    actions,
  };
}

/** Open review item ids for a set of document versions (used by list pages). */
export async function openReviewCountsByVersion(documentVersionIds: string[]) {
  if (documentVersionIds.length === 0) return new Map<string, number>();
  const rows = await getDb()
    .select({ id: schema.reviewItems.documentVersionId, n: sql<number>`count(*)::int` })
    .from(schema.reviewItems)
    .where(and(inArray(schema.reviewItems.documentVersionId, documentVersionIds), eq(schema.reviewItems.status, "open")))
    .groupBy(schema.reviewItems.documentVersionId);
  return new Map(rows.map((r) => [r.id, r.n]));
}
