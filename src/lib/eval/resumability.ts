import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { createProcessingRun, registerUpload } from "@/lib/pipeline/ingest";
import { runProcessingRunInline } from "@/lib/pipeline/orchestrate";
import { DOCUMENTS_DIR, loadManifest } from "./cases";

export type ResumabilityResult = {
  passed: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
  processingRunId: string | null;
};

/**
 * Failure-injection test (spec section 5, Reliability), run inside an isolated workspace so the demo
 * corpus is untouched: upload one fixture, inject a failure on independent_verify (after extraction),
 * and prove that prior steps persist, the failure is recorded, retries happen, the run resumes, the
 * file is not re-uploaded, parsing is not repeated, and the paid extraction call is not repeated.
 */
export async function runResumabilityTest(opts: { log?: (m: string) => void } = {}): Promise<ResumabilityResult> {
  const log = opts.log ?? (() => {});
  const db = getDb();
  const checks: ResumabilityResult["checks"] = [];
  const check = (name: string, passed: boolean, detail: string) => {
    checks.push({ name, passed, detail });
    log(`resumability: ${passed ? "ok  " : "FAIL"} ${name}: ${detail}`);
  };
  const manifest = loadManifest();
  const first = manifest.files.find((f) => f.expect === "processed" && f.filename.endsWith(".pdf")) ?? manifest.files[0];
  if (!first) throw new Error("manifest has no files");
  const bytes = fs.readFileSync(path.join(DOCUMENTS_DIR, first.filename));

  // isolated workspace, fresh each time (versions are unique per workspace by content hash)
  const slug = `resumability-${Date.now().toString(36)}`;
  const [ws] = await db.insert(schema.workspaces).values({ slug, name: "Resumability test" }).returning();
  const up = await registerUpload({ workspaceId: ws!.id, userId: null, filename: first.filename, bytes });
  if (up.kind !== "created") throw new Error("resumability test could not create a version");
  const run = await createProcessingRun({ workspaceId: ws!.id, userId: null, runType: "ingest", documentVersionIds: [up.documentVersionId], config: { label: "resumability test", injectFailure: { step: "independent_verify", attempts: 2 } } });
  const result = await runProcessingRunInline(run.id, { sleep: async () => {} });
  const steps = await db.select().from(schema.runSteps).where(eq(schema.runSteps.processingRunId, run.id));
  const byName = new Map(steps.map((s) => [s.stepName, s]));
  const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.processingRunId, run.id));
  const calls = await db.select().from(schema.llmCalls).where(and(eq(schema.llmCalls.processingRunId, run.id), eq(schema.llmCalls.purpose, "extract")));
  const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.workspaceId, ws!.id));

  check("run reached a terminal state", ["completed", "completed_with_review"].includes(result.run?.status ?? ""), `status ${result.run?.status}`);
  check("completed previous steps remain persisted", byName.get("parse")?.status === "succeeded" && byName.get("extract")?.status === "succeeded", `parse=${byName.get("parse")?.status} extract=${byName.get("extract")?.status}`);
  check("failed step is recorded", events.filter((e) => e.eventType === "step.failed" && e.payloadJson.stepName === "independent_verify").length === 2, `${events.filter((e) => e.eventType === "step.failed").length} step.failed events`);
  check("retries occur", (byName.get("independent_verify")?.attemptCount ?? 0) === 3, `independent_verify attempts ${byName.get("independent_verify")?.attemptCount}`);
  check("run resumed and completed the failed step", byName.get("independent_verify")?.status === "succeeded" && byName.get("finalize")?.status === "succeeded", `verify=${byName.get("independent_verify")?.status} finalize=${byName.get("finalize")?.status}`);
  check("original file was not re-uploaded", versions.length === 1, `${versions.length} version(s) in the workspace`);
  check("completed parsing was not repeated", (byName.get("parse")?.attemptCount ?? 0) === 1, `parse attempts ${byName.get("parse")?.attemptCount}`);
  check("paid extraction output was not repeated", calls.length === 1 && (byName.get("extract")?.attemptCount ?? 0) === 1, `${calls.length} extract call(s), extract attempts ${byName.get("extract")?.attemptCount}`);

  // clean up the isolated workspace
  await db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws!.id));
  return { passed: checks.every((c) => c.passed), checks, processingRunId: run.id };
}
