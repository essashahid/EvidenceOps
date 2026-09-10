import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getStorage } from "@/lib/storage";
import { getLlm, modelConfigHash } from "@/lib/llm";
import { EXTRACT_PROMPT_VERSION, VERIFY_PROMPT_VERSION, VERIFIER_BATCH_SIZE, UPLOAD_LIMITS } from "@/lib/config";
import { sha256 } from "@/lib/hash";
import { normalizeText } from "@/lib/text";
import { extractionOutputSchema, fieldDefinition, flattenExtraction, toRecord, type ExtractionOutput, type LeafField } from "@/lib/schema/report";
import type { VerifyItem, VerifyOutcome } from "@/lib/llm/types";
import { parseDocument, blockLocator } from "./parse";
import { chunkBlocks } from "./chunk";
import { validateFields, type FieldValidation } from "./validate";
import { scoreField, type ScoredField } from "./confidence";
import { runStep, StepFailure, type StepContext } from "./steps-runner";
import { logEvent } from "./events";
import { recordLlmCall } from "./llm-log";

/** Durable step names in pipeline order (spec section 34). `upload` happens in the request; `finalize` closes the document. */
export const DOCUMENT_STEPS = ["parse", "chunk", "extract", "deterministic_validate", "independent_verify", "calculate_confidence", "route_review", "embed", "finalize"] as const;
export type DocumentStep = (typeof DOCUMENT_STEPS)[number];

export type ParseStepOutput = { status: "parsed" | "unsupported"; reason?: string; blockCount: number; pageCount: number | null; charCount: number };
export type ChunkStepOutput = { chunkCount: number };
export type ExtractStepOutput = { extractionRunId: string; leafCount: number };
export type ValidateStepOutput = { validations: FieldValidation[] };
export type VerifyStepOutput = { outcomes: VerifyOutcome[] };
export type ConfidenceStepOutput = { scored: ScoredField[] };
export type RouteStepOutput = { recordVersionId: string; versionNumber: number; autoApproved: number; review: number; blocked: number; total: number };
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
        errorMessage:
          result.reason === "unsupported_scanned_document"
            ? "Image-only or scanned PDF: more than half of the pages have fewer than 100 extracted characters. OCR is not part of this build; the document needs a text-based source."
            : "The document contains no extractable text.",
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
    const [cached] = await db.select().from(schema.extractionRuns).where(and(eq(schema.extractionRuns.documentVersionId, ctx.documentVersionId), eq(schema.extractionRuns.modelConfigHash, ctx.modelConfigHash))).limit(1);
    if (cached) return { extractionRunId: cached.id, leafCount: flattenExtraction(extractionOutputSchema.parse(cached.rawExtractionJson)).length };
    const blocks = await loadBlocks(ctx.documentVersionId);
    if (blocks.length === 0) throw new StepFailure("no source blocks to extract from", "no_source_blocks", false);
    const result = await llm.extract({
      logicalKey: document.logicalKey,
      versionNumber: version.versionNumber,
      blocks: blocks.map((b) => ({ source_block_id: b.locator, locator: b.pageNumber !== null ? `page ${b.pageNumber}` : `paragraph ${b.paragraphNumber}`, text: b.normalizedText })),
    });
    const parsed = extractionOutputSchema.safeParse(result.output);
    if (!parsed.success) throw new StepFailure(`extraction output invalid: ${parsed.error.message}`, "invalid_structured_output", false);
    await recordLlmCall(ctx, "extract", result.usage, { promptVersion: EXTRACT_PROMPT_VERSION });
    const [row] = await db
      .insert(schema.extractionRuns)
      .values({
        processingRunId: ctx.processingRunId,
        documentVersionId: ctx.documentVersionId,
        extractorModel: llm.models.extract,
        verifierModel: llm.models.verify,
        extractorPromptVersion: EXTRACT_PROMPT_VERSION,
        verifierPromptVersion: VERIFY_PROMPT_VERSION,
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

// ---------------------------------------------------------------- deterministic_validate
export async function stepValidate(ctx: StepContext, extract: ExtractStepOutput) {
  return runStep<ValidateStepOutput>(ctx, "deterministic_validate", async () => {
    const { leaves } = await loadExtraction(extract.extractionRunId);
    const blocks = await loadBlocks(ctx.documentVersionId);
    const lookup = new Map(blocks.map((b) => [b.locator, { id: b.id, normalizedText: b.normalizedText }]));
    const validations = validateFields(leaves, lookup);
    const errors = validations.filter((v) => v.deterministicScore === 0).length;
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "validate.done", `${validations.length} fields validated, ${errors} with errors`, { errors });
    return { validations };
  });
}

// ---------------------------------------------------------------- independent_verify
export async function stepVerify(ctx: StepContext, extract: ExtractStepOutput, validate: ValidateStepOutput) {
  return runStep<VerifyStepOutput>(ctx, "independent_verify", async () => {
    const db = getDb();
    const llm = getLlm();
    const { leaves } = await loadExtraction(extract.extractionRunId);
    const blocks = await loadBlocks(ctx.documentVersionId);
    const byLocator = new Map(blocks.map((b) => [b.locator, b]));
    const validationByPath = new Map(validate.validations.map((v) => [v.fieldPath, v]));
    const items: VerifyItem[] = leaves
      .filter((leaf) => leaf.value !== null && leaf.value !== undefined && !(typeof leaf.value === "string" && leaf.value.trim() === ""))
      .map((leaf) => {
        const v = validationByPath.get(leaf.fieldPath);
        const cited = leaf.provenance.source_block_ids;
        // context: the cited blocks plus one neighbour on each side
        const idxs = new Set<number>();
        for (const loc of cited) {
          const b = byLocator.get(loc);
          if (!b) continue;
          for (const d of [-1, 0, 1]) idxs.add(b.blockIndex + d);
        }
        const context = blocks
          .filter((b) => idxs.has(b.blockIndex))
          .map((b) => ({ source_block_id: b.locator, locator: b.pageNumber !== null ? `page ${b.pageNumber}` : `paragraph ${b.paragraphNumber}`, text: b.normalizedText }));
        return {
          fieldPath: leaf.fieldPath,
          fieldDefinition: fieldDefinition(leaf.fieldPath),
          candidateValue: leaf.value,
          evidence: (v?.evidence ?? leaf.provenance.evidence_quotes.map((q) => ({ quote: q, locator: cited[0] ?? "", exactMatch: false }))).map((e) => ({ source_block_id: e.locator, quote: e.quote, found_in_block: e.exactMatch })),
          context,
        };
      });
    const [saved] = await db.select({ outcomes: schema.extractionRuns.verificationJson }).from(schema.extractionRuns).where(eq(schema.extractionRuns.id, extract.extractionRunId));
    const outcomes: VerifyOutcome[] = (saved?.outcomes as VerifyOutcome[] | null) ?? [];
    const verified = new Set(outcomes.map(o => o.fieldPath));
    const pendingItems = items.filter(item => !verified.has(item.fieldPath));
    for (let i = 0; i < pendingItems.length; i += VERIFIER_BATCH_SIZE) {
      const batch = pendingItems.slice(i, i + VERIFIER_BATCH_SIZE);
      const res = await llm.verify(batch);
      await recordLlmCall(ctx, "verify", res.usage, { promptVersion: VERIFY_PROMPT_VERSION });
      outcomes.push(...res.outcomes);
      await db.update(schema.extractionRuns).set({ verificationJson: outcomes }).where(eq(schema.extractionRuns.id, extract.extractionRunId));
    }
    await db.update(schema.extractionRuns).set({ verificationJson: outcomes, completedAt: new Date() }).where(eq(schema.extractionRuns.id, extract.extractionRunId));
    return { outcomes };
  });
}

// ---------------------------------------------------------------- calculate_confidence
export async function stepConfidence(ctx: StepContext, extract: ExtractStepOutput, validate: ValidateStepOutput, verify: VerifyStepOutput) {
  return runStep<ConfidenceStepOutput>(ctx, "calculate_confidence", async () => {
    const { leaves } = await loadExtraction(extract.extractionRunId);
    const validationByPath = new Map(validate.validations.map((v) => [v.fieldPath, v]));
    const verifyByPath = new Map(verify.outcomes.map((o) => [o.fieldPath, o]));
    const scored = leaves.map((leaf) => {
      const validation = validationByPath.get(leaf.fieldPath)!;
      const isNull = leaf.value === null || leaf.value === undefined || (typeof leaf.value === "string" && leaf.value.trim() === "");
      const v: VerifyOutcome = verifyByPath.get(leaf.fieldPath) ?? {
        fieldPath: leaf.fieldPath,
        // null values are not verified: an absent value with no evidence is a clean "not stated"
        status: isNull ? "supported" : "unsupported",
        correctedValue: null,
        contradictionDetected: false,
        evidenceSpecificity: isNull ? 1 : 0,
        reason: isNull ? "value not stated in the document" : "no verifier outcome",
      };
      return scoreField(validation, v, leaf.value);
    });
    return { scored };
  });
}

// ---------------------------------------------------------------- route_review
export async function stepRoute(ctx: StepContext, extract: ExtractStepOutput, validate: ValidateStepOutput, verify: VerifyStepOutput, confidence: ConfidenceStepOutput, runType: string) {
  return runStep<RouteStepOutput>(ctx, "route_review", async () => {
    const db = getDb();
    const { output, leaves } = await loadExtraction(extract.extractionRunId);
    const validationByPath = new Map(validate.validations.map((v) => [v.fieldPath, v]));
    const verifyByPath = new Map(verify.outcomes.map((o) => [o.fieldPath, o]));
    const scoreByPath = new Map(confidence.scored.map((s) => [s.fieldPath, s]));
    const payload = toRecord(output);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from document_versions where id = ${ctx.documentVersionId} for update`);
      const [persisted] = await tx.select().from(schema.recordVersions).where(and(eq(schema.recordVersions.extractionRunId, extract.extractionRunId), inArray(schema.recordVersions.createdByType, ["model", "reprocess"]))).limit(1);
      if (persisted) {
        const fields = await tx.select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, persisted.id));
        return { recordVersionId: persisted.id, versionNumber: persisted.versionNumber, autoApproved: fields.filter(f => f.routingStatus === "auto_approved").length, review: fields.filter(f => f.routingStatus === "review").length, blocked: fields.filter(f => f.routingStatus === "blocked").length, total: fields.length };
      }
      const [currentRecord] = await tx.select().from(schema.recordVersions).where(eq(schema.recordVersions.documentVersionId, ctx.documentVersionId)).orderBy(desc(schema.recordVersions.versionNumber)).limit(1);
      const versionNumber = (currentRecord?.versionNumber ?? 0) + 1;
      const changedFields = currentRecord ? diffRecords(currentRecord.payloadJson as Record<string, unknown>, payload as unknown as Record<string, unknown>) : leaves.map(l => l.fieldPath);
      await tx.update(schema.reviewItems).set({ status: "superseded" }).where(and(eq(schema.reviewItems.documentVersionId, ctx.documentVersionId), inArray(schema.reviewItems.status, ["open", "needs_source"])));
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
      for (const leaf of leaves) {
        const validation = validationByPath.get(leaf.fieldPath)!;
        const s = scoreByPath.get(leaf.fieldPath)!;
        const v = verifyByPath.get(leaf.fieldPath);
        const [fv] = await tx
          .insert(schema.fieldValues)
          .values({
            recordVersionId: rv!.id,
            fieldPath: leaf.fieldPath,
            valueJson: leaf.value as object,
            isRequired: leaf.core,
            confidence: s.confidence.toFixed(3),
            routingStatus: s.routing,
            deterministicValidation: s.components.deterministic_validation.toFixed(3),
            evidenceExactMatch: s.components.evidence_exact_match.toFixed(3),
            verifierSupport: s.components.verifier_support.toFixed(3),
            crossPassAgreement: s.components.cross_pass_agreement.toFixed(3),
            evidenceSpecificity: s.components.evidence_specificity.toFixed(3),
            verifierStatus: v?.status ?? "supported",
            verifierReason: v?.reason ?? null,
            ambiguity: leaf.provenance.ambiguity,
            contradiction: s.contradiction,
            verifierCorrectedValueJson: (v?.correctedValue ?? null) as object,
            validationMessages: validation.messages,
          })
          .returning({ id: schema.fieldValues.id });
        for (const e of validation.evidence) {
          await tx.insert(schema.fieldEvidence).values({
            fieldValueId: fv!.id,
            sourceBlockId: e.sourceBlockId,
            quoteText: e.quote,
            quoteStart: e.quoteStart,
            quoteEnd: e.quoteEnd,
            sourceLocator: e.locator,
            exactMatch: e.exactMatch,
          });
        }
        if (s.routing === "auto_approved") autoApproved++;
        else {
          if (s.routing === "review") review++;
          else blocked++;
          await tx.insert(schema.reviewItems).values({
            workspaceId: ctx.workspaceId,
            documentVersionId: ctx.documentVersionId,
            recordVersionId: rv!.id,
            fieldValueId: fv!.id,
            fieldPath: leaf.fieldPath,
            status: "open",
            priority: s.routing === "blocked" ? "high" : "normal",
            reason: `${s.routing}: ${s.reason}${v?.reason ? ` (verifier: ${v.reason})` : ""}${leaf.provenance.ambiguity ? ` (extractor: ${leaf.provenance.ambiguity})` : ""}`,
          });
        }
      }
      await tx
        .update(schema.processingRuns)
        .set({ reviewItemsCreated: sql`${schema.processingRuns.reviewItemsCreated} + ${review + blocked}` })
        .where(eq(schema.processingRuns.id, ctx.processingRunId));
      return { recordVersionId: rv!.id, versionNumber, autoApproved, review, blocked, total: leaves.length };
    });
    await logEvent(ctx.processingRunId, ctx.documentVersionId, "info", "route.done", `record v${result.versionNumber}: ${result.autoApproved} auto-approved, ${result.review} review, ${result.blocked} blocked`, { ...result });
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
      for (let i = 0; i < Math.max(aa.length, bb.length); i++) if (JSON.stringify(aa[i] ?? null) !== JSON.stringify(bb[i] ?? null)) changed.push(`${key}[${i}]`);
    } else if (JSON.stringify(av ?? null) !== JSON.stringify(bv ?? null)) changed.push(key);
  }
  return changed;
}

// ---------------------------------------------------------------- embed
export async function stepEmbed(ctx: StepContext) {
  return runStep<EmbedStepOutput>(ctx, "embed", async () => {
    const db = getDb();
    const llm = getLlm();
    const rows = await db.select().from(schema.chunks).where(eq(schema.chunks.documentVersionId, ctx.documentVersionId)).orderBy(asc(schema.chunks.chunkIndex));
    const model = llm.models.embed;
    const dims = llm.models.embedDimensions;
    const keyed = rows.map((r) => ({ row: r, key: sha256(`${r.text}${model}${dims}`) }));
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
        await db.insert(schema.embeddingCache).values({ embeddingKey: batch[j]!.key, embedding: vec, model, dimensions: dims }).onConflictDoNothing();
        embedded++;
      }
    }
    for (const k of keyed) {
      await db.update(schema.chunks).set({ embedding: cache.get(k.key)!, embeddingModel: model, embeddingDimensions: dims, embeddingKey: k.key }).where(eq(schema.chunks.id, k.row.id));
    }
    return { embedded, cached: keyed.length - embedded, skipped: 0 };
  });
}

// ---------------------------------------------------------------- finalize
export async function markDocumentOutcome(ctx: StepContext, outcome: "completed" | "completed_with_review" | "failed" | "unsupported") {
  const db = getDb();
  const failed = outcome === "failed" || outcome === "unsupported";
  await db.transaction(async tx => {
    await tx.execute(sql`select id from processing_runs where id = ${ctx.processingRunId} for update`);
    await tx.execute(sql`insert into processing_run_documents (processing_run_id, document_version_id, outcome)
      values (${ctx.processingRunId}, ${ctx.documentVersionId}, ${outcome})
      on conflict (processing_run_id, document_version_id) do update set outcome = excluded.outcome`);
    await tx.update(schema.documentVersions).set({ processingStatus: outcome }).where(eq(schema.documentVersions.id, ctx.documentVersionId));
    await tx.execute(sql`update processing_runs set
      documents_completed = (select count(*) from processing_run_documents where processing_run_id = ${ctx.processingRunId} and outcome in ('completed','completed_with_review')),
      documents_failed = (select count(*) from processing_run_documents where processing_run_id = ${ctx.processingRunId} and outcome in ('failed','unsupported'))
      where id = ${ctx.processingRunId}`);
  });
  await logEvent(ctx.processingRunId, ctx.documentVersionId, failed ? "error" : "info", "document.finished", `document ${outcome}`, { outcome });
  await maybeFinalizeRun(ctx.processingRunId);
}

/** Durable finalize step: records the terminal document state as a step so the timeline is complete. */
export async function stepFinalize(ctx: StepContext, outcome: "completed" | "completed_with_review") {
  return runStep<{ outcome: string }>(ctx, "finalize", async () => {
    await markDocumentOutcome(ctx, outcome);
    return { outcome };
  });
}

/** Close the run once every document has a terminal outcome. Never leaves a run silently stuck. */
export async function maybeFinalizeRun(processingRunId: string) {
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run || run.status === "completed" || run.status === "completed_with_review" || run.status === "failed") return run;
  if (run.documentsCompleted + run.documentsFailed < run.documentsTotal) return run;
  const [pending] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.reviewItems).where(and(inArray(schema.reviewItems.documentVersionId, run.configJson.documentVersionIds ?? []), inArray(schema.reviewItems.status, ["open", "needs_source"])));
  const status = run.documentsFailed > 0 ? "failed" : (pending?.count ?? 0) > 0 ? "completed_with_review" : "completed";
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

export async function buildStepContext(processingRunId: string, documentVersionId: string): Promise<StepContext & { runType: string }> {
  const [run] = await getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.id, processingRunId)).limit(1);
  if (!run) throw new Error(`processing run ${processingRunId} not found`);
  if (run.modelConfigHash !== modelConfigHash()) {
    await getDb().update(schema.processingRuns).set({ status: "failed", errorMessage: "Worker configuration changed. Reprocess the documents in a new run.", completedAt: new Date() }).where(eq(schema.processingRuns.id, processingRunId));
    throw new StepFailure("Worker configuration changed. Reprocess the documents in a new run.", "configuration_changed", false);
  }
  if (!run.configJson.documentVersionIds?.includes(documentVersionId)) throw new Error("Document is not part of this processing run");
  const [version] = await getDb().select().from(schema.documentVersions).where(and(eq(schema.documentVersions.id, documentVersionId), eq(schema.documentVersions.workspaceId, run.workspaceId))).limit(1);
  if (!version) throw new Error("Document is not in the run workspace");
  return { processingRunId, workspaceId: run.workspaceId, documentVersionId, modelConfigHash: run.modelConfigHash, provider: run.provider, injectFailure: run.configJson.injectFailure, runType: run.runType };
}

export { normalizeText };
