import { describe, expect, it } from "vitest";
import { createMockProvider, hashedEmbedding, parseAmounts, parseDates } from "@/lib/llm/mock";

describe("mock provider helpers", () => {
  it("parses money and dates in common phrasings", () => {
    expect(parseAmounts("The revised program cost is $1.25 million.")).toContain(1250000);
    expect(parseAmounts("USD 480,000 was spent")).toContain(480000);
    expect(parseAmounts("about 1.15m")).toContain(1150000);
    expect(parseDates("Published 12 March 2026")).toEqual(["2026-03-12"]);
    expect(parseDates("March 3, 2026 and 2026-01-09")).toEqual(["2026-01-09", "2026-03-03"]);
  });
  it("embeddings are deterministic, unit length and lexical", () => {
    const a = hashedEmbedding("revised program cost million", 768);
    const b = hashedEmbedding("revised program cost million", 768);
    const c = hashedEmbedding("port authority dredging schedule", 768);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 3);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(dot(a, hashedEmbedding("what is the revised program cost", 768))).toBeGreaterThan(dot(a, c));
  });
  it("verifier is rule based: supports quotes that state the value and rejects missing quotes", async () => {
    const p = createMockProvider();
    const { outcomes } = await p.verify([
      { fieldPath: "monetary_amounts[0].amount", fieldDefinition: "", candidateValue: 1250000, evidence: { locator: "L", quote: "The revised program cost is $1.25 million." }, blockText: "The revised program cost is $1.25 million.", quoteFound: true },
      { fieldPath: "monetary_amounts[0].amount", fieldDefinition: "", candidateValue: 999, evidence: { locator: "L", quote: "The revised program cost is $1.25 million." }, blockText: "The revised program cost is $1.25 million.", quoteFound: true },
      { fieldPath: "report_title", fieldDefinition: "", candidateValue: "X", evidence: { locator: "L", quote: "nope" }, blockText: "Something else", quoteFound: false },
    ]);
    expect(outcomes[0]!.status).toBe("supported");
    expect(outcomes[1]!.status).toBe("partially_supported");
    expect(outcomes[1]!.correctedValue).toBe(1250000);
    expect(outcomes[1]!.contradiction).toBe(true);
    expect(outcomes[2]!.status).toBe("unsupported");
  });
  it("answers extractively with citations and refuses when required entities are absent", async () => {
    const p = createMockProvider();
    const chunks = [{ index: 0, chunkId: "c", documentName: "Northstar", logicalKey: "OPS", versionNumber: 1, startLocator: "A", endLocator: "A", text: "Background. The revised program cost is $1.25 million. Other text." }];
    const yes = await p.answer({ question: "What is the revised program cost?", mode: "answer", chunks });
    expect(yes.sufficient).toBe(true);
    expect(yes.claims[0]!.citations[0]!.quote).toContain("$1.25 million");
    const no = await p.answer({ question: "What did Zephyr Holdings report in 2019?", mode: "answer", chunks });
    expect(no.sufficient).toBe(false);
  });
});
