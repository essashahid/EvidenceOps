import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

/** Document versions that have at least one review item, for the queue's version filter. */
export async function listReviewVersions(workspaceId: string) {
  return getDb()
    .selectDistinct({
      id: schema.documentVersions.id,
      versionNumber: schema.documentVersions.versionNumber,
      // Match the titles used everywhere else so the filter reads like the queue.
      displayName: sql<string>`coalesce(${schema.recordVersions.payloadJson}->>'report_title', ${schema.documents.displayName})`,
      logicalKey: schema.documents.logicalKey,
    })
    .from(schema.reviewItems)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.reviewItems.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .leftJoin(schema.recordVersions, and(eq(schema.recordVersions.documentVersionId, schema.documentVersions.id), eq(schema.recordVersions.isCurrent, true)))
    .where(eq(schema.reviewItems.workspaceId, workspaceId))
    .orderBy(schema.documents.logicalKey, schema.documentVersions.versionNumber);
}

/** Distinct root field names (list indexes stripped) that currently have review items. */
export async function listReviewFieldRoots(workspaceId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ root: sql<string>`regexp_replace(${schema.reviewItems.fieldPath}, '\\[.*$', '')` })
    .from(schema.reviewItems)
    .where(eq(schema.reviewItems.workspaceId, workspaceId))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((r) => r.root);
}

/** The next open item in queue order (same order as the queue list), excluding one id. */
export async function nextOpenReviewItemId(workspaceId: string, excludeId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: schema.reviewItems.id })
    .from(schema.reviewItems)
    .where(and(eq(schema.reviewItems.workspaceId, workspaceId), eq(schema.reviewItems.status, "open"), ne(schema.reviewItems.id, excludeId)))
    .orderBy(desc(schema.reviewItems.priority), desc(schema.reviewItems.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Position of an item within the open queue plus its neighbours, so the reviewer
 * can move through the queue without returning to the list.
 */
export async function openQueueNeighbours(workspaceId: string, itemId: string): Promise<{ index: number; total: number; prevId: string | null; nextId: string | null }> {
  const rows = await getDb()
    .select({ id: schema.reviewItems.id })
    .from(schema.reviewItems)
    .where(and(eq(schema.reviewItems.workspaceId, workspaceId), eq(schema.reviewItems.status, "open")))
    .orderBy(desc(schema.reviewItems.priority), desc(schema.reviewItems.createdAt))
    .limit(500);
  const ids = rows.map((r) => r.id);
  const i = ids.indexOf(itemId);
  if (i === -1) return { index: -1, total: ids.length, prevId: null, nextId: ids[0] ?? null };
  return { index: i, total: ids.length, prevId: ids[i - 1] ?? null, nextId: ids[i + 1] ?? null };
}
