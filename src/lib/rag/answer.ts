import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getLlm } from "@/lib/llm";
import { ANSWER_PROMPT_VERSION, DRAFT_PROMPT_VERSION, RETRIEVAL } from "@/lib/config";
import { estimateCostUsd } from "@/lib/config";
import { findQuote, normalizeText } from "@/lib/text";
import type { AnswerClaim, AnswerResult } from "@/lib/llm/types";
import type { AnswerMode } from "@/lib/db/schema";
import { recordLlmCall } from "@/lib/pipeline/llm-log";
import { retrieve, type RetrievedChunk } from "./retrieve";

export type AskInput = {
  workspaceId: string;
  userId: string | null;
  question: string;
  mode?: AnswerMode;
  includeSuperseded?: boolean;
  processingRunId?: string | null;
};

export type ValidatedCitation = AnswerClaim["citations"][number] & { valid: boolean; chunkId: string | null; sourceLocator: string | null };
export type ValidatedClaim = Omit<AnswerClaim, "citations"> & { supported: boolean; citations: ValidatedCitation[] };

export type AskResult = {
  answerId: string;
  queryId: string;
  question: string;
  mode: AnswerMode;
  sufficient: boolean;
  refusalReason: string | null;
  answerText: string;
  claims: ValidatedClaim[];
  draft: AnswerResult["draft"];
  retrieved: RetrievedChunk[];
  citations: (typeof schema.answerCitations.$inferSelect)[];
  usage: { inputTokens: number; outputTokens: number; latencyMs: number; model: string; costUsd: number };
  unsupportedClaims: number;
};

/**
 * Evidence-bound answering. The model only sees retrieved chunks; every claim's citation is then
 * checked in code (the quote must occur verbatim in the cited chunk). Claims with no valid citation
 * are marked unsupported and excluded from the stored citations; an answer whose claims are all
 * unsupported is downgraded to a refusal.
 */
export async function askQuestion(input: AskInput): Promise<AskResult> {
  const db = getDb();
  const llm = getLlm();
  const mode: AnswerMode = input.mode ?? "answer";
  const started = Date.now();
  const retrieval = await retrieve({ workspaceId: input.workspaceId, query: input.question, includeSuperseded: input.includeSuperseded });
  const [query] = await db
    .insert(schema.ragQueries)
    .values({
      workspaceId: input.workspaceId,
      queryText: input.question,
      queryEmbedding: retrieval.queryEmbedding.length ? retrieval.queryEmbedding : null,
      includeSuperseded: Boolean(input.includeSuperseded),
      createdBy: input.userId,
    })
    .returning();
  await recordLlmCall(
    { workspaceId: input.workspaceId, processingRunId: input.processingRunId ?? null, provider: llm.name },
    "embed",
    { model: retrieval.usage.model, inputTokens: retrieval.usage.inputTokens, outputTokens: 0, latencyMs: 0 },
  );

  const chunks = retrieval.results;
  const strong = chunks.filter((c) => c.combined >= RETRIEVAL.minCombinedScore);
  let result: AnswerResult;
  if (strong.length === 0) {
    result = {
      sufficient: false,
      refusalReason: chunks.length === 0 ? "No indexed evidence matched the question." : "Retrieved evidence is too weak to answer.",
      answerText: "I cannot answer this from the indexed documents.",
      claims: [],
      draft: null,
      usage: { model: llm.models.answer, inputTokens: 0, outputTokens: 0, latencyMs: 0 },
    };
  } else {
    result = await llm.answer({
      question: input.question,
      mode,
      chunks: chunks.map((c, index) => ({
        index,
        chunkId: c.chunkId,
        documentName: c.displayName,
        logicalKey: c.logicalKey,
        versionNumber: c.versionNumber,
        startLocator: c.startLocator,
        endLocator: c.endLocator,
        text: c.text,
      })),
    });
    await recordLlmCall({ workspaceId: input.workspaceId, processingRunId: input.processingRunId ?? null, provider: llm.name }, mode === "answer" ? "answer" : "draft", result.usage, {
      promptVersion: mode === "answer" ? ANSWER_PROMPT_VERSION : DRAFT_PROMPT_VERSION,
    });
  }

  const validate = (claim: AnswerClaim): ValidatedClaim => {
    const citations = claim.citations.map((ci) => {
      const chunk = chunks[ci.chunkIndex];
      const valid = Boolean(chunk && findQuote(normalizeText(chunk.text), ci.quote));
      return { ...ci, valid, chunkId: chunk?.chunkId ?? null, sourceLocator: chunk?.startLocator ?? null };
    });
    return { ...claim, citations, supported: citations.some((c) => c.valid) };
  };
  const allClaims = [
    ...result.claims,
    ...(result.draft ? [...result.draft.key_evidence, ...result.draft.findings, ...result.draft.recommendations] : []),
  ];
  const seen = new Set<string>();
  const validated = allClaims
    .filter((c) => {
      const k = c.text.trim();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map(validate);
  const unsupported = validated.filter((c) => !c.supported).length;
  let sufficient = result.sufficient;
  let refusalReason = result.refusalReason;
  if (sufficient && validated.length > 0 && unsupported === validated.length) {
    sufficient = false;
    refusalReason = "The model's claims could not be tied to verbatim evidence in the retrieved chunks.";
  }

  const cost = estimateCostUsd(result.usage.model, result.usage.inputTokens, result.usage.outputTokens);
  const [answer] = await db
    .insert(schema.ragAnswers)
    .values({
      ragQueryId: query!.id,
      mode,
      answerText: sufficient ? result.answerText : result.answerText || "I cannot answer this from the indexed documents.",
      answerJson: { claims: validated, draft: result.draft, unsupportedClaims: unsupported },
      sufficientEvidence: sufficient,
      refusalReason: sufficient ? null : refusalReason,
      retrievedJson: chunks.map((c) => ({ chunkId: c.chunkId, documentVersionId: c.documentVersionId, logicalKey: c.logicalKey, versionNumber: c.versionNumber, similarity: c.similarity, lexical: c.lexical, combined: c.combined, startLocator: c.startLocator, endLocator: c.endLocator })),
      model: result.usage.model,
      promptVersion: mode === "answer" ? ANSWER_PROMPT_VERSION : DRAFT_PROMPT_VERSION,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - started,
      estimatedCostUsd: cost.toFixed(6),
    })
    .returning();

  // Persist valid citations, resolving the precise source block inside the chunk span.
  const citationRows: (typeof schema.answerCitations.$inferInsert)[] = [];
  let order = 0;
  for (const claim of validated) {
    for (const ci of claim.citations) {
      if (!ci.valid || !ci.chunkId) continue;
      const chunk = chunks[ci.chunkIndex]!;
      const block = await locateBlock(chunk, ci.quote);
      citationRows.push({
        ragAnswerId: answer!.id,
        chunkId: chunk.chunkId,
        sourceBlockId: block?.id ?? null,
        documentVersionId: chunk.documentVersionId,
        sourceLocator: block?.locator ?? chunk.startLocator,
        citationOrder: order++,
        supportedClaim: claim.text,
        quoteText: ci.quote,
        similarityScore: chunk.similarity.toFixed(5),
        lexicalScore: chunk.lexical.toFixed(5),
        combinedScore: chunk.combined.toFixed(5),
      });
    }
  }
  const citations = citationRows.length ? await db.insert(schema.answerCitations).values(citationRows).returning() : [];

  return {
    answerId: answer!.id,
    queryId: query!.id,
    question: input.question,
    mode,
    sufficient,
    refusalReason: sufficient ? null : refusalReason,
    answerText: answer!.answerText,
    claims: validated,
    draft: result.draft,
    retrieved: chunks,
    citations,
    usage: { ...result.usage, costUsd: cost },
    unsupportedClaims: unsupported,
  };
}

/** Find the source block within the chunk's span that contains the quote. */
async function locateBlock(chunk: RetrievedChunk, quote: string) {
  const db = getDb();
  const [startBlock] = await db.select().from(schema.sourceBlocks).where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), eq(schema.sourceBlocks.locator, chunk.startLocator))).limit(1);
  const [endBlock] = await db.select().from(schema.sourceBlocks).where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), eq(schema.sourceBlocks.locator, chunk.endLocator))).limit(1);
  if (!startBlock) return null;
  const blocks = await db
    .select()
    .from(schema.sourceBlocks)
    .where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), gte(schema.sourceBlocks.blockIndex, startBlock.blockIndex), lte(schema.sourceBlocks.blockIndex, endBlock?.blockIndex ?? startBlock.blockIndex)))
    .orderBy(asc(schema.sourceBlocks.blockIndex));
  return blocks.find((b) => findQuote(b.normalizedText, quote)) ?? startBlock;
}

export async function getAnswer(answerId: string) {
  const db = getDb();
  const [row] = await db
    .select({ answer: schema.ragAnswers, query: schema.ragQueries })
    .from(schema.ragAnswers)
    .innerJoin(schema.ragQueries, eq(schema.ragQueries.id, schema.ragAnswers.ragQueryId))
    .where(eq(schema.ragAnswers.id, answerId))
    .limit(1);
  if (!row) return null;
  const citations = await db.select().from(schema.answerCitations).where(eq(schema.answerCitations.ragAnswerId, answerId)).orderBy(asc(schema.answerCitations.citationOrder));
  return { ...row, citations };
}
