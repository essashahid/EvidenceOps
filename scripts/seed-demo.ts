import "./load-env";
import { closeDb } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { seedDemoReview } from "@/lib/demo";
import { ingestCorpus, latestCorpusRun } from "@/lib/eval/corpus";
import { runEvaluation } from "@/lib/eval/run";
import { generateQaReport } from "@/lib/report/qa-report";
import { seedEvalCases } from "@/lib/eval/cases";

async function main() {
  const r = await seedWorkspace();
  console.log(`workspace ${r.workspaceId}; admin ${r.adminId}; reviewer ${r.reviewerId}`);
  const n = await seedEvalCases();
  console.log(`eval cases upserted: ${n}`);
  if (!process.argv.includes("--users-only")) {
    await ingestCorpus({ workspaceId: r.workspaceId, userId: r.adminId, wait: true, log: console.log });
    const review = await seedDemoReview(r);
    if (review) console.log(`Synthetic review saved: record version ${review.resultingVersionNumber}`);
    const processingRun = await latestCorpusRun(r.workspaceId);
    const evaluation = await runEvaluation({ workspaceId: r.workspaceId, userId: r.adminId, processingRunId: processingRun?.id, log: console.log });
    if (processingRun) {
      const report = await generateQaReport({ processingRunId: processingRun.id, evalRunId: evaluation.evalRunId });
      if (report.status !== "generated") throw new Error(report.error);
      console.log(`QA report: ${report.storagePath}`);
    }
    if (!evaluation.regression.passed || !evaluation.targetsMet) throw new Error("Seeded evaluation failed its regression gate. Inspect the evaluation results.");
  }
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
