import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

export type DocumentListRow = {
  id: string;
  logicalKey: string;
  displayName: string;
  createdAt: Date;
  currentVersionId: string | null;
  versionNumber: number | null;
  sourceFilename: string | null;
  mimeType: string | null;
  pageCount: number | null;
  processingStatus: string | null;
  parseStatus: string | null;
  updatedAt: Date;
  openReviewCount: number;
};

/** Logical documents with their current version and open review counts (two grouped queries, no N+1). */
export async function listDocuments(workspaceId: string, limit?: number): Promise<DocumentListRow[]> {
  const db = getDb();
  const base = db
    .select({ doc: schema.documents, version: schema.documentVersions })
    .from(schema.documents)
    .leftJoin(schema.documentVersions, and(eq(schema.documentVersions.documentId, schema.documents.id), eq(schema.documentVersions.isCurrent, true)))
    .where(eq(schema.documents.workspaceId, workspaceId))
    .orderBy(desc(schema.documentVersions.createdAt), desc(schema.documents.createdAt));
  const rows = limit ? await base.limit(limit) : await base;

  const versionIds = rows.map((r) => r.version?.id).filter((id): id is string => Boolean(id));
  const openCounts = new Map<string, number>();
  if (versionIds.length > 0) {
    const counts = await db
      .select({ documentVersionId: schema.reviewItems.documentVersionId, n: count() })
      .from(schema.reviewItems)
      .where(and(eq(schema.reviewItems.workspaceId, workspaceId), eq(schema.reviewItems.status, "open"), inArray(schema.reviewItems.documentVersionId, versionIds)))
      .groupBy(schema.reviewItems.documentVersionId);
    for (const c of counts) openCounts.set(c.documentVersionId, Number(c.n));
  }

  return rows.map(({ doc, version }) => ({
    id: doc.id,
    logicalKey: doc.logicalKey,
    displayName: doc.displayName,
    createdAt: doc.createdAt,
    currentVersionId: version?.id ?? null,
    versionNumber: version?.versionNumber ?? null,
    sourceFilename: version?.sourceFilename ?? null,
    mimeType: version?.mimeType ?? null,
    pageCount: version?.pageCount ?? null,
    processingStatus: version?.processingStatus ?? null,
    parseStatus: version?.parseStatus ?? null,
    updatedAt: version?.createdAt ?? doc.createdAt,
    openReviewCount: version ? (openCounts.get(version.id) ?? 0) : 0,
  }));
}

export async function getDocument(workspaceId: string, documentId: string) {
  const [doc] = await getDb()
    .select()
    .from(schema.documents)
    .where(and(eq(schema.documents.workspaceId, workspaceId), eq(schema.documents.id, documentId)))
    .limit(1);
  return doc ?? null;
}

export async function listVersionsForDocument(workspaceId: string, documentId: string) {
  return getDb()
    .select()
    .from(schema.documentVersions)
    .where(and(eq(schema.documentVersions.workspaceId, workspaceId), eq(schema.documentVersions.documentId, documentId)))
    .orderBy(desc(schema.documentVersions.versionNumber));
}

export async function getVersion(workspaceId: string, versionId: string) {
  const [row] = await getDb()
    .select({ version: schema.documentVersions, document: schema.documents })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documentVersions.workspaceId, workspaceId), eq(schema.documentVersions.id, versionId)))
    .limit(1);
  return row ?? null;
}

export type FieldRow = {
  id: string;
  fieldPath: string;
  valueJson: unknown;
  isRequired: boolean;
  confidence: string;
  routingStatus: string;
  verifierStatus: string | null;
  contradiction: boolean;
  verifierCorrectedValueJson: unknown;
  validationMessages: { level: string; code: string; message: string }[];
  evidence: { quoteText: string; sourceLocator: string; exactMatch: boolean; sourceBlockId: string | null }[];
};

/** Current record version for a document version, with field values and evidence. */
export async function getCurrentRecord(versionId: string) {
  const db = getDb();
  const [record] = await db
    .select()
    .from(schema.recordVersions)
    .where(and(eq(schema.recordVersions.documentVersionId, versionId), eq(schema.recordVersions.isCurrent, true)))
    .orderBy(desc(schema.recordVersions.versionNumber))
    .limit(1);
  if (!record) return null;
  const values = await db.select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, record.id)).orderBy(asc(schema.fieldValues.createdAt));
  const ids = values.map((v) => v.id);
  const evidence = ids.length
    ? await db.select().from(schema.fieldEvidence).where(inArray(schema.fieldEvidence.fieldValueId, ids)).orderBy(asc(schema.fieldEvidence.createdAt))
    : [];
  const byField = new Map<string, FieldRow["evidence"]>();
  for (const e of evidence) {
    const list = byField.get(e.fieldValueId) ?? [];
    list.push({ quoteText: e.quoteText, sourceLocator: e.sourceLocator, exactMatch: e.exactMatch, sourceBlockId: e.sourceBlockId });
    byField.set(e.fieldValueId, list);
  }
  const fields: FieldRow[] = values.map((v) => ({
    id: v.id,
    fieldPath: v.fieldPath,
    valueJson: v.valueJson,
    isRequired: v.isRequired,
    confidence: v.confidence,
    routingStatus: v.routingStatus,
    verifierStatus: v.verifierStatus,
    contradiction: v.contradiction,
    verifierCorrectedValueJson: v.verifierCorrectedValueJson,
    validationMessages: v.validationMessages,
    evidence: byField.get(v.id) ?? [],
  }));
  return { record, fields };
}

export async function listRecordHistory(versionId: string) {
  return getDb()
    .select({ record: schema.recordVersions, createdByName: schema.appUsers.displayName })
    .from(schema.recordVersions)
    .leftJoin(schema.appUsers, eq(schema.appUsers.id, schema.recordVersions.createdByUserId))
    .where(eq(schema.recordVersions.documentVersionId, versionId))
    .orderBy(desc(schema.recordVersions.versionNumber));
}

export async function listSourceBlocks(versionId: string) {
  return getDb().select().from(schema.sourceBlocks).where(eq(schema.sourceBlocks.documentVersionId, versionId)).orderBy(asc(schema.sourceBlocks.blockIndex));
}

export async function listStepsForVersion(versionId: string) {
  return getDb()
    .select({ step: schema.runSteps, runStatus: schema.processingRuns.status })
    .from(schema.runSteps)
    .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.runSteps.processingRunId))
    .where(eq(schema.runSteps.documentVersionId, versionId))
    .orderBy(desc(schema.runSteps.createdAt));
}

export async function listOpenReviewForVersion(versionId: string) {
  return getDb().select().from(schema.reviewItems).where(and(eq(schema.reviewItems.documentVersionId, versionId), eq(schema.reviewItems.status, "open")));
}
