import { and, desc, eq, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

/** Document versions that have at least one review item, for the queue's version filter. */
export async function listReviewVersions(workspaceId: string) {
  return getDb()
    .selectDistinct({
      id: schema.documentVersions.id,
      versionNumber: schema.documentVersions.versionNumber,
      displayName: schema.documents.displayName,
      logicalKey: schema.documents.logicalKey,
    })
    .from(schema.reviewItems)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.reviewItems.documentVersionId))
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
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
