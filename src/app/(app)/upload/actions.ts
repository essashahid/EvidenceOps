"use server";

import { revalidatePath } from "next/cache";
import { registerUpload, createProcessingRun, recordDuplicateEvent, UploadError } from "@/lib/pipeline/ingest";
import { dispatchRun } from "@/lib/jobs";
import { requireWorkspace } from "@/lib/workspace";
import { UPLOAD_LIMITS } from "@/lib/config";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";

export type UploadRow = {
  filename: string;
  type: string;
  size: number;
  contentHash: string | null;
  logicalKey: string | null;
  versionNumber: number | null;
  documentId: string | null;
  documentVersionId: string | null;
  outcome:
    | { kind: "created" }
    | { kind: "new_version"; supersedesVersionId: string; supersedesVersionNumber: number | null }
    | { kind: "duplicate"; existingVersionId: string; documentId: string; duplicateRunId: string }
    | { kind: "rejected"; message: string; code: string };
};

export type UploadState = {
  rows: UploadRow[];
  runId: string | null;
  runOutcome: string | null;
  error: string | null;
};

function typeFor(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  return ext === "pdf" || ext === "docx" ? ext : ext || "unknown";
}

export async function uploadAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const { user, workspace } = await requireWorkspace();
  if (workspace.role === "viewer") return { rows: [], runId: null, runOutcome: null, error: "Viewers cannot upload documents." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0 && f.name !== "");
  if (files.length === 0) return { rows: [], runId: null, runOutcome: null, error: "Choose at least one .pdf or .docx file." };

  const rows: UploadRow[] = [];
  const createdVersionIds: string[] = [];

  for (const file of files) {
    const base: Omit<UploadRow, "outcome"> = {
      filename: file.name,
      type: typeFor(file.name),
      size: file.size,
      contentHash: null,
      logicalKey: null,
      versionNumber: null,
      documentId: null,
      documentVersionId: null,
    };
    if (file.size > UPLOAD_LIMITS.maxBytes) {
      rows.push({ ...base, outcome: { kind: "rejected", code: "too_large", message: `File exceeds the ${UPLOAD_LIMITS.maxBytes / (1024 * 1024)} MB limit` } });
      continue;
    }
    try {
      const bytes = Buffer.from(await file.arrayBuffer());
      const result = await registerUpload({ workspaceId: workspace.workspaceId, userId: user.id, filename: file.name, bytes });
      if (result.kind === "duplicate") {
        const dupRun = await recordDuplicateEvent(workspace.workspaceId, user.id, file.name, result.existingVersionId, result.contentHash);
        const [existing] = await getDb()
          .select({ versionNumber: schema.documentVersions.versionNumber, logicalKey: schema.documents.logicalKey })
          .from(schema.documentVersions)
          .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
          .where(eq(schema.documentVersions.id, result.existingVersionId))
          .limit(1);
        rows.push({
          ...base,
          contentHash: result.contentHash,
          logicalKey: existing?.logicalKey ?? null,
          versionNumber: existing?.versionNumber ?? null,
          documentId: result.documentId,
          documentVersionId: result.existingVersionId,
          outcome: { kind: "duplicate", existingVersionId: result.existingVersionId, documentId: result.documentId, duplicateRunId: dupRun.id },
        });
        continue;
      }
      createdVersionIds.push(result.documentVersionId);
      let supersedesVersionNumber: number | null = null;
      if (result.supersedesVersionId) {
        const [prev] = await getDb().select({ versionNumber: schema.documentVersions.versionNumber }).from(schema.documentVersions).where(eq(schema.documentVersions.id, result.supersedesVersionId)).limit(1);
        supersedesVersionNumber = prev?.versionNumber ?? null;
      }
      rows.push({
        ...base,
        contentHash: result.contentHash,
        logicalKey: result.logicalKey,
        versionNumber: result.versionNumber,
        documentId: result.documentId,
        documentVersionId: result.documentVersionId,
        outcome: result.supersedesVersionId ? { kind: "new_version", supersedesVersionId: result.supersedesVersionId, supersedesVersionNumber } : { kind: "created" },
      });
    } catch (err) {
      if (err instanceof UploadError) {
        rows.push({ ...base, outcome: { kind: "rejected", code: err.code, message: err.message } });
      } else {
        rows.push({ ...base, outcome: { kind: "rejected", code: "error", message: err instanceof Error ? err.message : String(err) } });
      }
    }
  }

  let runId: string | null = null;
  let runOutcome: string | null = null;
  if (createdVersionIds.length > 0) {
    const run = await createProcessingRun({ workspaceId: workspace.workspaceId, userId: user.id, runType: "ingest", documentVersionIds: createdVersionIds });
    runId = run.id;
    try {
      const result = await dispatchRun(run.id);
      runOutcome = result.driver === "inline" ? `processed ${result.dispatched} version(s) inline` : `dispatched ${result.dispatched} version(s) to Inngest`;
    } catch (err) {
      runOutcome = `dispatch failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  revalidatePath("/");
  revalidatePath("/documents");
  revalidatePath("/runs");
  return { rows, runId, runOutcome, error: null };
}
