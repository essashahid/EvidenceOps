import { describe, expect, it } from "vitest";
import { parseCitations } from "@/lib/rag/answer";
import type { RetrievedChunk } from "@/lib/rag/retrieve";

const chunk = (over: Partial<RetrievedChunk>): RetrievedChunk => ({
  chunkId: "c1",
  documentVersionId: "dv",
  documentId: "d",
  displayName: "Northstar",
  logicalKey: "OPS-2026-004",
  versionNumber: 2,
  isCurrent: true,
  chunkIndex: 0,
  text: "",
  startLocator: "SRC-OPS-2026-004-V2-P03",
  endLocator: "SRC-OPS-2026-004-V2-P04",
  humanLocator: "page 3",
  locatorRange: ["page 3", "page 4"],
  similarity: 0.5,
  lexical: 0.5,
  combined: 0.5,
  ...over,
});

describe("citation parsing and validation", () => {
  it("resolves [KEY vN locator] citations against the retrieved set and rejects the rest", () => {
    const retrieved = [chunk({})];
    const text = "The revised cost is $1.15 million [OPS-2026-004 v2 page 4]. Another claim [OPS-2026-004 v1 page 3]. Unknown [XYZ-1 v1 page 9].";
    const c = parseCitations(text, retrieved);
    expect(c).toHaveLength(3);
    expect(c[0]!.valid).toBe(true);
    expect(c[0]!.supportedClaim).toContain("$1.15 million");
    expect(c[1]!.valid).toBe(false); // superseded version was not retrieved
    expect(c[2]!.valid).toBe(false);
  });
  it("returns nothing for a refusal or uncited text", () => {
    expect(parseCitations("Insufficient evidence in the indexed corpus.", [chunk({})])).toHaveLength(0);
  });
});

it("retains every claim before a citation and shares the claim across adjacent citations", () => {
  const citations = parseCitations("Uncited first claim. A second claim [OPS-2026-004 v2 page 3] [OPS-2026-004 v2 page 4].", [chunk({})]);
  expect(citations[0]!.supportedClaim).toContain("Uncited first claim");
  expect(citations[1]!.supportedClaim).toBe(citations[0]!.supportedClaim);
});
