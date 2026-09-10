import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

/** Last N questions asked in the workspace with their (latest) answer's mode and sufficiency. */
export async function listRecentQuestions(workspaceId: string, limit = 10) {
  return getDb()
    .select({
      answerId: schema.ragAnswers.id,
      question: schema.ragQueries.queryText,
      mode: schema.ragAnswers.mode,
      sufficient: schema.ragAnswers.sufficientEvidence,
      includeSuperseded: schema.ragQueries.includeSuperseded,
      createdAt: schema.ragAnswers.createdAt,
    })
    .from(schema.ragAnswers)
    .innerJoin(schema.ragQueries, eq(schema.ragQueries.id, schema.ragAnswers.ragQueryId))
    .where(eq(schema.ragQueries.workspaceId, workspaceId))
    .orderBy(desc(schema.ragAnswers.createdAt))
    .limit(limit);
}

/** Chunk text for the retrieved-evidence table (retrieved_json stores ids and scores only). */
export async function loadChunkTexts(chunkIds: string[]) {
  if (chunkIds.length === 0) return new Map<string, string>();
  const rows = await getDb().select({ id: schema.chunks.id, text: schema.chunks.text }).from(schema.chunks).where(inArray(schema.chunks.id, chunkIds));
  return new Map(rows.map((r) => [r.id, r.text]));
}

export type VersionRef = { versionId: string; documentId: string; displayName: string; logicalKey: string; versionNumber: number; isCurrent: boolean };

/** Document / version identity for a set of version ids, scoped to the workspace. */
export async function loadVersionRefs(workspaceId: string, versionIds: string[]) {
  const unique = Array.from(new Set(versionIds));
  if (unique.length === 0) return new Map<string, VersionRef>();
  const rows = await getDb()
    .select({
      versionId: schema.documentVersions.id,
      documentId: schema.documents.id,
      displayName: schema.documents.displayName,
      logicalKey: schema.documents.logicalKey,
      versionNumber: schema.documentVersions.versionNumber,
      isCurrent: schema.documentVersions.isCurrent,
    })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documentVersions.workspaceId, workspaceId), inArray(schema.documentVersions.id, unique)));
  return new Map<string, VersionRef>(rows.map((r) => [r.versionId, r]));
}
