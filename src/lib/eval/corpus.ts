import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { createProcessingRun, recordDuplicateEvent, registerUpload, type UploadOutcome } from "@/lib/pipeline/ingest";
import { dispatchRun } from "@/lib/jobs";
import { DOCUMENTS_DIR, loadManifest } from "./cases";

export type CorpusIngestRow = { filename: string; expect: string; outcome: UploadOutcome["kind"] | "error"; detail: string; documentVersionId: string | null };

export type CorpusIngestResult = { rows: CorpusIngestRow[]; processingRunId: string | null; created: number; duplicates: number };

/**
 * Upload every manifest file (idempotent: files already present by hash are reported as
 * duplicates and skipped), create one processing run for the new versions and dispatch it.
 */
export async function ingestCorpus(opts: { workspaceId: string; userId: string | null; wait?: boolean; log?: (m: string) => void; timeoutMs?: number }): Promise<CorpusIngestResult> {
  const log = opts.log ?? (() => {});
  const manifest = loadManifest();
  const rows: CorpusIngestRow[] = [];
  const created: string[] = [];
  let duplicates = 0;
  for (const f of manifest.files) {
    const file = path.join(DOCUMENTS_DIR, f.filename);
    if (!fs.existsSync(file)) throw new Error(`fixture file missing: ${f.filename} (run pnpm fixtures:generate)`);
    try {
      const outcome = await registerUpload({ workspaceId: opts.workspaceId, userId: opts.userId, filename: f.filename, bytes: fs.readFileSync(file) });
      if (outcome.kind === "duplicate") {
        duplicates++;
        // Re-seeding preserves the intended duplicate examples without logging every unchanged base file.
        if (f.expect === "duplicate") await recordDuplicateEvent(opts.workspaceId, opts.userId, f.filename, outcome.existingVersionId, outcome.contentHash);
        rows.push({ filename: f.filename, expect: f.expect, outcome: "duplicate", detail: `matches version ${outcome.existingVersionId.slice(0, 8)}`, documentVersionId: outcome.existingVersionId });
      } else {
        created.push(outcome.documentVersionId);
        rows.push({ filename: f.filename, expect: f.expect, outcome: "created", detail: `${outcome.logicalKey} v${outcome.versionNumber}${outcome.supersedesVersionId ? ` supersedes ${outcome.supersedesVersionId.slice(0, 8)}` : ""}`, documentVersionId: outcome.documentVersionId });
      }
    } catch (err) {
      rows.push({ filename: f.filename, expect: f.expect, outcome: "error", detail: err instanceof Error ? err.message : String(err), documentVersionId: null });
    }
    log(`${rows[rows.length - 1]!.outcome.padEnd(9)} ${f.filename}  ${rows[rows.length - 1]!.detail}`);
  }
  let processingRunId: string | null = null;
  if (created.length) {
    const run = await createProcessingRun({ workspaceId: opts.workspaceId, userId: opts.userId, runType: "ingest", documentVersionIds: created, config: { label: "fixture corpus" } });
    processingRunId = run.id;
    log(`run ${run.id}: dispatching ${created.length} document version(s)`);
    const d = await dispatchRun(run.id);
    if (d.driver === "inngest" && opts.wait !== false) await waitForRun(run.id, opts.timeoutMs ?? 20 * 60_000, log);
  } else {
    log("nothing new to process");
  }
  return { rows, processingRunId, created: created.length, duplicates };
}

export async function waitForRun(processingRunId: string, timeoutMs: number, log: (m: string) => void) {
  const db = getDb();
  const started = Date.now();
  for (;;) {
    const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
    if (!run) throw new Error(`run ${processingRunId} disappeared`);
    if (["completed", "completed_with_review", "failed"].includes(run.status)) return run;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for run ${processingRunId} (status ${run.status}, step ${run.currentStep})`);
    log(`waiting: ${run.status} ${run.documentsCompleted + run.documentsFailed}/${run.documentsTotal} (${run.currentStep ?? "-"})`);
    await new Promise((r) => setTimeout(r, 5000));
  }
}

/** The most recent ingest run for the workspace (used to attach the QA report). */
export async function latestCorpusRun(workspaceId: string) {
  const db = getDb();
  const rows = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.workspaceId, workspaceId));
  return rows.filter((r) => r.runType === "ingest" && (r.configJson.documentVersionIds?.length ?? 0) > 0).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
}
