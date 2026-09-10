import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { sha256 } from "@/lib/hash";
import { UPLOAD_LIMITS, PIPELINE_VERSION } from "@/lib/config";
import { getStorage } from "@/lib/storage";
import { getLlm, modelConfigHash } from "@/lib/llm";
import type { RunConfig } from "@/lib/db/schema";
import { logEvent } from "./events";

export type UploadInput = {
  workspaceId: string;
  userId: string | null;
  filename: string;
  bytes: Buffer;
  /** Optional explicit logical key; derived from the filename when omitted. */
  logicalKey?: string;
  displayName?: string;
};

export type UploadOutcome =
  | { kind: "duplicate"; existingVersionId: string; documentId: string; contentHash: string }
  | { kind: "created"; documentId: string; documentVersionId: string; versionNumber: number; supersedesVersionId: string | null; contentHash: string; logicalKey: string };

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly code: "unsupported_type" | "too_large" | "empty",
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export function mimeTypeFor(filename: string): keyof typeof UPLOAD_LIMITS.allowedMimeTypes | null {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") return "application/pdf";
  if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

/**
 * Derive a stable logical document key from a filename: the leading identifier up to a
 * version marker or descriptive suffix. "OPS-2026-004-v2-northstar.pdf" -> "OPS-2026-004";
 * "copy-of-AUD-2026-011.pdf" -> "AUD-2026-011"; otherwise the slugged basename.
 */
export function deriveLogicalKey(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  const idMatch = /([A-Z]{2,5}-\d{4}-\d{3,4})/i.exec(base);
  if (idMatch) return idMatch[1]!.toUpperCase();
  return base
    .replace(/[-_ ]v\d+.*$/i, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase();
}

export function deriveDisplayName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/^copy-of-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+v\d+\b/i, "")
    .trim();
}

/** Validate, hash, dedupe/version, store bytes and create the document version. No processing yet. */
export async function registerUpload(input: UploadInput): Promise<UploadOutcome> {
  const mimeType = mimeTypeFor(input.filename);
  if (!mimeType) throw new UploadError("Only .pdf and .docx files are supported", "unsupported_type");
  if (input.bytes.length === 0) throw new UploadError("File is empty", "empty");
  if (input.bytes.length > UPLOAD_LIMITS.maxBytes) throw new UploadError(`File exceeds the ${UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB limit`, "too_large");

  const db = getDb();
  const contentHash = sha256(input.bytes);

  const existing = await db
    .select({ id: schema.documentVersions.id, documentId: schema.documentVersions.documentId })
    .from(schema.documentVersions)
    .where(and(eq(schema.documentVersions.workspaceId, input.workspaceId), eq(schema.documentVersions.contentHash, contentHash)))
    .limit(1);
  if (existing[0]) {
    return { kind: "duplicate", existingVersionId: existing[0].id, documentId: existing[0].documentId, contentHash };
  }

  const logicalKey = input.logicalKey ?? deriveLogicalKey(input.filename);
  const displayName = input.displayName ?? deriveDisplayName(input.filename);

  // Store bytes first: no version row exists unless the upload is confirmed.
  const storagePath = `${input.workspaceId}/${contentHash}/${input.filename.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
  await getStorage().put(storagePath, input.bytes, mimeType);

  return db.transaction(async (tx) => {
    let [doc] = await tx
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.workspaceId, input.workspaceId), eq(schema.documents.logicalKey, logicalKey)))
      .limit(1);
    if (!doc) {
      [doc] = await tx.insert(schema.documents).values({ workspaceId: input.workspaceId, logicalKey, displayName }).returning();
    }
    const [latest] = await tx
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, doc!.id))
      .orderBy(desc(schema.documentVersions.versionNumber))
      .limit(1);
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    if (latest) {
      await tx.update(schema.documentVersions).set({ isCurrent: false }).where(eq(schema.documentVersions.documentId, doc!.id));
    }
    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        workspaceId: input.workspaceId,
        documentId: doc!.id,
        versionNumber,
        contentHash,
        storagePath,
        mimeType,
        byteSize: input.bytes.length,
        sourceFilename: input.filename,
        supersedesVersionId: latest?.id ?? null,
        isCurrent: true,
        uploadedBy: input.userId,
      })
      .returning();
    return {
      kind: "created",
      documentId: doc!.id,
      documentVersionId: version!.id,
      versionNumber,
      supersedesVersionId: latest?.id ?? null,
      contentHash,
      logicalKey,
    };
  });
}

export type CreateRunInput = {
  workspaceId: string;
  userId: string | null;
  runType: "ingest" | "reprocess" | "eval" | "backfill";
  documentVersionIds: string[];
  config?: RunConfig;
};

/** Create a processing run covering the given document versions. */
export async function createProcessingRun(input: CreateRunInput) {
  const db = getDb();
  const llm = getLlm();
  const [run] = await db
    .insert(schema.processingRuns)
    .values({
      workspaceId: input.workspaceId,
      runType: input.runType,
      pipelineVersion: PIPELINE_VERSION,
      provider: llm.name,
      modelConfigHash: modelConfigHash(llm),
      status: "queued",
      documentsTotal: input.documentVersionIds.length,
      initiatedBy: input.userId,
      configJson: { ...(input.config ?? {}), documentVersionIds: input.documentVersionIds },
    })
    .returning();
  await logEvent(run!.id, null, "info", "run.created", `run created for ${input.documentVersionIds.length} document version(s)`, {
    runType: input.runType,
    provider: llm.name,
  });
  return run!;
}

/** Record a duplicate upload as a run event on a lightweight completed run so it is visible in observability. */
export async function recordDuplicateEvent(workspaceId: string, userId: string | null, filename: string, existingVersionId: string, contentHash: string) {
  const db = getDb();
  const llm = getLlm();
  const [run] = await db
    .insert(schema.processingRuns)
    .values({
      workspaceId,
      runType: "ingest",
      pipelineVersion: PIPELINE_VERSION,
      provider: llm.name,
      modelConfigHash: modelConfigHash(llm),
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      documentsTotal: 0,
      initiatedBy: userId,
      configJson: { label: `duplicate upload: ${filename}`, duplicate: true },
    })
    .returning();
  await logEvent(run!.id, existingVersionId, "warn", "duplicate_detected", `upload ${filename} matched existing content hash; not processed`, {
    filename,
    contentHash,
    existingVersionId,
  });
  return run!;
}
