import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { estimateCostUsd } from "@/lib/config";
import type { LlmUsage } from "@/lib/llm/types";

export type LlmCallPurpose = (typeof schema.llmCalls.$inferInsert)["purpose"];

/** Persist one model call and roll its tokens/cost into the owning processing run. */
export async function recordLlmCall(
  ctx: { workspaceId: string; processingRunId?: string | null; documentVersionId?: string | null; provider: string },
  purpose: LlmCallPurpose,
  usage: LlmUsage,
  opts: { promptVersion?: string; idempotencyKey?: string; cacheHit?: boolean } = {},
) {
  const db = getDb();
  const cost = estimateCostUsd(usage.model, usage.inputTokens, usage.outputTokens);
  await db.insert(schema.llmCalls).values({
    workspaceId: ctx.workspaceId,
    processingRunId: ctx.processingRunId ?? null,
    documentVersionId: ctx.documentVersionId ?? null,
    purpose,
    provider: ctx.provider,
    model: usage.model,
    promptVersion: opts.promptVersion ?? null,
    idempotencyKey: opts.idempotencyKey ?? null,
    cacheHit: opts.cacheHit ?? false,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    latencyMs: usage.latencyMs,
    costUsd: cost.toFixed(6),
  });
  if (ctx.processingRunId) {
    const isEmbed = purpose === "embed";
    await db
      .update(schema.processingRuns)
      .set({
        inputTokens: isEmbed ? schema.processingRuns.inputTokens : sql`${schema.processingRuns.inputTokens} + ${usage.inputTokens}`,
        outputTokens: isEmbed ? schema.processingRuns.outputTokens : sql`${schema.processingRuns.outputTokens} + ${usage.outputTokens}`,
        embeddingTokens: isEmbed ? sql`${schema.processingRuns.embeddingTokens} + ${usage.inputTokens}` : schema.processingRuns.embeddingTokens,
        estimatedCostUsd: sql`${schema.processingRuns.estimatedCostUsd} + ${cost.toFixed(6)}::numeric`,
      })
      .where(eq(schema.processingRuns.id, ctx.processingRunId));
  }
  return cost;
}
