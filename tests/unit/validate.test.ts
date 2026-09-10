import { describe, expect, it } from "vitest";
import { validateFields } from "@/lib/pipeline/validate";
import type { LeafField } from "@/lib/schema/report";

const blocks = new Map([
  ["SRC-X-V1-P01", { id: "b1", normalizedText: "Northstar Review. Report No. OPS-1. Published 12 March 2026. The revised program cost is $1.25 million. Finding 1: Severity: High." }],
]);
const leaf = (fieldPath: string, value: unknown, quote: string, locator = "SRC-X-V1-P01", required = false): LeafField => ({ fieldPath, value, evidence: { locator, quote }, required });

describe("validateFields", () => {
  it("passes a clean field with exact evidence", () => {
    const [v] = validateFields([leaf("report_number", "OPS-1", "Report No. OPS-1.", undefined, true)], blocks);
    expect(v!.deterministicScore).toBe(1);
    expect(v!.evidenceExactMatch).toBe(1);
    expect(v!.sourceBlockId).toBe("b1");
    expect(v!.quoteStart).toBeGreaterThan(0);
  });
  it("flags missing required fields, bad enums, bad dates and implausible amounts as errors", () => {
    const vs = validateFields(
      [
        leaf("report_title", "", "Northstar Review.", undefined, true),
        leaf("document_type", "memo", "Northstar Review."),
        leaf("publication_date", "2026-13-40", "Published 12 March 2026."),
        leaf("monetary_amounts[0].amount", -5, "The revised program cost is $1.25 million."),
        leaf("monetary_amounts[1].currency", "USD", "The revised program cost is $1.25 million.", "SRC-X-V1-P09"),
      ],
      blocks,
    );
    expect(vs.map((v) => v.deterministicScore)).toEqual([0, 0, 0, 0, 0]);
    expect(vs[0]!.messages.map((m) => m.code)).toContain("required_missing");
    expect(vs[1]!.messages.map((m) => m.code)).toContain("enum_invalid");
    expect(vs[2]!.messages.map((m) => m.code)).toContain("date_invalid");
    expect(vs[3]!.messages.map((m) => m.code)).toContain("amount_nonpositive");
    expect(vs[4]!.messages.map((m) => m.code)).toContain("evidence_locator_unknown");
    expect(vs[4]!.locatorExists).toBe(false);
  });
  it("treats a missing quote and duplicate list items as warnings (0.5)", () => {
    const vs = validateFields(
      [leaf("key_findings[0].text", "Finding 1", "This text is not in the block."), leaf("key_findings[1].text", "Finding 1", "Finding 1: Severity: High.")],
      blocks,
    );
    expect(vs[0]!.deterministicScore).toBe(0.5);
    expect(vs[0]!.evidenceExactMatch).toBe(0);
    expect(vs[1]!.messages.map((m) => m.code)).toContain("duplicate_item");
  });
});
