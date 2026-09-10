import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { createProcessingRun, registerUpload } from "@/lib/pipeline/ingest";
import { runProcessingRunInline } from "@/lib/pipeline/orchestrate";
import { llmCallsFor, makePdf, noSleep, runRow, seeded, stepsFor, uploadAndProcess } from "./helpers";

const REPORT = ["Harbor Smoke Operational Review", "Report No. SMK-2026-101", "Issued by Harbor Smoke Authority.", "Published 12 March 2026", "The revised program cost is $1.25 million."];

describe("durable pipeline", () => {
  it("marks a failed step, retries, resumes without re-parsing, and completes", async () => {
    const bytes = await makePdf(REPORT);
    const { run, result } = await uploadAndProcess("SMK-2026-101-harbor.pdf", bytes, { injectFailure: { step: "extract", attempts: 2 } });
    expect(result.run?.status).toBe("completed");
    const steps = await stepsFor(run.id);
    const byName = Object.fromEntries(steps.map((s) => [s.stepName, s]));
    expect(byName.parse!.attemptCount).toBe(1);
    expect(byName.parse!.status).toBe("succeeded");
    expect(byName.extract!.attemptCount).toBe(3);
    expect(byName.extract!.status).toBe("succeeded");
    expect((await runRow(run.id)).retries).toBe(2);
    const events = await getDb().select().from(schema.runEvents).where(eq(schema.runEvents.processingRunId, run.id));
    expect(events.filter((e) => e.eventType === "step.failed")).toHaveLength(2);
    // Only one paid extraction call happened despite the retries (the failure was injected before the model call).
    expect((await llmCallsFor(run.id)).filter((c) => c.purpose === "extract")).toHaveLength(1);
  });

  it("re-running the same version with the same model config reuses every step and makes no model calls", async () => {
    const seed = await seeded();
    const [version] = await getDb().select().from(schema.documentVersions).where(eq(schema.documentVersions.sourceFilename, "SMK-2026-101-harbor.pdf")).limit(1);
    const run2 = await createProcessingRun({ workspaceId: seed.workspaceId, userId: seed.adminId, runType: "reprocess", documentVersionIds: [version!.id] });
    const r = await runProcessingRunInline(run2.id, { sleep: noSleep });
    expect(r.run?.status).toBe("completed");
    expect(await llmCallsFor(run2.id)).toHaveLength(0);
    const events = await getDb().select().from(schema.runEvents).where(eq(schema.runEvents.processingRunId, run2.id));
    expect(events.filter((e) => e.eventType === "step.reused").map((e) => e.payloadJson.stepName)).toEqual(["parse", "chunk", "extract", "validate", "verify", "score_and_route", "embed"]);
    const records = await getDb().select().from(schema.recordVersions).where(eq(schema.recordVersions.documentVersionId, version!.id));
    expect(records).toHaveLength(1);
  });

  it("dead-letters after exhausting retries and can be retried by hand, reusing completed steps", async () => {
    const bytes = await makePdf([...REPORT.slice(0, 1), "Report No. SMK-2026-102", ...REPORT.slice(2)]);
    const { seed, run, result, up } = await uploadAndProcess("SMK-2026-102-harbor.pdf", bytes, { injectFailure: { step: "verify", attempts: 4 } });
    expect(result.run?.status).toBe("failed");
    const dead = await getDb().select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
    expect(dead).toHaveLength(1);
    expect(dead[0]!.failedStep).toBe("verify");
    expect(dead[0]!.attemptCount).toBe(4);
    const steps = await stepsFor(run.id);
    expect(steps.find((s) => s.stepName === "verify")!.status).toBe("dead_letter");
    expect(steps.find((s) => s.stepName === "extract")!.status).toBe("succeeded");
    // Clear the injected failure and retry: parse/chunk/extract/validate are reused, verify runs, run completes.
    await getDb().update(schema.processingRuns).set({ configJson: { documentVersionIds: [up.documentVersionId] } }).where(eq(schema.processingRuns.id, run.id));
    const { dispatchRetry } = await import("@/lib/jobs");
    const retry = await dispatchRetry(run.id, up.documentVersionId, "verify");
    expect(retry.outcome).toBe("completed");
    expect((await runRow(run.id)).status).toBe("completed");
    expect((await llmCallsFor(run.id)).filter((c) => c.purpose === "extract")).toHaveLength(1);
    expect(seed.workspaceId).toBeTruthy();
  });

  it("embedding failure leaves extraction usable and records a dead letter", async () => {
    const bytes = await makePdf([...REPORT.slice(0, 1), "Report No. SMK-2026-103", ...REPORT.slice(2)]);
    const { run, result, up } = await uploadAndProcess("SMK-2026-103-harbor.pdf", bytes, { injectFailure: { step: "embed", attempts: 4 } });
    expect(result.run?.status).toBe("completed");
    const [version] = await getDb().select().from(schema.documentVersions).where(eq(schema.documentVersions.id, up.documentVersionId));
    expect(version!.processingStatus).toBe("completed");
    const dead = await getDb().select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
    expect(dead.map((d) => d.failedStep)).toEqual(["embed"]);
    const chunks = await getDb().select().from(schema.chunks).where(eq(schema.chunks.documentVersionId, up.documentVersionId));
    expect(chunks.every((c) => c.embedding === null)).toBe(true);
  });
});

describe("duplicate and version handling", () => {
  it("rejects exact duplicates by hash and links corrected versions", async () => {
    const seed = await seeded();
    const v1 = await makePdf(["Version Test Review", "Report No. VER-2026-001", "Issued by Test Org.", "Published 1 May 2026", "Cost is $100,000."]);
    const first = await registerUpload({ workspaceId: seed.workspaceId, userId: seed.adminId, filename: "VER-2026-001-v1.pdf", bytes: v1 });
    expect(first.kind).toBe("created");
    const dup = await registerUpload({ workspaceId: seed.workspaceId, userId: seed.adminId, filename: "copy-of-VER-2026-001-v1.pdf", bytes: v1 });
    expect(dup.kind).toBe("duplicate");
    if (first.kind !== "created" || dup.kind !== "duplicate") throw new Error("unreachable");
    expect(dup.existingVersionId).toBe(first.documentVersionId);
    const v2 = await makePdf(["Version Test Review", "Report No. VER-2026-001-R1", "Issued by Test Org.", "Published 9 May 2026", "Cost is $110,000."]);
    const second = await registerUpload({ workspaceId: seed.workspaceId, userId: seed.adminId, filename: "VER-2026-001-v2-corrected.pdf", bytes: v2 });
    if (second.kind !== "created") throw new Error("expected new version");
    expect(second.documentId).toBe(first.documentId);
    expect(second.versionNumber).toBe(2);
    expect(second.supersedesVersionId).toBe(first.documentVersionId);
    const versions = await getDb().select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, first.documentId));
    expect(versions).toHaveLength(2);
    expect(versions.find((v) => v.versionNumber === 1)!.isCurrent).toBe(false);
    expect(versions.find((v) => v.versionNumber === 2)!.isCurrent).toBe(true);
  });

  it("rejects unsupported types, empty and oversized files before creating anything", async () => {
    const seed = await seeded();
    await expect(registerUpload({ workspaceId: seed.workspaceId, userId: null, filename: "x.txt", bytes: Buffer.from("hi") })).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(registerUpload({ workspaceId: seed.workspaceId, userId: null, filename: "x.pdf", bytes: Buffer.alloc(0) })).rejects.toMatchObject({ code: "empty" });
    await expect(registerUpload({ workspaceId: seed.workspaceId, userId: null, filename: "x.pdf", bytes: Buffer.alloc(10 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "too_large" });
  });
});
