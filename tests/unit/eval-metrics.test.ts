import { describe, expect, it } from "vitest";
import { compareLists, compareScalars, microF1, percentile, valuesEqual } from "@/lib/eval/metrics";
import { evaluateRegression, type AggregateMetrics } from "@/lib/eval/regression";
import { EMPTY_RECORD, type ReportRecord } from "@/lib/schema/report";

const rec: ReportRecord = {
  ...EMPTY_RECORD,
  report_title: "Northstar Operational Review",
  report_number: "OPS-2026-004",
  issuing_organization: "Northstar Distribution",
  publication_date: "2026-03-12",
  document_type: "operational_review",
  key_findings: [
    { text: "Finding 1: Dock throughput fell 18 percent in Q1.", severity: "high" },
    { text: "Finding 2: Two vendors missed SLA.", severity: "medium" },
  ],
  monetary_amounts: [{ amount: 1250000, currency: "USD", label: "revised program cost" }],
};

describe("metrics", () => {
  it("scalar comparison is exact for dates/enums and tolerant for free text", () => {
    expect(valuesEqual("publication_date", "2026-03-12", "2026-03-13")).toBe(false);
    expect(valuesEqual("report_title", "Northstar Operational Review", "northstar operational review.")).toBe(true);
    expect(valuesEqual("monetary_amounts[0].amount", 1250000, 1250000.2)).toBe(true);
    expect(compareScalars(rec, { ...rec, report_number: "OPS-2026-005" }).filter((s) => !s.correct).map((s) => s.field)).toEqual(["report_number"]);
  });
  it("list micro-F1 counts partially correct items as errors", () => {
    const actual: ReportRecord = { ...rec, key_findings: [rec.key_findings[0]!, { text: "Finding 2: Two vendors missed SLA.", severity: "low" }, { text: "Finding 9: invented.", severity: "low" }] };
    const f1 = microF1(compareLists(rec, actual));
    expect(f1.tp).toBe(2); // finding 1 + the monetary amount
    expect(f1.fp).toBe(2);
    expect(f1.fn).toBe(1);
    expect(microF1(compareLists(rec, rec)).f1).toBe(1);
  });
  it("percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBe(0);
  });
});

const base = (over: Partial<AggregateMetrics["rag"]> = {}, ex: Partial<AggregateMetrics["extraction"]> = {}): AggregateMetrics => ({
  extraction: { scalar_exact_accuracy: 0.98, list_micro_f1: 0.95, evidence_validity: 0.99, classification_accuracy: 1, documents: 18, scalar_fields: 90, ...ex },
  review: { recall: 0.95, precision: 0.8, planted: 10, planted_caught: 9, routed: 12, below_threshold_missing: 0 },
  rag: { retrieval_recall_at_5: 0.95, citation_precision: 1, evidence_supported_rate: 1, refusal_accuracy: 1, semantic_score: 0.95, false_refusal_rate: 0, answer_cases: 32, refusal_cases: 8, retrieval_cases: 32, ...over },
  integrity: { duplicate_cases_passed: 2, duplicate_cases: 2, version_cases_passed: 2, version_cases: 2, duplicate_records: 0 },
  cost: { estimated_cost_usd: 0, input_tokens: 0, output_tokens: 0, latency_p50_ms: 1, latency_p95_ms: 2 },
  cases: { total: 1, passed: 1, failed: 0 },
});

describe("regression rules", () => {
  it("passes without a baseline and with small drops", () => {
    expect(evaluateRegression(base(), null, null).passed).toBe(true);
    expect(evaluateRegression(base({}, { scalar_exact_accuracy: 0.965 }), base(), "b").passed).toBe(true);
  });
  it("fails on hard thresholds", () => {
    expect(evaluateRegression(base({}, { scalar_exact_accuracy: 0.95 }), base(), "b").checks.find((c) => c.metric === "extraction.scalar_exact_accuracy")!.passed).toBe(false);
    expect(evaluateRegression(base({}, { evidence_validity: 0.975 }), base(), "b").passed).toBe(false);
    expect(evaluateRegression(base({ refusal_accuracy: 0.9 }), null, null).passed).toBe(false);
    expect(evaluateRegression(base({ semantic_score: 0.89 }), null, null).passed).toBe(false);
    expect(evaluateRegression(base({ retrieval_recall_at_5: 0.91 }), base(), "b").passed).toBe(false);
    const m = base();
    m.integrity.version_cases_passed = 1;
    expect(evaluateRegression(m, null, null).passed).toBe(false);
  });
});
