import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { createProcessingRun } from "@/lib/pipeline/ingest";
import { runProcessingRunInline } from "@/lib/pipeline/orchestrate";

/**
 * Synchronously process ONE document version without Inngest (local debugging only).
 * Usage: pnpm process:one <document-version-id | LOGICAL-KEY[@version]> [--fail-step <step>[:attempts]]
 */
async function main() {
  const [target] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!target) throw new Error("usage: pnpm process:one <document-version-id | LOGICAL-KEY[@version]>");
  const failIdx = process.argv.indexOf("--fail-step");
  const injectFailure = failIdx > 0 ? { step: process.argv[failIdx + 1]!.split(":")[0]!, attempts: Number(process.argv[failIdx + 1]!.split(":")[1] ?? 1) } : undefined;
  const db = getDb();
  const seed = await seedWorkspace();
  let versionId = target;
  if (!/^[0-9a-f-]{36}$/i.test(target)) {
    const [key, ver] = target.split("@");
    const [row] = await db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(and(eq(schema.documents.logicalKey, key!.toUpperCase()), ver ? eq(schema.documentVersions.versionNumber, Number(ver)) : eq(schema.documentVersions.isCurrent, true)))
      .limit(1);
    if (!row) throw new Error(`no document version for ${target}`);
    versionId = row.id;
  }
  const run = await createProcessingRun({ workspaceId: seed.workspaceId, userId: seed.adminId, runType: "reprocess", documentVersionIds: [versionId], config: { label: `process:one ${target}`, injectFailure } });
  console.log(`run ${run.id} processing ${versionId} inline`);
  const res = await runProcessingRunInline(run.id);
  console.log(`run ${res.run?.status}`, res.outcomes);
  const steps = await db.select({ step: schema.runSteps.stepName, status: schema.runSteps.status, attempts: schema.runSteps.attemptCount, ms: schema.runSteps.latencyMs }).from(schema.runSteps).where(eq(schema.runSteps.processingRunId, run.id));
  console.table(steps);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
