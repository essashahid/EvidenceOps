import { describe, expect, it } from "vitest";
import { validateFields } from "@/lib/pipeline/validate";
import type { LeafField } from "@/lib/schema/report";

const blocks = new Map([["SRC-X-V1-P01", { id: "b1", normalizedText: "Northstar Review. Report No. OPS-1. Published 12 March 2026. The revised program cost is $1.25 million. Finding 1: Dock throughput fell. Severity: High." }]]);
const leaf = (fieldPath: string, value: unknown, quotes: string[], ids = ["SRC-X-V1-P01"], core = false): LeafField => ({ fieldPath, value, provenance: { source_block_ids: ids, evidence_quotes: quotes, ambiguity: null }, core });

describe("validateFields", () => {
  it("passes a clean field with exact evidence and records offsets", () => {
    const [v] = validateFields([leaf("report_number", "OPS-1", ["Report No. OPS-1."])], blocks);
    expect(v!.deterministicScore).toBe(1);
    expect(v!.evidenceExactMatch).toBe(1);
    expect(v!.evidence[0]!.sourceBlockId).toBe("b1");
    expect(v!.evidence[0]!.quoteStart).toBeGreaterThan(0);
  });
  it("accepts null values with no evidence (absent is legal)", () => {
    const [v] = validateFields([leaf("publication_date", null, [], [])], blocks);
    expect(v!.deterministicScore).toBe(1);
    expect(v!.messages).toHaveLength(0);
  });
  it("flags bad enums, dates, amounts, currencies and unknown locators as material failures", () => {
    const vs = validateFields(
      [
        leaf("document_type", "memo", ["Northstar Review."]),
        leaf("publication_date", "2026-13-40", ["Published 12 March 2026."]),
        leaf("monetary_amounts[0]", { amount: -5, currency: "USD", context: "cost" }, ["The revised program cost is $1.25 million."]),
        leaf("monetary_amounts[1]", { amount: 1250000, currency: "dollars", context: "cost" }, ["The revised program cost is $1.25 million."]),
        leaf("key_findings[0]", { finding: "Dock throughput fell.", severity: "critical" }, ["Finding 1: Dock throughput fell."]),
        leaf("report_title", "Northstar Review", ["Northstar Review."], ["SRC-X-V1-P09"]),
      ],
      blocks,
    );
    expect(vs.map((v) => v.deterministicScore)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(vs[0]!.messages.map((m) => m.code)).toContain("enum_invalid");
    expect(vs[1]!.messages.map((m) => m.code)).toContain("date_invalid");
    expect(vs[2]!.messages.map((m) => m.code)).toContain("amount_nonpositive");
    expect(vs[3]!.messages.map((m) => m.code)).toContain("currency_invalid");
    expect(vs[4]!.messages.map((m) => m.code)).toContain("severity_invalid");
    expect(vs[5]!.messages.map((m) => m.code)).toContain("evidence_locator_unknown");
    expect(vs[5]!.locatorsExist).toBe(false);
  });
  it("treats a missing quote and repeated list items as warnings (0.5) and zeroes the evidence component", () => {
    const vs = validateFields(
      [
        leaf("key_findings[0]", { finding: "Dock throughput fell.", severity: "high" }, ["This text is not in the block."]),
        leaf("key_findings[1]", { finding: "Dock throughput fell.", severity: "high" }, ["Finding 1: Dock throughput fell."]),
      ],
      blocks,
    );
    expect(vs[0]!.deterministicScore).toBe(0.5);
    expect(vs[0]!.evidenceExactMatch).toBe(0);
    expect(vs[1]!.messages.map((m) => m.code)).toContain("duplicate_item");
  });
  it("requires every quote of a multi-quote field to match", () => {
    const [v] = validateFields([leaf("report_title", "Northstar Review", ["Northstar Review.", "not present"])], blocks);
    expect(v!.evidenceExactMatch).toBe(0);
    expect(v!.evidence).toHaveLength(2);
  });
});
