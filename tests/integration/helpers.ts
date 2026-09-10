import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { createProcessingRun, registerUpload } from "@/lib/pipeline/ingest";
import { runProcessingRunInline } from "@/lib/pipeline/orchestrate";
import type { RunConfig } from "@/lib/db/schema";

export const noSleep = async () => {};

export async function makePdf(lines: string[], pages = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([612, 792]);
    page.drawText(lines.join("\n"), { x: 50, y: 720, size: 11, font, lineHeight: 14 });
  }
  return Buffer.from(await pdf.save());
}

export function fixture(rel: string): Buffer {
  return fs.readFileSync(path.resolve(process.cwd(), "fixtures", rel));
}

export async function seeded() {
  return seedWorkspace();
}

export async function uploadAndProcess(filename: string, bytes: Buffer, config: RunConfig = {}) {
  const seed = await seedWorkspace();
  const up = await registerUpload({ workspaceId: seed.workspaceId, userId: seed.adminId, filename, bytes });
  if (up.kind !== "created") throw new Error(`expected created, got ${up.kind}`);
  const run = await createProcessingRun({ workspaceId: seed.workspaceId, userId: seed.adminId, runType: "ingest", documentVersionIds: [up.documentVersionId], config });
  const result = await runProcessingRunInline(run.id, { sleep: noSleep });
  return { seed, up, run, result };
}

export async function stepsFor(runId: string) {
  return getDb().select().from(schema.runSteps).where(eq(schema.runSteps.processingRunId, runId));
}

export async function llmCallsFor(runId: string) {
  return getDb().select().from(schema.llmCalls).where(eq(schema.llmCalls.processingRunId, runId));
}

export async function runRow(runId: string) {
  const [r] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, runId)).limit(1);
  return r!;
}
