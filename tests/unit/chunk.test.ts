import { describe, expect, it } from "vitest";
import { chunkBlocks, countTokens } from "@/lib/pipeline/chunk";

function block(id: string, sentences: number) {
  const text = Array.from({ length: sentences }, (_, i) => `Sentence number ${i + 1} of block ${id} discusses operational findings and recommendations in detail.`).join(" ");
  return { id, locator: `SRC-T-V1-P${id}`, normalizedText: text };
}

describe("chunkBlocks", () => {
  it("produces chunks near the target size with overlap and block provenance", () => {
    const blocks = [block("01", 60), block("02", 60), block("03", 20)];
    const chunks = chunkBlocks(blocks, { targetTokens: 200, overlapTokens: 40 });
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(200 + 5);
      expect(c.startLocator).toMatch(/^SRC-T-V1-P0[123]$/);
      expect(c.textHash).toHaveLength(64);
    }
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    // overlap: consecutive chunks share text
    const a = chunks[0]!.text.split(". ");
    const b = chunks[1]!.text;
    expect(b.includes(a[a.length - 2]!)).toBe(true);
    // every sentence appears somewhere
    const all = chunks.map((c) => c.text).join(" ");
    for (const bl of blocks) for (const s of bl.normalizedText.split(". ")) expect(all.includes(s.replace(/\.$/, ""))).toBe(true);
  });
  it("never rewrites text and handles oversized sentences", () => {
    const huge = { id: "x", locator: "L", normalizedText: "word ".repeat(3000).trim() };
    const chunks = chunkBlocks([huge], { targetTokens: 100, overlapTokens: 10 });
    expect(chunks.length).toBeGreaterThan(10);
    expect(chunks.every((c) => countTokens(c.text) <= 110)).toBe(true);
  });
  it("returns no chunks for empty input", () => {
    expect(chunkBlocks([])).toEqual([]);
  });
});
