import { describe, expect, it } from "vitest";
import { combine, scoreField } from "@/lib/pipeline/confidence";
import type { FieldValidation } from "@/lib/pipeline/validate";
import type { VerifyOutcome } from "@/lib/llm/types";

const validation = (over: Partial<FieldValidation> = {}): FieldValidation => ({
  fieldPath: "f",
  messages: [],
  deterministicScore: 1,
  evidenceExactMatch: 1,
  locatorExists: true,
  sourceBlockId: "b",
  quoteStart: 0,
  quoteEnd: 5,
  ...over,
});
const verify = (over: Partial<VerifyOutcome> = {}): VerifyOutcome => ({
  fieldPath: "f",
  status: "supported",
  correctedValue: "x",
  agreement: "same",
  contradiction: false,
  specificity: "direct",
  reason: "",
  ...over,
});

describe("confidence formula", () => {
  it("weights components 0.30/0.20/0.25/0.15/0.10", () => {
    expect(combine({ evidence_exact_match: 1, deterministic_validation: 1, verifier_support: 1, cross_pass_agreement: 1, evidence_specificity: 1 })).toBe(1);
    expect(combine({ evidence_exact_match: 1, deterministic_validation: 1, verifier_support: 0.5, cross_pass_agreement: 0, evidence_specificity: 1 })).toBe(0.725);
    expect(combine({ evidence_exact_match: 0, deterministic_validation: 0.5, verifier_support: 0, cross_pass_agreement: 0, evidence_specificity: 0 })).toBe(0.1);
  });
  it("matches the spec sample record (partially supported, different value) and routes to review", () => {
    const s = scoreField(validation(), verify({ status: "partially_supported", agreement: "different", specificity: "direct" }), false, false);
    expect(s.confidence).toBe(0.725);
    expect(s.routing).toBe("review");
  });
});

describe("routing", () => {
  it("auto-approves at or above 0.86 with no contradiction", () => {
    expect(scoreField(validation(), verify(), true, false).routing).toBe("auto_approved");
    const s = scoreField(validation({ deterministicScore: 0.5 }), verify({ specificity: "contextual" }), false, false);
    expect(s.confidence).toBe(0.875);
    expect(s.routing).toBe("auto_approved");
  });
  it("sends partially supported values to review even when confidence is high", () => {
    const s = scoreField(validation(), verify({ status: "partially_supported" }), false, false);
    expect(s.confidence).toBe(0.875);
    expect(s.routing).toBe("review");
  });
  it("blocks contradictions, unsupported values, unknown locators, empty required fields and low confidence", () => {
    expect(scoreField(validation(), verify({ contradiction: true }), false, false).routing).toBe("blocked");
    expect(scoreField(validation(), verify({ status: "unsupported", specificity: "none", agreement: "different" }), false, false).routing).toBe("blocked");
    expect(scoreField(validation({ locatorExists: false, sourceBlockId: null, deterministicScore: 0 }), verify(), false, false).routing).toBe("blocked");
    expect(scoreField(validation(), verify(), true, true).routing).toBe("blocked");
    const low = scoreField(validation({ evidenceExactMatch: 0, deterministicScore: 0.5 }), verify({ status: "partially_supported", agreement: "different", specificity: "weak" }), false, false);
    expect(low.confidence).toBeLessThan(0.65);
    expect(low.routing).toBe("blocked");
  });
  it("routes mid confidence to review", () => {
    const s = scoreField(validation({ evidenceExactMatch: 0, deterministicScore: 0.5 }), verify(), false, false);
    expect(s.confidence).toBe(0.6);
    expect(s.routing).toBe("blocked");
    const s2 = scoreField(validation({ evidenceExactMatch: 0 }), verify(), false, false);
    expect(s2.confidence).toBe(0.7);
    expect(s2.routing).toBe("review");
  });
});
