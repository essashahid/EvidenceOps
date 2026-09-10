import { describe, expect, it } from "vitest";
import { agreementScore, combine, scoreField, specificityScore } from "@/lib/pipeline/confidence";
import type { FieldValidation } from "@/lib/pipeline/validate";
import type { VerifyOutcome } from "@/lib/llm/types";

const validation = (over: Partial<FieldValidation> = {}): FieldValidation => ({ fieldPath: "f", messages: [], deterministicScore: 1, evidenceExactMatch: 1, locatorsExist: true, evidence: [{ quote: "q", sourceBlockId: "b", locator: "L", exactMatch: true, quoteStart: 0, quoteEnd: 1 }], ...over });
const verify = (over: Partial<VerifyOutcome> = {}): VerifyOutcome => ({ fieldPath: "f", status: "supported", correctedValue: null, contradictionDetected: false, evidenceSpecificity: 1, reason: "", ...over });

describe("confidence formula", () => {
  it("weights components 0.30/0.20/0.25/0.15/0.10", () => {
    expect(combine({ evidence_exact_match: 1, deterministic_validation: 1, verifier_support: 1, cross_pass_agreement: 1, evidence_specificity: 1 })).toBe(1);
    expect(combine({ evidence_exact_match: 1, deterministic_validation: 1, verifier_support: 0.5, cross_pass_agreement: 0, evidence_specificity: 1 })).toBe(0.725);
  });
  it("uses verifier specificity directly", () => {
    expect(specificityScore(0.8)).toBe(0.8);
    expect(specificityScore(0.3)).toBe(0.3);
    expect(specificityScore(0.1)).toBe(0.1);
  });
  it("cross-pass agreement normalizes deterministic fields before comparing", () => {
    expect(agreementScore("publication_date", "2026-03-12", null, "supported")).toBe(1);
    expect(agreementScore("publication_date", "2026-03-12", "2026-03-12", "supported")).toBe(1);
    expect(agreementScore("report_title", "Northstar Review", "northstar review", "supported")).toBe(0.75);
    expect(agreementScore("monetary_amounts[0]", { amount: 1250000, currency: "USD", context: "cost" }, { amount: 1150000, currency: "USD", context: "cost" }, "partially_supported")).toBe(0);
    expect(agreementScore("monetary_amounts[0]", { amount: 1250000, currency: "USD", context: "cost" }, { amount: 1250000, currency: "USD", context: "program cost" }, "supported")).toBe(0);
    expect(agreementScore("report_title", "A", null, "unsupported")).toBe(0);
  });
});

describe("routing", () => {
  it("auto-approves at or above 0.86 with no contradiction, support and passing validation", () => {
    expect(scoreField(validation(), verify(), "x").routing).toBe("auto_approved");
    const s = scoreField(validation({ deterministicScore: 0.5 }), verify({ evidenceSpecificity: 0.75 }), "x");
    expect(s.confidence).toBe(0.875);
    expect(s.routing).toBe("auto_approved");
  });
  it("sends partially supported values and failed validation to review", () => {
    const s = scoreField(validation(), verify({ status: "partially_supported" }), "x");
    expect(s.confidence).toBe(0.875);
    expect(s.routing).toBe("review");
    expect(scoreField(validation({ deterministicScore: 0 }), verify(), "x").routing).toBe("review");
  });
  it("blocks contradictions, unsupported values, unknown locators, missing quotes and low confidence", () => {
    expect(scoreField(validation(), verify({ contradictionDetected: true, correctedValue: "y" }), "x").routing).toBe("blocked");
    expect(scoreField(validation(), verify({ status: "unsupported", evidenceSpecificity: 0 }), "x").routing).toBe("blocked");
    expect(scoreField(validation({ locatorsExist: false, deterministicScore: 0 }), verify(), "x").routing).toBe("blocked");
    expect(scoreField(validation({ evidenceExactMatch: 0, deterministicScore: 0.5 }), verify(), "x").routing).toBe("blocked");
    const low = scoreField(validation({ evidenceExactMatch: 0, deterministicScore: 0.5 }), verify({ status: "partially_supported", correctedValue: "different", evidenceSpecificity: 0.4 }), "x");
    expect(low.confidence).toBeLessThan(0.65);
    expect(low.routing).toBe("blocked");
  });
  it("matches the spec sample: partial support with a different corrected value scores 0.725 and is reviewed", () => {
    const s = scoreField(validation(), verify({ status: "partially_supported", correctedValue: { amount: 1150000, currency: "USD", context: "program cost" } }), { amount: 1250000, currency: "USD", context: "program cost" });
    expect(s.confidence).toBe(0.725);
    expect(s.routing).toBe("review");
  });
});
