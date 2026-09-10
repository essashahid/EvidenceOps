import { REGRESSION_RULES } from "@/lib/config";

export type AggregateMetrics = {
  extraction: { scalar_exact_accuracy: number; list_micro_f1: number; evidence_validity: number; classification_accuracy: number; documents: number; scalar_fields: number };
  review: { recall: number; precision: number; planted: number; planted_caught: number; routed: number; below_threshold_missing: number };
  rag: { retrieval_recall_at_5: number; citation_precision: number; evidence_supported_rate: number; refusal_accuracy: number; semantic_score: number; false_refusal_rate: number; answer_cases: number; refusal_cases: number; retrieval_cases: number };
  integrity: { duplicate_cases_passed: number; duplicate_cases: number; version_cases_passed: number; version_cases: number; duplicate_records: number };
  cost: { estimated_cost_usd: number; input_tokens: number; output_tokens: number; latency_p50_ms: number; latency_p95_ms: number };
  cases: { total: number; passed: number; failed: number };
};

export type RegressionCheck = { metric: string; baseline: number | null; current: number; threshold: string; passed: boolean };

export type RegressionReport = { passed: boolean; hasBaseline: boolean; baselineEvalRunId: string | null; checks: RegressionCheck[] };

const pct = (x: number) => x * 100;

/** Compare the current aggregate metrics against a baseline using the hard regression rules. */
export function evaluateRegression(current: AggregateMetrics, baseline: AggregateMetrics | null, baselineEvalRunId: string | null): RegressionReport {
  const checks: RegressionCheck[] = [];
  const drop = (metric: string, cur: number, base: number | null, maxDropPct: number) => {
    const passed = base === null ? true : pct(base) - pct(cur) <= maxDropPct + 1e-9;
    checks.push({ metric, baseline: base, current: cur, threshold: `drop <= ${maxDropPct} pp`, passed });
  };
  drop("extraction.scalar_exact_accuracy", current.extraction.scalar_exact_accuracy, baseline?.extraction.scalar_exact_accuracy ?? null, REGRESSION_RULES.extractionExactAccuracyDropPct);
  drop("extraction.evidence_validity", current.extraction.evidence_validity, baseline?.extraction.evidence_validity ?? null, REGRESSION_RULES.evidencePrecisionDropPct);
  drop("review.recall", current.review.recall, baseline?.review.recall ?? null, REGRESSION_RULES.reviewRecallDropPct);
  drop("rag.retrieval_recall_at_5", current.rag.retrieval_recall_at_5, baseline?.rag.retrieval_recall_at_5 ?? null, REGRESSION_RULES.retrievalRecallDropPct);
  checks.push({
    metric: "rag.refusal_accuracy",
    baseline: baseline?.rag.refusal_accuracy ?? null,
    current: current.rag.refusal_accuracy,
    threshold: `>= ${REGRESSION_RULES.minRefusalAccuracy}`,
    passed: current.rag.refusal_accuracy >= REGRESSION_RULES.minRefusalAccuracy - 1e-9,
  });
  checks.push({
    metric: "rag.semantic_score",
    baseline: baseline?.rag.semantic_score ?? null,
    current: current.rag.semantic_score,
    threshold: `>= ${REGRESSION_RULES.minSemanticScore}`,
    passed: current.rag.semantic_score >= REGRESSION_RULES.minSemanticScore - 1e-9,
  });
  const integrityOk = current.integrity.duplicate_cases_passed === current.integrity.duplicate_cases && current.integrity.version_cases_passed === current.integrity.version_cases;
  checks.push({
    metric: "integrity.duplicate_and_version_cases",
    baseline: null,
    current: integrityOk ? 1 : 0,
    threshold: "all pass",
    passed: integrityOk,
  });
  return { passed: checks.every((c) => c.passed), hasBaseline: baseline !== null, baselineEvalRunId, checks };
}
