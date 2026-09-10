import { describe, expect, it } from "vitest";
import { canonical, contentTokens, excerpt, findQuote, normalizeText } from "@/lib/text";

describe("normalizeText", () => {
  it("collapses whitespace and normalizes typographic punctuation without rewriting words", () => {
    expect(normalizeText("The  “revised”\n program\tcost is $1.25\r\nmillion – now.")).toBe('The "revised" program cost is $1.25 million - now.');
  });
  it("is idempotent", () => {
    const once = normalizeText("a   b\n\nc");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("findQuote", () => {
  const block = normalizeText("Summary. The revised program cost is $1.25 million. Appendix follows.");
  it("finds an exact normalized quote and returns offsets", () => {
    const hit = findQuote(block, "The revised program cost is $1.25 million.");
    expect(hit).toEqual({ start: 9, end: 51 });
    expect(block.slice(hit!.start, hit!.end)).toBe("The revised program cost is $1.25 million.");
  });
  it("tolerates whitespace and curly quotes in the quote", () => {
    expect(findQuote(block, "The revised   program cost is\n$1.25 million.")).not.toBeNull();
  });
  it("returns null for paraphrases", () => {
    expect(findQuote(block, "The program cost was revised to 1.25M")).toBeNull();
    expect(findQuote(block, "")).toBeNull();
  });
});

describe("canonical and tokens", () => {
  it("compares values case and punctuation insensitively", () => {
    expect(canonical("Northstar Distribution, Inc.")).toBe("northstar distribution inc.");
    expect(contentTokens("What is the revised program cost?")).toEqual(["revised", "program", "cost"]);
  });
  it("excerpt returns bounded context", () => {
    const e = excerpt("0123456789".repeat(100), 500, 510, 20);
    expect(e.before).toHaveLength(20);
    expect(e.match).toHaveLength(10);
    expect(e.after).toHaveLength(20);
  });
});
