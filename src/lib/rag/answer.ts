import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getLlm } from "@/lib/llm";
import { DRAFT_PROMPT_VERSION, INSUFFICIENT_EVIDENCE, RAG_PROMPT_VERSION, RETRIEVAL, estimateCostUsd } from "@/lib/config";
import { canonical, normalizeText } from "@/lib/text";
import { humanLocator } from "@/lib/llm/prompts";
import type { AnswerMode } from "@/lib/db/schema";
import { recordLlmCall } from "@/lib/pipeline/llm-log";
import { retrieve, type RetrievedChunk } from "./retrieve";

export type AskInput = { workspaceId: string; userId: string | null; question: string; mode?: AnswerMode; includeSuperseded?: boolean; processingRunId?: string | null };

export type ParsedCitation = {
  raw: string;
  logicalKey: string;
  version: number;
  locator: string;
  /** The retrieved chunk this citation resolves to, or null when it does not match the supplied set. */
  chunk: RetrievedChunk | null;
  valid: boolean;
  supportedClaim: string;
};

export type AskResult = {
  answerId: string;
  queryId: string;
  question: string;
  mode: AnswerMode;
  sufficient: boolean;
  refusalReason: string | null;
  answerText: string;
  citations: ParsedCitation[];
  storedCitations: (typeof schema.answerCitations.$inferSelect)[];
  retrieved: RetrievedChunk[];
  usage: { inputTokens: number; outputTokens: number; latencyMs: number; model: string; costUsd: number };
  invalidCitations: number;
};

const CITATION_RE = /\[([A-Z0-9][A-Z0-9-]*)\s+v(\d+)\s+([^\]]+?)\]/g;

/** Parse [KEY vN locator] citations and resolve each against the retrieved set (spec section 27). */
export function parseCitations(text: string, retrieved: RetrievedChunk[]): ParsedCitation[] {
  const out: ParsedCitation[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(CITATION_RE.source, "g");
  while ((m = re.exec(text))) {
    const logicalKey = m[1]!;
    const version = Number(m[2]);
    const locator = m[3]!.trim();
    const segment = text.slice(lastIndex, m.index).replace(/\[[^\]]*\]/g, "");
    const claim = segment.split("\n").filter(line => !/^(?:#{1,3}\s*)?(?:Title|Executive Summary|Key Findings|Recommendations(?: Stated in the Sources)?|Risks \/ Contradictions|Evidence Limitations|Supporting Evidence|Target Entity|Unresolved Ambiguities|Findings Summary|Executive Brief:.*|Recommendation Summary:.*)\s*$/i.test(line.trim())).join(" ").replace(/^[\s.!?*-]+/, "").trim();
    lastIndex = m.index + m[0].length;
    const candidates = retrieved.filter((c) => c.logicalKey === logicalKey && c.versionNumber === version && (canonical(c.humanLocator) === canonical(locator) || canonical(c.startLocator) === canonical(locator) || canonical(c.endLocator) === canonical(locator) || c.locatorRange.some((l) => canonical(l) === canonical(locator))));
    const chunk = candidates.find((c) => claim && canonical(c.text).includes(canonical(claim))) ?? candidates[0] ?? null;
    out.push({ raw: m[0], logicalKey, version, locator, chunk, valid: chunk !== null, supportedClaim: claim || out.at(-1)?.supportedClaim || "" });
  }
  return out;
}

/**
 * Evidence-bound answering. The model only sees retrieved blocks; citations in its text are then
 * parsed and validated in code against the supplied retrieval IDs. An answer that is not the exact
 * refusal string but has no valid citation is stored as insufficient evidence.
 */
export async function askQuestion(input: AskInput): Promise<AskResult> {
  const db = getDb();
  const llm = getLlm();
  const mode: AnswerMode = input.mode ?? "answer";
  const started = Date.now();
  const retrieval = await retrieve({ workspaceId: input.workspaceId, query: input.question, includeSuperseded: input.includeSuperseded });
  const [query] = await db
    .insert(schema.ragQueries)
    .values({ workspaceId: input.workspaceId, queryText: input.question, queryEmbedding: retrieval.queryEmbedding.length ? retrieval.queryEmbedding : null, includeSuperseded: Boolean(input.includeSuperseded), createdBy: input.userId })
    .returning();
  await recordLlmCall({ workspaceId: input.workspaceId, processingRunId: input.processingRunId ?? null, provider: llm.name }, "embed", { model: retrieval.usage.model, inputTokens: retrieval.usage.inputTokens, outputTokens: 0, latencyMs: 0 });

  const chunks = retrieval.results;
  const strong = chunks.filter((c) => c.combined >= RETRIEVAL.minCombinedScore);
  let text: string;
  let modelUsage = { model: llm.models.rag, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
  if (strong.length === 0) {
    text = INSUFFICIENT_EVIDENCE;
  } else {
    const res = await llm.answer({
      question: input.question,
      mode,
      blocks: chunks.map((c, i) => ({ retrievalId: i, chunkId: c.chunkId, logicalKey: c.logicalKey, version: c.versionNumber, locator: c.humanLocator, document: c.displayName, isCurrent: c.isCurrent, text: c.text })),
    });
    text = res.text;
    modelUsage = res.usage;
    await recordLlmCall({ workspaceId: input.workspaceId, processingRunId: input.processingRunId ?? null, provider: llm.name }, mode === "answer" ? "answer" : "draft", res.usage, { promptVersion: mode === "answer" ? RAG_PROMPT_VERSION : DRAFT_PROMPT_VERSION });
  }

  const refused = canonical(text) === canonical(INSUFFICIENT_EVIDENCE) || text.trim() === "";
  const citations = refused ? [] : parseCitations(text, chunks);
  // A real locator alone is not evidence of support. Independently verify each claim.
  let verificationUsage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const cited = citations.filter((c) => c.valid);
  if (cited.length) {
    const checked = await llm.verify(cited.map((c, i) => ({
      fieldPath: `claim_${i}`, fieldDefinition: "A factual statement in an answer. It must be supported in full, including numbers, negation and entity, by the supplied source. Return unsupported if any part is not supported.",
      candidateValue: c.supportedClaim,
      evidence: [{ source_block_id: c.chunk!.startLocator, quote: c.chunk!.text, found_in_block: true }],
      context: [{ source_block_id: c.chunk!.startLocator, locator: c.locator, text: c.chunk!.text }],
    })));
    await recordLlmCall({ workspaceId: input.workspaceId, processingRunId: input.processingRunId ?? null, provider: llm.name }, "verify", checked.usage, { promptVersion: "answer-support-v1" });
    verificationUsage = { inputTokens: checked.usage.inputTokens, outputTokens: checked.usage.outputTokens, costUsd: estimateCostUsd(checked.usage.model, checked.usage.inputTokens, checked.usage.outputTokens) };
    for (let i = 0; i < cited.length; i++) {
      const result = checked.outcomes.find((o) => o.fieldPath === `claim_${i}`);
      cited[i]!.valid = result?.status === "supported" && !result.contradictionDetected;
    }
  }
  const valid = citations.filter((c) => c.valid);
  let sufficient = !refused;
  let refusalReason: string | null = refused ? (chunks.length === 0 ? "No indexed evidence matched the question." : "The model found the retrieved evidence insufficient.") : null;
  if (sufficient && (valid.length === 0 || valid.length !== citations.length)) {
    sufficient = false;
    refusalReason = citations.length === 0 ? "The answer contained no citations to the retrieved evidence." : "One or more claims could not be independently supported by their cited evidence.";
  }

  const rawAnswerText = text;
  const lastCitation = [...text.matchAll(new RegExp(CITATION_RE.source, "g"))].at(-1);
  if (mode === "answer" && lastCitation && /[\p{L}\p{N}]/u.test(text.slice(lastCitation.index! + lastCitation[0].length))) {
    sufficient = false;
    refusalReason = "The answer ended with an uncited factual statement.";
  }
  const citationBlocks = new Map<ParsedCitation, Awaited<ReturnType<typeof locateBlock>>>();
  if (sufficient) {
    for (const citation of valid) {
      const block = await locateBlock(citation.chunk!, citation.locator, citation.supportedClaim);
      citationBlocks.set(citation, block);
      if (block) {
        citation.locator = humanLocator(block);
        citation.raw = `[${citation.logicalKey} v${citation.version} ${citation.locator}]`;
      }
    }
    let index = 0;
    text = text.replace(new RegExp(CITATION_RE.source, "g"), () => citations[index++]!.raw);
  }
  if (!sufficient) text = INSUFFICIENT_EVIDENCE;

  const cost = estimateCostUsd(modelUsage.model, modelUsage.inputTokens, modelUsage.outputTokens) + verificationUsage.costUsd + estimateCostUsd(retrieval.usage.model, retrieval.usage.inputTokens, 0);
  const totalInputTokens = modelUsage.inputTokens + verificationUsage.inputTokens + retrieval.usage.inputTokens;
  const totalOutputTokens = modelUsage.outputTokens + verificationUsage.outputTokens;
  const [answer] = await db
    .insert(schema.ragAnswers)
    .values({
      ragQueryId: query!.id,
      mode,
      answerText: text,
      answerJson: { rawAnswerText, citations: citations.map((c) => ({ raw: c.raw, logicalKey: c.logicalKey, version: c.version, locator: c.locator, valid: c.valid, chunkId: c.chunk?.chunkId ?? null, supportedClaim: c.supportedClaim })), invalidCitations: citations.length - valid.length },
      sufficientEvidence: sufficient,
      refusalReason: sufficient ? null : refusalReason,
      retrievedJson: chunks.map((c) => ({ chunkId: c.chunkId, documentVersionId: c.documentVersionId, logicalKey: c.logicalKey, versionNumber: c.versionNumber, isCurrent: c.isCurrent, displayName: c.displayName, humanLocator: c.humanLocator, similarity: c.similarity, lexical: c.lexical, combined: c.combined, startLocator: c.startLocator, endLocator: c.endLocator, text: c.text })),
      model: modelUsage.model,
      promptVersion: mode === "answer" ? RAG_PROMPT_VERSION : DRAFT_PROMPT_VERSION,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      latencyMs: Date.now() - started,
      estimatedCostUsd: cost.toFixed(6),
    })
    .returning();

  const rows: (typeof schema.answerCitations.$inferInsert)[] = [];
  let order = 0;
  for (const c of sufficient ? valid : []) {
    const chunk = c.chunk!;
    const block = citationBlocks.get(c);
    rows.push({
      ragAnswerId: answer!.id,
      chunkId: chunk.chunkId,
      sourceBlockId: block?.id ?? null,
      documentVersionId: chunk.documentVersionId,
      sourceLocator: block?.locator ?? chunk.startLocator,
      citationOrder: order++,
      supportedClaim: c.supportedClaim,
      quoteText: block?.normalizedText.includes(c.supportedClaim) ? c.supportedClaim : block?.normalizedText.slice(0, 600) ?? chunk.text.slice(0, 600),
      similarityScore: chunk.similarity.toFixed(5),
      lexicalScore: chunk.lexical.toFixed(5),
      combinedScore: chunk.combined.toFixed(5),
    });
  }
  const storedCitations = rows.length ? await db.insert(schema.answerCitations).values(rows).returning() : [];

  return { answerId: answer!.id, queryId: query!.id, question: input.question, mode, sufficient, refusalReason: sufficient ? null : refusalReason, answerText: text, citations, storedCitations, retrieved: chunks, usage: { ...modelUsage, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, latencyMs: Date.now() - started, costUsd: cost }, invalidCitations: citations.length - valid.length };
}

/** Find the source block within the chunk's span that best contains the claim (falls back to the start block). */
async function locateBlock(chunk: RetrievedChunk, locator: string, claim: string) {
  const db = getDb();
  const [startBlock] = await db.select().from(schema.sourceBlocks).where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), eq(schema.sourceBlocks.locator, chunk.startLocator))).limit(1);
  const [endBlock] = await db.select().from(schema.sourceBlocks).where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), eq(schema.sourceBlocks.locator, chunk.endLocator))).limit(1);
  if (!startBlock) return null;
  const blocks = await db
    .select()
    .from(schema.sourceBlocks)
    .where(and(eq(schema.sourceBlocks.documentVersionId, chunk.documentVersionId), gte(schema.sourceBlocks.blockIndex, startBlock.blockIndex), lte(schema.sourceBlocks.blockIndex, endBlock?.blockIndex ?? startBlock.blockIndex)))
    .orderBy(asc(schema.sourceBlocks.blockIndex));
  const key = canonical(claim).slice(0, 80);
  return blocks.find((b) => key && canonical(b.normalizedText).includes(key)) ?? blocks.find((b) => canonical(b.locator) === canonical(locator) || canonical(humanLocator(b)) === canonical(locator)) ?? blocks.find((b) => normalizeText(b.normalizedText).length > 0) ?? startBlock;
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

export { humanLocator };
