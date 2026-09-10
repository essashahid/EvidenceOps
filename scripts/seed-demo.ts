import "./load-env";
import { getSql, closeDb } from "@/lib/db/client";
import { getLlm, modelConfigHash } from "@/lib/llm";
import { createProcessingRun } from "@/lib/pipeline/ingest";
import { runProcessingRunInline } from "@/lib/pipeline/orchestrate";
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
    // A provider change must not label old mock extractions as live model results.
    const configHash = modelConfigHash(getLlm());
    const stale = await getSql()<{ id: string }[]>`
      select dv.id from document_versions dv
      left join lateral (
        select model_config_hash from record_versions rv where rv.document_version_id=dv.id
          and rv.created_by_type in ('model', 'reprocess') order by rv.version_number desc limit 1
      ) latest on true
      where dv.workspace_id=${r.workspaceId} and latest.model_config_hash is distinct from ${configHash}
    `;
    let processingRun = await latestCorpusRun(r.workspaceId);
    if (stale.length) {
      console.log(`Reprocessing ${stale.length} versions for the selected model configuration`);
      processingRun = await createProcessingRun({ workspaceId: r.workspaceId, userId: r.adminId, runType: "reprocess", documentVersionIds: stale.map(v => v.id) });
      const result = await runProcessingRunInline(processingRun.id);
      if (result.run?.documentsFailed) throw new Error("Provider migration processing failed; inspect the run before evaluating.");
    }
    const review = await seedDemoReview(r);
    if (review) console.log(`Synthetic review saved: record version ${review.resultingVersionNumber}`);
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
