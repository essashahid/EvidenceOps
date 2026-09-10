import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { fixture, uploadAndProcess } from "./helpers";

describe("parse failure modes", () => {
  it("corrupt PDF becomes parse_failed and a non-retryable dead letter; the run fails loudly", async () => {
    const { run, result, up } = await uploadAndProcess("corrupt-fixture.pdf", fixture("extras/corrupt.pdf"));
    expect(result.run?.status).toBe("failed");
    const [v] = await getDb().select().from(schema.documentVersions).where(eq(schema.documentVersions.id, up.documentVersionId));
    expect(v!.parseStatus).toBe("failed");
    expect(v!.processingStatus).toBe("failed");
    const dead = await getDb().select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
    expect(dead).toHaveLength(1);
    expect(dead[0]!.errorCode).toBe("parse_failed");
    expect(dead[0]!.retryable).toBe(false);
  });

  it("corrupt DOCX becomes parse_failed", async () => {
    const { result, up } = await uploadAndProcess("corrupt-fixture.docx", fixture("extras/corrupt.docx"));
    expect(result.outcomes[up.documentVersionId]).toBe("failed");
  });

  it("scanned/image-only PDF is classified unsupported_scanned_document and routed to the manual queue", async () => {
    const { run, result, up } = await uploadAndProcess("scanned-fixture.pdf", fixture("extras/scanned-like.pdf"));
    expect(result.outcomes[up.documentVersionId]).toBe("unsupported");
    const [v] = await getDb().select().from(schema.documentVersions).where(eq(schema.documentVersions.id, up.documentVersionId));
    expect(v!.parseStatus).toBe("unsupported");
    expect(v!.processingStatus).toBe("unsupported");
    const dead = await getDb().select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
    expect(dead[0]!.errorCode).toBe("unsupported_scanned_document");
    const calls = await getDb().select().from(schema.llmCalls).where(eq(schema.llmCalls.processingRunId, run.id));
    expect(calls).toHaveLength(0);
  });
});
