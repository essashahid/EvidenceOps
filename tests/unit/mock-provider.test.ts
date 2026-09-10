import { describe, expect, it } from "vitest";
import { createMockProvider, hashedEmbedding, parseAmounts, parseDates } from "@/lib/llm/mock";
import { INSUFFICIENT_EVIDENCE } from "@/lib/config";

describe("mock provider helpers", () => {
  it("parses money and dates in common phrasings, including '4 Sept. 26'", () => {
    expect(parseAmounts("The revised program cost is $1.25 million.")).toContain(1250000);
    expect(parseAmounts("USD 480,000 was spent")).toContain(480000);
    expect(parseDates("Published 12 March 2026")).toEqual(["2026-03-12"]);
    expect(parseDates("4 Sept. 26")).toEqual(["2026-09-04"]);
    expect(parseDates("March 3, 2026 and 2026-01-09")).toEqual(["2026-01-09", "2026-03-03"]);
  });
  it("embeddings are deterministic, unit length and lexical", () => {
    const a = hashedEmbedding("revised program cost million", 768);
    expect(a).toEqual(hashedEmbedding("revised program cost million", 768));
    expect(Math.sqrt(a.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 3);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * (y[i] ?? 0), 0);
    expect(dot(a, hashedEmbedding("what is the revised program cost", 768))).toBeGreaterThan(dot(a, hashedEmbedding("port authority dredging schedule", 768)));
  });
  it("verifier is rule based: supports quotes that state the value and rejects missing quotes", async () => {
    const p = createMockProvider();
    const ctx = [{ source_block_id: "L", locator: "page 1", text: "The revised program cost is $1.25 million." }];
    const { outcomes } = await p.verify([
      { fieldPath: "monetary_amounts[0]", fieldDefinition: "", candidateValue: { amount: 1250000, currency: "USD", context: "cost" }, evidence: [{ source_block_id: "L", quote: "The revised program cost is $1.25 million.", found_in_block: true }], context: ctx },
      { fieldPath: "monetary_amounts[0]", fieldDefinition: "", candidateValue: { amount: 999, currency: "USD", context: "cost" }, evidence: [{ source_block_id: "L", quote: "The revised program cost is $1.25 million.", found_in_block: true }], context: ctx },
      { fieldPath: "report_title", fieldDefinition: "", candidateValue: "X", evidence: [{ source_block_id: "L", quote: "nope", found_in_block: false }], context: ctx },
    ]);
    expect(outcomes[0]!.status).toBe("supported");
    expect(outcomes[0]!.evidenceSpecificity).toBe(1);
    expect(outcomes[1]!.status).toBe("partially_supported");
    expect((outcomes[1]!.correctedValue as { amount: number }).amount).toBe(1250000);
    expect(outcomes[1]!.contradictionDetected).toBe(true);
    expect(outcomes[2]!.status).toBe("unsupported");
  });
  it("answers extractively with spec-format citations and refuses when the entities are absent", async () => {
    const p = createMockProvider();
    const blocks = [{ retrievalId: 0, chunkId: "c", logicalKey: "OPS-2026-004", version: 1, locator: "page 2", document: "Northstar", isCurrent: true, text: "Background. The revised program cost is $1.25 million. Other text." }];
    const yes = await p.answer({ question: "What is the revised program cost?", mode: "answer", blocks });
    expect(yes.text).toContain("$1.25 million");
    expect(yes.text).toContain("[OPS-2026-004 v1 page 2]");
    const no = await p.answer({ question: "What did Zephyr Holdings report about hatchery capacity in 2019?", mode: "answer", blocks });
    expect(no.text).toBe(INSUFFICIENT_EVIDENCE);
  });
  it("judge scores three dimensions and rewards refusals only for unanswerable questions", async () => {
    const p = createMockProvider();
    const refusal = await p.judge({ question: "q", expectedAnswer: INSUFFICIENT_EVIDENCE, candidateAnswer: INSUFFICIENT_EVIDENCE, sourceEvidence: "", unanswerable: true });
    expect(refusal.correctness).toBe(1);
    expect(refusal.passed).toBe(true);
    const wrong = await p.judge({ question: "q", expectedAnswer: "$1.25 million", candidateAnswer: INSUFFICIENT_EVIDENCE, sourceEvidence: "", unanswerable: false });
    expect(wrong.correctness).toBe(0);
    const good = await p.judge({ question: "q", expectedAnswer: "$1.25 million", candidateAnswer: "The revised program cost is $1.25 million. [OPS v1 page 2]", sourceEvidence: "The revised program cost is $1.25 million.", unanswerable: false });
    expect(good.correctness).toBe(1);
    expect(good.evidenceSupport).toBe(1);
    expect(good.passed).toBe(true);
  });
});
