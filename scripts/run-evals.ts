import "./load-env";
import { closeDb } from "@/lib/db/client";
import { seedWorkspace } from "@/lib/seed";
import { seedEvalCases } from "@/lib/eval/cases";
import { ingestCorpus, latestCorpusRun } from "@/lib/eval/corpus";
import { runEvaluation } from "@/lib/eval/run";
import { generateQaReport } from "@/lib/report/qa-report";
import { SUCCESS_TARGETS } from "@/lib/config";
import { env } from "@/lib/env";

/**
 * pnpm eval [--set-baseline] [--no-ingest] [--no-cache] [--no-strict] [--skip-resumability]
 * Ingests the fixture corpus (idempotent), runs the golden suite and the failure-injection test,
 * compares with the baseline, writes the HTML QA report, and exits non-zero on regression or unmet targets.
 */
async function main() {
  const args = new Set(process.argv.slice(2));
  const log = (m: string) => console.log(m);
  const e = env();
  log(`provider ${e.LLM_PROVIDER}; job driver ${e.JOB_DRIVER}`);
  const seed = await seedWorkspace();
  log(`eval cases: ${await seedEvalCases()}`);
  if (!args.has("--no-ingest")) await ingestCorpus({ workspaceId: seed.workspaceId, userId: seed.adminId, wait: true, log });
  const corpusRun = await latestCorpusRun(seed.workspaceId);
  const outcome = await runEvaluation({ workspaceId: seed.workspaceId, userId: seed.adminId, processingRunId: corpusRun?.id ?? null, setBaseline: args.has("--set-baseline"), reuseCachedAnswers: !args.has("--no-cache"), skipResumability: args.has("--skip-resumability"), log });
  const m = outcome.metrics;
  const rows: [string, number, number][] = [
    ["scalar exact accuracy", m.extraction.scalar_exact_accuracy, SUCCESS_TARGETS.scalarExactAccuracy],
    ["list/object micro-F1", m.extraction.list_micro_f1, SUCCESS_TARGETS.listMicroF1],
    ["classification accuracy", m.extraction.classification_accuracy, SUCCESS_TARGETS.classificationAccuracy],
    ["provenance validity", m.extraction.provenance_validity, SUCCESS_TARGETS.provenanceValidity],
    ["review recall", m.review.recall, SUCCESS_TARGETS.reviewRecall],
    ["review precision", m.review.precision, SUCCESS_TARGETS.reviewPrecision],
    ["retrieval recall@5", m.rag.retrieval_recall_at_5, SUCCESS_TARGETS.retrievalRecallAt5],
    ["citation precision", m.rag.citation_precision, SUCCESS_TARGETS.citationPrecision],
    ["evidence-supported answers", m.rag.evidence_supported_rate, SUCCESS_TARGETS.evidenceSupportedRate],
    ["refusal accuracy", m.rag.refusal_accuracy, SUCCESS_TARGETS.refusalAccuracy],
    ["semantic answer score", m.rag.semantic_score, SUCCESS_TARGETS.semanticScore],
  ];
  console.table(rows.map(([metric, value, target]) => ({ metric, value: value.toFixed(3), target: target.toFixed(2), ok: value >= target - 1e-9 ? "yes" : "NO" })));
  console.table(outcome.regression.checks.map((c) => ({ metric: c.label, baseline: c.baseline === null ? "n/a" : c.baseline.toFixed(3), current: c.current.toFixed(3), delta: c.delta === null ? "n/a" : (c.delta * 100).toFixed(1) + " pp", rule: c.threshold, ok: c.passed ? "yes" : "NO" })));
  log(`integrity: duplicates ${m.integrity.duplicate_cases_passed}/${m.integrity.duplicate_cases}, versions ${m.integrity.version_cases_passed}/${m.integrity.version_cases}, duplicate records ${m.integrity.duplicate_records}, below-threshold auto-approvals ${m.review.below_threshold_missing}, resumability ${m.integrity.resumability_passed === null ? "skipped" : m.integrity.resumability_passed ? "passed" : "FAILED"}`);
  log(`cost: $${m.cost.estimated_cost_usd.toFixed(6)} (${m.cost.input_tokens} in / ${m.cost.output_tokens} out); latency p50 ${m.cost.latency_p50_ms} ms, p95 ${m.cost.latency_p95_ms} ms`);
  const failed = outcome.results.filter((r) => !r.passed);
  if (failed.length) {
    log(`failed cases (${failed.length}):`);
    for (const f of failed.slice(0, 40)) log(`  ${f.caseKey}: ${JSON.stringify(f.metric).slice(0, 300)}`);
  }
  let reportOk = false;
  if (corpusRun) {
    const report = await generateQaReport({ processingRunId: corpusRun.id, evalRunId: outcome.evalRunId });
    reportOk = report.status === "generated";
    log(`QA report ${report.status}: ${report.storagePath ?? report.error}`);
  }
  const targetsOk = rows.every(([, v, t]) => v >= t - 1e-9) && m.integrity.duplicate_records === 0 && m.review.below_threshold_missing === 0;
  const ok = reportOk && outcome.regression.passed && (args.has("--no-strict") || targetsOk);
  await closeDb();
  if (!ok) {
    console.error(`EVAL FAILED: regression ${outcome.regression.passed ? "passed" : "FAILED"}; success targets ${targetsOk ? "met" : "NOT met"}`);
    process.exit(1);
  }
  log("EVAL PASSED");
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
