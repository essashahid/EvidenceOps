import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { fixture, seeded, uploadAndProcess } from "./helpers";
import { retrieve } from "@/lib/rag/retrieve";
import { askQuestion } from "@/lib/rag/answer";

let workspaceId = "";
let adminId = "";

beforeAll(async () => {
  const seed = await seeded();
  workspaceId = seed.workspaceId;
  adminId = seed.adminId;
  for (const f of ["OPS-2026-004-v1-northstar-operational-review.pdf", "OPS-2026-004-v2-northstar-operational-review-corrected.pdf", "OPS-2026-013-v1-harbor-point-warehouse-review.pdf"]) {
    const { result } = await uploadAndProcess(f, fixture(`documents/${f}`));
    expect(["completed", "completed_with_review"]).toContain(result.run?.status);
  }
});

describe("hybrid retrieval and evidence-bound answers", () => {
  it("retrieves only current versions by default and superseded ones on request", async () => {
    const r = await retrieve({ workspaceId, query: "Northstar Distribution operational review program cost", topK: 8 });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.every((c) => c.isCurrent)).toBe(true);
    expect(r.results.some((c) => c.logicalKey === "OPS-2026-004" && c.versionNumber === 2)).toBe(true);
    const all = await retrieve({ workspaceId, query: "Northstar Distribution operational review program cost", topK: 16, includeSuperseded: true });
    expect(all.results.some((c) => c.versionNumber === 1)).toBe(true);
    for (const c of r.results) {
      expect(c.combined).toBeGreaterThanOrEqual(0);
      expect(c.combined).toBeLessThanOrEqual(1);
    }
  });

  it("answers with verbatim citations tied to source blocks and stores everything", async () => {
    const a = await askQuestion({ workspaceId, userId: adminId, question: "What is the total Dock Optimization Program cost to date according to the current Northstar operational review?", mode: "answer" });
    expect(a.sufficient).toBe(true);
    expect(a.answerText).toContain("1.15 million");
    expect(a.citations.every((c) => c.valid)).toBe(true);
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.storedCitations[0]!.sourceLocator).toMatch(/^SRC-/);
    const [stored] = await getDb().select().from(schema.ragAnswers).where(eq(schema.ragAnswers.id, a.answerId));
    expect(stored!.sufficientEvidence).toBe(true);
    expect((stored!.retrievedJson as unknown[]).length).toBeGreaterThan(0);
    const [q] = await getDb().select().from(schema.ragQueries).where(eq(schema.ragQueries.id, a.queryId));
    expect(q!.queryEmbedding).toHaveLength(768);
  });

  it("refuses questions the corpus cannot answer", async () => {
    const a = await askQuestion({ workspaceId, userId: adminId, question: "What dividend did Zephyr Holdings declare in 2019?", mode: "answer" });
    expect(a.sufficient).toBe(false);
    expect(a.refusalReason).toBeTruthy();
    expect(a.citations).toHaveLength(0);
  });

  it("produces evidence-bound drafts", async () => {
    const d = await askQuestion({ workspaceId, userId: adminId, question: "Harbor Point warehouse review", mode: "executive_brief" });
    expect(d.sufficient).toBe(true);
    expect(d.answerText).toContain("Evidence Limitations");
    expect(d.citations.length).toBeGreaterThan(0);
    expect(d.citations.every((c) => c.valid)).toBe(true);
  });
});
