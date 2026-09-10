import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getStorage } from "@/lib/storage";
import { getLlm } from "@/lib/llm";
import { EXTRACTOR_PROMPT_VERSION, VERIFIER_PROMPT_VERSION, VERIFIER_BATCH_SIZE, UPLOAD_LIMITS } from "@/lib/config";
import { sha256 } from "@/lib/hash";
import { findQuote, normalizeText } from "@/lib/text";
import { extractionOutputSchema, flattenExtraction, toRecord, type ExtractionOutput, type LeafField } from "@/lib/schema/report";
import { fieldDefinition } from "@/lib/llm/prompts";
import type { VerifyItem, VerifyOutcome } from "@/lib/llm/types";
import { parseDocument, blockLocator } from "./parse";
import { chunkBlocks } from "./chunk";
import { validateFields, type FieldValidation } from "./validate";
import { scoreField, type ScoredField } from "./confidence";
import { runStep, StepFailure, type StepContext } from "./steps-runner";
import { logEvent } from "./events";
import { recordLlmCall } from "./llm-log";

export const DOCUMENT_STEPS = ["parse", "chunk", "extract", "validate", "verify", "score_and_route", "embed"] as const;
export type DocumentStep = (typeof DOCUMENT_STEPS)[number];

export type ParseStepOutput = { status: "parsed" | "unsupported"; reason?: string; blockCount: number; pageCount: number | null; charCount: number };
export type ChunkStepOutput = { chunkCount: number };
export type ExtractStepOutput = { extractionRunId: string; leafCount: number };
export type ValidateStepOutput = { validations: FieldValidation[] };
export type VerifyStepOutput = { outcomes: VerifyOutcome[] };
export type ScoreStepOutput = { recordVersionId: string; versionNumber: number; autoApproved: number; review: number; blocked: number; total: number };
export type EmbedStepOutput = { embedded: number; cached: number; skipped: number };

async function loadVersion(documentVersionId: string) {
  const db = getDb();
  const [row] = await db
    .select({ version: schema.documentVersions, document: schema.documents })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(eq(schema.documentVersions.id, documentVersionId))
    .limit(1);
  if (!row) throw new StepFailure(`document version ${documentVersionId} not found`, "not_found", false);
  return row;
}

async function loadBlocks(documentVersionId: string) {
  return getDb().select().from(schema.sourceBlocks).where(eq(schema.sourceBlocks.documentVersionId, documentVersionId)).orderBy(asc(schema.sourceBlocks.blockIndex));
}

// ---------------------------------------------------------------- parse
export async function stepParse(ctx: StepContext) {
  return runStep<ParseStepOutput>(ctx, "parse", async () => {
    const db = getDb();
    const { version, document } = await loadVersion(ctx.documentVersionId);
    await db.update(schema.documentVersions).set({ processingStatus: "processing" }).where(eq(schema.documentVersions.id, version.id));
    const bytes = await getStorage().get(version.storagePath);
    const result = await parseDocument(bytes, version.mimeType);
    if (result.status === "failed") {
      await db.update(schema.documentVersions).set({ parseStatus: "failed" }).where(eq(schema.documentVersions.id, version.id));
      throw new StepFailure(result.message, "parse_failed", false);
    }
    if (result.status === "parsed" && result.pageCount !== null && result.pageCount > UPLOAD_LIMITS.maxPages) {
      await db.update(schema.documentVersions).set({ parseStatus: "failed", pageCount: result.pageCount }).where(eq(schema.documentVersions.id, version.id));
      throw new StepFailure(`document has ${result.pageCount} pages; the limit is ${UPLOAD_LIMITS.maxPages}`, "too_many_pages", false);
    }
    const blocks = result.blocks.map((b) => ({
      documentVersionId: version.id,
      blockType: b.blockType,
      blockIndex: b.blockIndex,
      locator: blockLocator(document.logicalKey, version.versionNumber, b),
      pageNumber: b.pageNumber,
      paragraphNumber: b.paragraphNumber,
      rawText: b.rawText,
      normalizedText: b.normalizedText,
      charStart: b.charStart,
      charEnd: b.charEnd,
    }));
    await db.transaction(async (tx) => {
      await tx.delete(schema.sourceBlocks).where(eq(schema.sourceBlocks.documentVersionId, version.id));
      if (blocks.length) await tx.insert(schema.sourceBlocks).values(blocks);
      await tx
        .update(schema.documentVersions)
        .set({
          parseStatus: result.status === "parsed" ? "parsed" : "unsupported",
          pageCount: result.pageCount,
          charCount: result.status === "parsed" ? result.charCount : blocks.reduce((n, b) => n + b.normalizedText.length, 0),
          processingStatus: result.status === "parsed" ? "processing" : "unsupported",
        })
        .where(eq(schema.documentVersions.id, version.id));
    });
    if (result.status === "unsupported") {
      await logEvent(ctx.processingRunId, version.id, "warn", "document.unsupported", `document routed to the manual queue: ${result.reason}`, { reason: result.reason });
      await db.insert(schema.deadLetters).values({
        processingRunId: ctx.processingRunId,
        documentVersionId: version.id,
        failedStep: "parse",
        errorCode: result.reason,
        errorMessage: result.reason === "unsupported_scanned_document" ? "Image-only or scanned PDF: text extraction yielded under 100 characters on more than half of the pages. OCR is not supported in this build." : "The document contains no extractable text.",
        attemptCount: 1,
        retryable: false,
        status: "open",
      });
      return { status: "unsupported", reason: result.reason, blockCount: blocks.length, pageCount: result.pageCount, charCount: 0 };
    }
    if (result.charCount === 0) await logEvent(ctx.processingRunId, version.id, "warn", "document.empty_text", "parsed document has no text", {});
    return { status: "parsed", blockCount: blocks.length, pageCount: result.pageCount, charCount: result.charCount };
  });
}

// ---------------------------------------------------------------- chunk
export async function stepChunk(ctx: StepContext) {
  return runStep<ChunkStepOutput>(ctx, "chunk", async () => {
    const db = getDb();
    const blocks = await loadBlocks(ctx.documentVersionId);
    const chunks = chunkBlocks(blocks.map((b) => ({ id: b.id, locator: b.locator, normalizedText: b.normalizedText })));
    await db.transaction(async (tx) => {
      await tx.delete(schema.chunks).where(eq(schema.chunks.documentVersionId, ctx.documentVersionId));
      if (chunks.length) {
        await tx.insert(schema.chunks).values(
          chunks.map((c) => ({
            workspaceId: ctx.workspaceId,
            documentVersionId: ctx.documentVersionId,
            chunkIndex: c.chunkIndex,
            text: c.text,
            startBlockId: c.startBlockId,
            endBlockId: c.endBlockId,
            startLocator: c.startLocator,
            endLocator: c.endLocator,
            tokenCount: c.tokenCount,
            textHash: c.textHash,
          })),
        );
      }
    });
    if (chunks.length === 0) await logEvent(ctx.processingRunId, ctx.documentVersionId, "warn", "chunk.empty", "no chunks produced (empty text)", {});
    return { chunkCount: chunks.length };
  });
}

// ---------------------------------------------------------------- extract
export async function stepExtract(ctx: StepContext) {
  return runStep<ExtractStepOutput>(ctx, "extract", async () => {
    const db = getDb();
    const llm = getLlm();
    const { version, document } = await loadVersion(ctx.documentVersionId);
    const blocks = await loadBlocks(ctx.documentVersionId);
    if (blocks.length === 0) throw new StepFailure("no source blocks to extract from", "no_source_blocks", false);
    const result = await llm.extract({
      documentName: `${document.displayName} (${version.sourceFilename})`,
      blocks: blocks.map((b) => ({ locator: b.locator, text: b.normalizedText })),
    });
    const parsed = extractionOutputSchema.safeParse(result.output);
    if (!parsed.success) throw new StepFailure(`extraction output invalid: ${parsed.error.message}`, "invalid_structured_output", false);
    await recordLlmCall(ctx, "extract", result.usage, { promptVersion: EXTRACTOR_PROMPT_VERSION });
    const [row] = await db
      .insert(schema.extractionRuns)
      .values({
        processingRunId: ctx.processingRunId,
        documentVersionId: ctx.documentVersionId,
        extractorModel: llm.models.extractor,
        verifierModel: llm.models.verifier,
        extractorPromptVersion: EXTRACTOR_PROMPT_VERSION,
        verifierPromptVersion: VERIFIER_PROMPT_VERSION,
        modelConfigHash: ctx.modelConfigHash,
        rawExtractionJson: parsed.data,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      })
      .returning({ id: schema.extractionRuns.id });
    return { extractionRunId: row!.id, leafCount: flattenExtraction(parsed.data).length };
  });
}

async function loadExtraction(extractionRunId: string): Promise<{ output: ExtractionOutput; leaves: LeafField[] }> {
  const [row] = await getDb().select().from(schema.extractionRuns).where(eq(schema.extractionRuns.id, extractionRunId)).limit(1);
  if (!row) throw new StepFailure(`extraction run ${extractionRunId} missing`, "not_found", false);
  const output = extractionOutputSchema.parse(row.rawExtractionJson);
  return { output, leaves: flattenExtraction(output) };
}

// ---------------------------------------------------------------- validate
export async function stepValidate(ctx: StepContext, extract: ExtractStepOutput) {
  return runStep<ValidateStepOutput>(ctx, "validate", async () => {
    const { leaves } = await loadExtraction(extract.extractionRunId);
    const blocks = await loadBlocks(ctx.documentVersionId);
    const lookup = new Map(blocks.map((b) => [b.locator, { id: b.id, normalizedText: b.normalizedText }]));
    const validations = validateFields(leaves, lookup);
    const errors = validations.filter((v) => v.deterministicScore === 0).length;
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "validate.done", `${validations.length} fields validated, ${errors} with errors`, { errors });
    return { validations };
  });
}

// ---------------------------------------------------------------- verify
export async function stepVerify(ctx: StepContext, extract: ExtractStepOutput, validate: ValidateStepOutput) {
  return runStep<VerifyStepOutput>(ctx, "verify", async () => {
    const db = getDb();
    const llm = getLlm();
    const { leaves } = await loadExtraction(extract.extractionRunId);
    const blocks = await loadBlocks(ctx.documentVersionId);
    const byLocator = new Map(blocks.map((b) => [b.locator, b]));
    const validationByPath = new Map(validate.validations.map((v) => [v.fieldPath, v]));
    const items: VerifyItem[] = leaves.map((leaf) => {
      const block = byLocator.get(leaf.evidence.locator);
      const v = validationByPath.get(leaf.fieldPath);
      return {
        fieldPath: leaf.fieldPath,
        fieldDefinition: fieldDefinition(leaf.fieldPath),
        candidateValue: leaf.value,
        evidence: leaf.evidence,
        blockText: block?.normalizedText ?? "",
        quoteFound: v ? v.evidenceExactMatch === 1 : Boolean(block && findQuote(block.normalizedText, leaf.evidence.quote)),
      };
    });
    const outcomes: VerifyOutcome[] = [];
    for (let i = 0; i < items.length; i += VERIFIER_BATCH_SIZE) {
      const batch = items.slice(i, i + VERIFIER_BATCH_SIZE);
      const res = await llm.verify(batch);
      await recordLlmCall(ctx, "verify", res.usage, { promptVersion: VERIFIER_PROMPT_VERSION });
      outcomes.push(...res.outcomes);
    }
    await db.update(schema.extractionRuns).set({ verificationJson: outcomes, completedAt: new Date() }).where(eq(schema.extractionRuns.id, extract.extractionRunId));
    return { outcomes };
  });
}

// ---------------------------------------------------------------- score & route
export async function stepScoreAndRoute(ctx: StepContext, extract: ExtractStepOutput, validate: ValidateStepOutput, verify: VerifyStepOutput, runType: string) {
  return runStep<ScoreStepOutput>(ctx, "score_and_route", async () => {
    const db = getDb();
    const { output, leaves } = await loadExtraction(extract.extractionRunId);
    const validationByPath = new Map(validate.validations.map((v) => [v.fieldPath, v]));
    const verifyByPath = new Map(verify.outcomes.map((o) => [o.fieldPath, o]));
    const scored: { leaf: LeafField; validation: FieldValidation; verify: VerifyOutcome; score: ScoredField }[] = leaves.map((leaf) => {
      const validation = validationByPath.get(leaf.fieldPath)!;
      const v = verifyByPath.get(leaf.fieldPath) ?? {
        fieldPath: leaf.fieldPath,
        status: "unsupported" as const,
        correctedValue: null,
        agreement: "different" as const,
        contradiction: false,
        specificity: "none" as const,
        reason: "no verifier outcome",
      };
      const empty = leaf.value === null || leaf.value === undefined || (typeof leaf.value === "string" && leaf.value.trim() === "");
      return { leaf, validation, verify: v, score: scoreField(validation, v, leaf.required, empty) };
    });

    const payload = toRecord(output);
    const [currentRecord] = await db
      .select()
      .from(schema.recordVersions)
      .where(eq(schema.recordVersions.documentVersionId, ctx.documentVersionId))
      .orderBy(desc(schema.recordVersions.versionNumber))
      .limit(1);
    const versionNumber = (currentRecord?.versionNumber ?? 0) + 1;
    const changedFields = currentRecord ? diffRecords(currentRecord.payloadJson as Record<string, unknown>, payload as unknown as Record<string, unknown>) : leaves.map((l) => l.fieldPath);

    const result = await db.transaction(async (tx) => {
      if (currentRecord) await tx.update(schema.recordVersions).set({ isCurrent: false }).where(eq(schema.recordVersions.documentVersionId, ctx.documentVersionId));
      const [rv] = await tx
        .insert(schema.recordVersions)
        .values({
          documentVersionId: ctx.documentVersionId,
          extractionRunId: extract.extractionRunId,
          parentRecordVersionId: currentRecord?.id ?? null,
          versionNumber,
          createdByType: runType === "reprocess" || currentRecord ? "reprocess" : "model",
          modelConfigHash: ctx.modelConfigHash,
          payloadJson: payload,
          changedFields,
          isCurrent: true,
        })
        .returning();
      let autoApproved = 0;
      let review = 0;
      let blocked = 0;
      for (const s of scored) {
        const [fv] = await tx
          .insert(schema.fieldValues)
          .values({
            recordVersionId: rv!.id,
            fieldPath: s.leaf.fieldPath,
            valueJson: s.leaf.value as object,
            isRequired: s.leaf.required,
            confidence: s.score.confidence.toFixed(3),
            routingStatus: s.score.routing,
            deterministicValidation: s.score.components.deterministic_validation.toFixed(3),
            evidenceExactMatch: s.score.components.evidence_exact_match.toFixed(3),
            verifierSupport: s.score.components.verifier_support.toFixed(3),
            crossPassAgreement: s.score.components.cross_pass_agreement.toFixed(3),
            evidenceSpecificity: s.score.components.evidence_specificity.toFixed(3),
            verifierStatus: s.verify.status,
            contradiction: s.verify.contradiction,
            verifierCorrectedValueJson: s.verify.correctedValue as object,
            validationMessages: s.validation.messages,
          })
          .returning({ id: schema.fieldValues.id });
        await tx.insert(schema.fieldEvidence).values({
          fieldValueId: fv!.id,
          sourceBlockId: s.validation.sourceBlockId,
          quoteText: s.leaf.evidence.quote,
          quoteStart: s.validation.quoteStart,
          quoteEnd: s.validation.quoteEnd,
          sourceLocator: s.leaf.evidence.locator,
          exactMatch: s.validation.evidenceExactMatch === 1,
        });
        if (s.score.routing === "auto_approved") autoApproved++;
        else {
          if (s.score.routing === "review") review++;
          else blocked++;
          await tx.insert(schema.reviewItems).values({
            workspaceId: ctx.workspaceId,
            documentVersionId: ctx.documentVersionId,
            recordVersionId: rv!.id,
            fieldValueId: fv!.id,
            fieldPath: s.leaf.fieldPath,
            status: "open",
            priority: s.score.routing === "blocked" || s.leaf.required ? "high" : "normal",
            reason: `${s.score.routing}: ${s.score.reason}${s.verify.reason ? ` (verifier: ${s.verify.reason})` : ""}`,
          });
        }
      }
      await tx
        .update(schema.processingRuns)
        .set({ reviewItemsCreated: sql`${schema.processingRuns.reviewItemsCreated} + ${review + blocked}` })
        .where(eq(schema.processingRuns.id, ctx.processingRunId));
      return { recordVersionId: rv!.id, versionNumber, autoApproved, review, blocked, total: scored.length };
    });
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "route.done", `record v${versionNumber}: ${result.autoApproved} auto-approved, ${result.review} review, ${result.blocked} blocked`, { ...result });
    return result;
  });
}

function diffRecords(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) || Array.isArray(bv)) {
      const aa = (av as unknown[]) ?? [];
      const bb = (bv as unknown[]) ?? [];
      const n = Math.max(aa.length, bb.length);
      for (let i = 0; i < n; i++) {
        const ai = (aa[i] ?? {}) as Record<string, unknown>;
        const bi = (bb[i] ?? {}) as Record<string, unknown>;
        for (const k of new Set([...Object.keys(ai), ...Object.keys(bi)])) {
          if (JSON.stringify(ai[k]) !== JSON.stringify(bi[k])) changed.push(`${key}[${i}].${k}`);
        }
      }
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      changed.push(key);
    }
  }
  return changed;
}

// ---------------------------------------------------------------- embed
export async function stepEmbed(ctx: StepContext) {
  return runStep<EmbedStepOutput>(ctx, "embed", async () => {
    const db = getDb();
    const llm = getLlm();
    const rows = await db.select().from(schema.chunks).where(eq(schema.chunks.documentVersionId, ctx.documentVersionId)).orderBy(asc(schema.chunks.chunkIndex));
    const model = llm.models.embedding;
    const dims = llm.models.embeddingDimensions;
    const keyed = rows.map((r) => ({ row: r, key: sha256(`${r.text}|${model}|${dims}`) }));
    const keys = keyed.map((k) => k.key);
    const cachedRows = keys.length ? await db.select().from(schema.embeddingCache).where(inArray(schema.embeddingCache.embeddingKey, keys)) : [];
    const cache = new Map(cachedRows.map((c) => [c.embeddingKey, c.embedding]));
    const misses = keyed.filter((k) => !cache.has(k.key));
    let embedded = 0;
    for (let i = 0; i < misses.length; i += 32) {
      const batch = misses.slice(i, i + 32);
      const res = await llm.embed(batch.map((b) => b.row.text));
      await recordLlmCall(ctx, "embed", res.usage);
      for (let j = 0; j < batch.length; j++) {
        const vec = res.vectors[j];
        if (!vec || vec.length !== dims) throw new StepFailure(`embedding dimension mismatch (${vec?.length ?? 0} != ${dims})`, "embedding_invalid", false);
        cache.set(batch[j]!.key, vec);
        await db
          .insert(schema.embeddingCache)
          .values({ embeddingKey: batch[j]!.key, embedding: vec, model, dimensions: dims })
          .onConflictDoNothing();
        embedded++;
      }
    }
    for (const k of keyed) {
      const vec = cache.get(k.key)!;
      await db
        .update(schema.chunks)
        .set({ embedding: vec, embeddingModel: model, embeddingDimensions: dims, embeddingKey: k.key })
        .where(eq(schema.chunks.id, k.row.id));
    }
    return { embedded, cached: keyed.length - embedded, skipped: 0 };
  });
}

// ---------------------------------------------------------------- finalize
export async function markDocumentOutcome(ctx: StepContext, outcome: "completed" | "completed_with_review" | "failed" | "unsupported") {
  const db = getDb();
  await db.update(schema.documentVersions).set({ processingStatus: outcome }).where(eq(schema.documentVersions.id, ctx.documentVersionId));
  const failed = outcome === "failed" || outcome === "unsupported";
  await db
    .update(schema.processingRuns)
    .set(
      failed
        ? { documentsFailed: sql`${schema.processingRuns.documentsFailed} + 1` }
        : { documentsCompleted: sql`${schema.processingRuns.documentsCompleted} + 1` },
    )
    .where(eq(schema.processingRuns.id, ctx.processingRunId));
  await logEvent(ctx.processingRunId, ctx.documentVersionId, failed ? "error" : "info", "document.finished", `document ${outcome}`, { outcome });
  await maybeFinalizeRun(ctx.processingRunId);
}

/** Close the run once every document has a terminal outcome. Never leaves a run silently stuck. */
export async function maybeFinalizeRun(processingRunId: string) {
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run || run.status === "completed" || run.status === "completed_with_review" || run.status === "failed") return run;
  if (run.documentsCompleted + run.documentsFailed < run.documentsTotal) return run;
  const status = run.documentsFailed > 0 ? "failed" : run.reviewItemsCreated > 0 ? "completed_with_review" : "completed";
  const [updated] = await db
    .update(schema.processingRuns)
    .set({ status, completedAt: new Date(), currentStep: null, errorMessage: run.documentsFailed > 0 ? `${run.documentsFailed} document(s) failed or unsupported` : null })
    .where(and(eq(schema.processingRuns.id, processingRunId), inArray(schema.processingRuns.status, ["queued", "running"])))
    .returning();
  if (updated) await logEvent(processingRunId, null, status === "failed" ? "error" : "info", "run.finished", `run ${status}`, { status });
  return updated ?? run;
}

export async function markRunRunning(processingRunId: string) {
  await getDb()
    .update(schema.processingRuns)
    .set({ status: "running", startedAt: sql`coalesce(${schema.processingRuns.startedAt}, now())` })
    .where(and(eq(schema.processingRuns.id, processingRunId), eq(schema.processingRuns.status, "queued")));
}

/** Build the step context for a run/document pair. */
export async function buildStepContext(processingRunId: string, documentVersionId: string): Promise<StepContext & { runType: string }> {
  const [run] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`processing run ${processingRunId} not found`);
  return {
    processingRunId,
    workspaceId: run.workspaceId,
    documentVersionId,
    modelConfigHash: run.modelConfigHash,
    provider: run.provider,
    injectFailure: run.configJson.injectFailure,
    runType: run.runType,
  };
}

/** Utility used by the review UI: normalized text helper re-export to keep imports local. */
export { normalizeText };
