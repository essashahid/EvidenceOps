"use server";

import { assertMutation } from "@/lib/access";

import { revalidatePath } from "next/cache";
import { registerUpload, createProcessingRun, recordDuplicateEvent, UploadError } from "@/lib/pipeline/ingest";
import { dispatchRun } from "@/lib/jobs";
import { requireWorkspace } from "@/lib/workspace";
import { UPLOAD_LIMITS } from "@/lib/config";
import { getDb, schema } from "@/lib/db/client";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getStorage } from "@/lib/storage";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

const descriptor = z.object({ filename: z.string().min(1).max(240), path: z.string().max(500), size: z.number().int().positive().max(UPLOAD_LIMITS.maxBytes) });

export async function prepareSourceUpload(filename: string, size: number) {
  const context = await requireWorkspace();
  await assertMutation(context, "upload-sign");
  if (!/\.(pdf|docx)$/i.test(filename) || filename.length > 240 || size <= 0 || size > UPLOAD_LIMITS.maxBytes) throw new Error("Choose a PDF or DOCX within the upload limit.");
  const e = env();
  const path = `pending/${context.workspace.workspaceId}/${context.user.id}/${randomUUID()}/${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  if (e.STORAGE_DRIVER === "blob") {
    const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
    const token = await generateClientTokenFromReadWriteToken({ token: e.BLOB_READ_WRITE_TOKEN!, pathname: path, maximumSizeInBytes: size, validUntil: Date.now() + 10 * 60 * 1000, addRandomSuffix: false, allowOverwrite: false, allowedContentTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] });
    return { driver: "blob" as const, path, token };
  }
  if (e.STORAGE_DRIVER !== "supabase" || !e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY || !e.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Supabase storage is not configured.");

  const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await sb.storage.from(e.SUPABASE_STORAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Could not prepare the upload. Please retry.");
  return { driver: "supabase" as const, path, token: data.token, bucket: e.SUPABASE_STORAGE_BUCKET, url: e.NEXT_PUBLIC_SUPABASE_URL, anonKey: e.NEXT_PUBLIC_SUPABASE_ANON_KEY };
}

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
  const context = await requireWorkspace();
  await assertMutation(context, "upload", ["admin", "reviewer"]);
  const { user, workspace } = context;
  if (workspace.role === "viewer") return { rows: [], runId: null, runOutcome: null, error: "Viewers cannot upload documents." };

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0 && f.name !== "");
  const uploaded = formData.getAll("uploaded");
  if (files.length + uploaded.length > 20) return { rows: [], runId: null, runOutcome: null, error: "Upload at most 20 files at a time." };
  if (uploaded.length) {
    try {
      if (env().STORAGE_DRIVER === "local") throw new Error("Direct uploads require persistent object storage.");
      for (const raw of uploaded) {
        const item = descriptor.parse(JSON.parse(String(raw)));
        if (!item.path.startsWith(`pending/${workspace.workspaceId}/${user.id}/`) || item.path.includes("..")) throw new Error("Invalid upload path.");
        const bytes = await getStorage().get(item.path);
        if (bytes.length !== item.size) throw new Error("Upload size did not match. Please retry.");
        files.push(new File([new Uint8Array(bytes)], item.filename));
        const e = env();
        if (e.STORAGE_DRIVER === "blob") {
          const { del } = await import("@vercel/blob");
          await del(item.path, { token: e.BLOB_READ_WRITE_TOKEN });
        } else {
        const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
        await sb.storage.from(e.SUPABASE_STORAGE_BUCKET).remove([item.path]);
        }
      }
    } catch {
      return { rows: [], runId: null, runOutcome: null, error: "Could not validate uploaded files. Please select the files and retry." };
    }
  }
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
