import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getLlm, modelConfigHash } from "@/lib/llm";
import { SUCCESS_TARGETS, EVAL_PROMPT_VERSION, INSUFFICIENT_EVIDENCE, JUDGE_PASS, ROUTING_THRESHOLDS, estimateCostUsd } from "@/lib/config";
import { sha256 } from "@/lib/hash";
import { canonical } from "@/lib/text";
import { reportRecordSchema, type ReportRecord } from "@/lib/schema/report";
import { retrieve } from "@/lib/rag/retrieve";
import { askQuestion } from "@/lib/rag/answer";
import { recordLlmCall } from "@/lib/pipeline/llm-log";
import { DOCUMENTS_DIR, corpusFingerprint } from "./cases";
import { compareLists, compareScalars, mean, microF1, percentile } from "./metrics";
import { evaluateRegression, type AggregateMetrics, type RegressionReport } from "./regression";
import { readBaselineFile, writeBaselineFile } from "./baseline";
import { runResumabilityTest, type ResumabilityResult } from "./resumability";

export type EvalOptions = {
  workspaceId: string;
  evalRunId?: string;
  checkpoint?: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
  userId?: string | null;
  processingRunId?: string | null;
  setBaseline?: boolean;
  reuseCachedAnswers?: boolean;
  skipResumability?: boolean;
  log?: (msg: string) => void;
};

export type EvalOutcome = {
  evalRunId: string;
  metrics: AggregateMetrics;
  regression: RegressionReport;
  targetsMet: boolean;
  resumability: ResumabilityResult | null;
  results: { caseKey: string; caseType: string; passed: boolean; metric: Record<string, unknown> }[];
};

type CaseRow = typeof schema.evalCases.$inferSelect;

type VersionInfo = {
  versionId: string;
  documentId: string;
  logicalKey: string;
  versionNumber: number;
  isCurrent: boolean;
  contentHash: string;
  modelRecord: ReportRecord | null;
  modelRecordVersionId: string | null;
  fields: (typeof schema.fieldValues.$inferSelect)[];
  evidence: Map<string, (typeof schema.fieldEvidence.$inferSelect)[]>;
  reviewItems: (typeof schema.reviewItems.$inferSelect)[];
  blockLocators: Set<string>;
};

export class EvalFixtureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalFixtureError";
  }
}

async function loadCorpus(workspaceId: string): Promise<Map<string, VersionInfo>> {
  const db = getDb();
  const versions = await db
    .select({ v: schema.documentVersions, d: schema.documents })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(eq(schema.documentVersions.workspaceId, workspaceId));
  const out = new Map<string, VersionInfo>();
  for (const { v, d } of versions) {
    const [modelRecord] = await db
      .select()
      .from(schema.recordVersions)
      .where(and(eq(schema.recordVersions.documentVersionId, v.id), inArray(schema.recordVersions.createdByType, ["model", "reprocess"])))
      .orderBy(desc(schema.recordVersions.versionNumber))
      .limit(1);
    const fields = modelRecord ? await db.select().from(schema.fieldValues).where(eq(schema.fieldValues.recordVersionId, modelRecord.id)) : [];
    const evidenceRows = fields.length ? await db.select().from(schema.fieldEvidence).where(inArray(schema.fieldEvidence.fieldValueId, fields.map((f) => f.id))) : [];
    const evidence = new Map<string, (typeof schema.fieldEvidence.$inferSelect)[]>();
    for (const e of evidenceRows) evidence.set(e.fieldValueId, [...(evidence.get(e.fieldValueId) ?? []), e]);
    const reviewItems = modelRecord ? await db.select().from(schema.reviewItems).where(eq(schema.reviewItems.recordVersionId, modelRecord.id)) : [];
    const blocks = await db.select({ locator: schema.sourceBlocks.locator }).from(schema.sourceBlocks).where(eq(schema.sourceBlocks.documentVersionId, v.id));
    out.set(`${d.logicalKey}-v${v.versionNumber}`, {
      versionId: v.id,
      documentId: d.id,
      logicalKey: d.logicalKey,
      versionNumber: v.versionNumber,
      isCurrent: v.isCurrent,
      contentHash: v.contentHash,
      modelRecord: modelRecord ? (reportRecordSchema.parse(modelRecord.payloadJson) as ReportRecord) : null,
      modelRecordVersionId: modelRecord?.id ?? null,
      fields,
      evidence,
      reviewItems,
      blockLocators: new Set(blocks.map((b) => b.locator)),
    });
  }
  return out;
}

/**
 * Run the golden evaluation suite (spec sections 28 to 33): per-case results, aggregates, the
 * failure-injection resumability test, baseline comparison and regression verdict.
 * Missing fixtures fail loudly instead of silently lowering scores.
 */
export async function runEvaluation(opts: EvalOptions): Promise<EvalOutcome> {
  const db = getDb();
  const llm = getLlm();
  const log = opts.log ?? (() => {});
  const configHash = modelConfigHash(llm);
  const cases = await db.select().from(schema.evalCases).where(eq(schema.evalCases.active, true));
  if (cases.length === 0) throw new EvalFixtureError("no eval cases are seeded; run `pnpm db:seed`");
  const corpus = await loadCorpus(opts.workspaceId);
  const corpusVersion = sha256(`${corpusFingerprint()}|${[...corpus.values()].map((v) => v.contentHash).sort().join("|")}`).slice(0, 16);

  const checkpoint = opts.checkpoint ?? (async <T>(_name: string, fn: () => Promise<T>) => fn());
  const evalRunId = opts.evalRunId ?? (await createEvaluationRun(opts)).id;
  const [existingRun] = await db.select().from(schema.evalRuns).where(and(eq(schema.evalRuns.id, evalRunId), eq(schema.evalRuns.workspaceId, opts.workspaceId)));
  if (!existingRun || existingRun.modelConfigHash !== configHash) throw new EvalFixtureError("Evaluation configuration changed; start a new evaluation.");
  log(`eval run ${evalRunId} (${llm.name}, config ${configHash}, corpus ${corpusVersion}, ${cases.length} cases)`);

  const results: EvalOutcome["results"] = [];
  const latencies: number[] = [];
  let costTotal = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const scalarHits: boolean[] = [];
  const listComparisons: ReturnType<typeof compareLists> = [];
  const classificationHits: boolean[] = [];
  let provClaims = 0;
  let provValid = 0;
  let provExact = 0;
  let planted = 0;
  let plantedCaught = 0;
  let routed = 0;
  let belowThresholdMissing = 0;
  let autoApproved = 0;
  let reviewCount = 0;
  let blockedCount = 0;
  const retrievalRecalls: number[] = [];
  const evidenceRanks: number[] = [];
  let retrievalFailures = 0;
  let citationsValid = 0;
  let citationsTotal = 0;
  const supportedAnswers: boolean[] = [];
  const correctness: number[] = [];
  const evidenceSupport: number[] = [];
  const completeness: number[] = [];
  const semantic: number[] = [];
  let falseRefusals = 0;
  const refusalHits: boolean[] = [];
  let dupPassed = 0;
  let dupCases = 0;
  let verPassed = 0;
  let verCases = 0;
  const byType: Record<string, { total: number; passed: number }> = {};

  const cachedResult = async (c: CaseRow) => {
    const key = `${c.id}:${corpusVersion}:${configHash}:citation-v3`;
    if (opts.reuseCachedAnswers === false) return { key, result: null };
    const [prior] = await db
      .select({ r: schema.evalResults })
      .from(schema.evalResults)
      .innerJoin(schema.evalRuns, eq(schema.evalRuns.id, schema.evalResults.evalRunId))
      .where(and(eq(schema.evalResults.evalCaseId, c.id), eq(schema.evalRuns.status, "completed"), sql`${schema.evalResults.metricJson}->>'cache_key' = ${key}`))
      .orderBy(desc(schema.evalResults.createdAt))
      .limit(1);
    return { key, result: prior?.r ?? null };
  };

  const record = async (c: CaseRow, passed: boolean, metric: Record<string, unknown>, actual: unknown, latencyMs: number, cost: number, judgeReason: string | null = null) => {
    latencies.push(latencyMs);
    costTotal += cost;
    await db.transaction(async tx => {
      await tx.delete(schema.evalResults).where(and(eq(schema.evalResults.evalRunId, evalRunId), eq(schema.evalResults.evalCaseId, c.id)));
      await tx.insert(schema.evalResults).values({ evalRunId, evalCaseId: c.id, passed, metricJson: metric, expectedJson: c.expectedJson as object, actualJson: (actual ?? {}) as object, judgeReason, latencyMs, estimatedCostUsd: cost.toFixed(6) });
    });
    results.push({ caseKey: c.caseKey, caseType: c.caseType, passed, metric });
    const t = (byType[c.caseType] ??= { total: 0, passed: 0 });
    t.total++;
    if (passed) t.passed++;
  };

  const versionFor = (c: CaseRow): VersionInfo => {
    const exp = c.expectedJson as { version?: number };
    const key = `${c.documentLogicalKey}-v${exp.version ?? 1}`;
    const v = corpus.get(key);
    if (!v) throw new EvalFixtureError(`fixture ${key} is not ingested in this workspace; run \`pnpm ingest:corpus\``);
    if (!v.modelRecord) throw new EvalFixtureError(`fixture ${key} has no extracted record; processing did not complete`);
    return v;
  };

  const evidenceTextFor = (keys: string[]): string => {
    const texts: string[] = [];
    for (const key of keys) {
      const v = [...corpus.values()].find((x) => x.logicalKey === key && x.isCurrent);
      if (v?.modelRecord) texts.push(JSON.stringify(v.modelRecord));
    }
    return texts.join("\n");
  };

  for (const c of cases) {
    let executed = false;
    const delta = await checkpoint(`case-${c.caseKey}`, async () => {
      executed = true;
      const before = { results: results.length, latencies: latencies.length, scalarHits: scalarHits.length, listComparisons: listComparisons.length, classificationHits: classificationHits.length, retrievalRecalls: retrievalRecalls.length, evidenceRanks: evidenceRanks.length, supportedAnswers: supportedAnswers.length, correctness: correctness.length, evidenceSupport: evidenceSupport.length, completeness: completeness.length, semantic: semantic.length, refusalHits: refusalHits.length, costTotal, inputTokens, outputTokens, provClaims, provValid, provExact, planted, plantedCaught, routed, belowThresholdMissing, autoApproved, reviewCount, blockedCount, retrievalFailures, citationsValid, citationsTotal, falseRefusals, dupPassed, dupCases, verPassed, verCases };
    const started = Date.now();
    try {
      switch (c.caseType) {
        case "extraction": {
          const v = versionFor(c);
          const expected = reportRecordSchema.parse((c.expectedJson as { record: unknown }).record) as ReportRecord;
          const scalars = compareScalars(expected, v.modelRecord!);
          const lists = compareLists(expected, v.modelRecord!);
          scalarHits.push(...scalars.map((s) => s.correct));
          listComparisons.push(...lists);
          const f1 = microF1(lists);
          const passed = scalars.every((s) => s.correct) && f1.f1 >= 0.9;
          await record(c, passed, { scalars, list_f1: f1.f1, list_tp: f1.tp, list_fp: f1.fp, list_fn: f1.fn, lists: lists.map((l) => ({ field: l.field, tp: l.tp, fp: l.fp, fn: l.fn })) }, v.modelRecord, Date.now() - started, 0);
          break;
        }
        case "provenance": {
          const v = versionFor(c);
          let valid = 0;
          let exact = 0;
          let claims = 0;
          for (const f of v.fields) {
            if (f.valueJson === null) continue;
            claims++;
            const evs = v.evidence.get(f.id) ?? [];
            // valid: cited block exists, belongs to this version, and the quote occurs in it
            const ok = evs.length > 0 && evs.every((e) => e.sourceBlockId && v.blockLocators.has(e.sourceLocator) && e.exactMatch);
            if (ok) valid++;
            if (evs.length > 0 && evs.every((e) => e.exactMatch)) exact++;
          }
          provClaims += claims;
          provValid += valid;
          provExact += exact;
          const rate = claims ? valid / claims : 1;
          await record(c, rate >= 0.98, { claims, valid, exact, validity: rate }, { validity: rate }, Date.now() - started, 0);
          break;
        }
        case "classification": {
          const v = versionFor(c);
          const expected = (c.expectedJson as { document_type: string }).document_type;
          const hit = v.modelRecord!.document_type === expected;
          classificationHits.push(hit);
          await record(c, hit, { expected, actual: v.modelRecord!.document_type }, { document_type: v.modelRecord!.document_type }, Date.now() - started, 0);
          break;
        }
        case "review_routing": {
          const v = versionFor(c);
          const exp = c.expectedJson as { uncertain_fields: { field_path: string; kind: string; expect_routed: boolean }[] };
          const expected = exp.uncertain_fields.filter((u) => u.expect_routed);
          const routedPaths = new Set(v.fields.filter((f) => f.routingStatus === "review" || f.routingStatus === "blocked").map((f) => f.fieldPath));
          routed += routedPaths.size;
          autoApproved += v.fields.filter((f) => f.routingStatus === "auto_approved").length;
          reviewCount += v.fields.filter((f) => f.routingStatus === "review").length;
          blockedCount += v.fields.filter((f) => f.routingStatus === "blocked").length;
          const caught = expected.filter((u) => routedPaths.has(u.field_path));
          planted += expected.length;
          plantedCaught += caught.length;
          const missingReview = v.fields.filter((f) => Number(f.confidence) < ROUTING_THRESHOLDS.autoApprove && f.routingStatus === "auto_approved");
          belowThresholdMissing += missingReview.length;
          const passed = caught.length === expected.length && missingReview.length === 0;
          await record(c, passed, { planted: expected.length, caught: caught.length, routed: routedPaths.size, missing_review_items: missingReview.length, missed: expected.filter((u) => !routedPaths.has(u.field_path)).map((u) => `${u.field_path} (${u.kind})`) }, { routed: [...routedPaths] }, Date.now() - started, 0);
          break;
        }
        case "retrieval": {
          const exp = c.expectedJson as { expected_documents: string[]; expected_locators: string[] };
          const r = await retrieve({ workspaceId: opts.workspaceId, query: c.question ?? "", topK: 5 });
          const gotKeys = r.results.map((x) => x.logicalKey);
          const hitDocs = exp.expected_documents.filter((k) => gotKeys.includes(k));
          const recall = exp.expected_documents.length ? hitDocs.length / exp.expected_documents.length : 1;
          const firstRank = r.results.findIndex((x) => exp.expected_documents.includes(x.logicalKey));
          if (firstRank >= 0) evidenceRanks.push(firstRank + 1);
          retrievalRecalls.push(recall);
          const passed = recall >= 1 - 1e-9;
          if (!passed) retrievalFailures++;
          await record(c, passed, { recall_at_5: recall, first_rank: firstRank >= 0 ? firstRank + 1 : null, expected: exp.expected_documents, retrieved: r.results.map((x) => `${x.logicalKey}-v${x.versionNumber}#${x.chunkIndex}`) }, { retrieved: gotKeys }, Date.now() - started, estimateCostUsd(r.usage.model, r.usage.inputTokens, 0));
          break;
        }
        case "answer": {
          const exp = c.expectedJson as { expected_documents: string[]; expected_facts: string[]; expected_answer: string };
          const cache = await cachedResult(c);
          let metric: Record<string, unknown>;
          let actual: unknown;
          let cost = 0;
          let judgeReason: string | null = null;
          if (cache.result) {
            metric = { ...(cache.result.metricJson as Record<string, unknown>), cache_hit: true };
            actual = cache.result.actualJson;
            judgeReason = cache.result.judgeReason;
          } else {
            const a = await askQuestion({ workspaceId: opts.workspaceId, userId: opts.userId ?? null, question: c.question ?? "", mode: "answer" });
            const total = a.citations.length;
            const valid = a.citations.filter((x) => x.valid).length;
            const sourceEvidence = a.retrieved.map((r) => `[${r.logicalKey} v${r.versionNumber} ${r.humanLocator}] ${r.text}`).join("\n") || evidenceTextFor(exp.expected_documents);
            const judge = await llm.judge({
              question: c.question ?? "",
              expectedAnswer: llm.name === "mock" ? exp.expected_facts.join("||") : `${exp.expected_answer}\nExpected facts: ${exp.expected_facts.join("; ")}`,
              candidateAnswer: a.answerText,
              sourceEvidence,
              unanswerable: false,
            });
            await recordLlmCall({ workspaceId: opts.workspaceId, provider: llm.name }, "judge", judge.usage, { promptVersion: EVAL_PROMPT_VERSION });
            cost = a.usage.costUsd + estimateCostUsd(judge.usage.model, judge.usage.inputTokens, judge.usage.outputTokens);
            inputTokens += a.usage.inputTokens + judge.usage.inputTokens;
            outputTokens += a.usage.outputTokens + judge.usage.outputTokens;
            judgeReason = judge.reason;
            const semanticScore = (judge.correctness + judge.evidenceSupport + judge.completeness) / 3;
            metric = {
              cache_key: cache.key,
              cache_hit: false,
              sufficient: a.sufficient,
              refused: !a.sufficient,
              citations_total: total,
              citations_valid: valid,
              supported: a.sufficient && total > 0 && valid === total,
              correctness: judge.correctness,
              evidence_support: judge.evidenceSupport,
              completeness: judge.completeness,
              semantic_score: semanticScore,
              judge_passed: judge.correctness >= JUDGE_PASS.correctness && judge.evidenceSupport >= JUDGE_PASS.evidenceSupport && judge.completeness >= JUDGE_PASS.completeness,
              answer_id: a.answerId,
            };
            actual = { answer: a.answerText, refusal_reason: a.refusalReason, citations: a.storedCitations.map((x) => x.sourceLocator) };
          }
          citationsTotal += Number(metric.citations_total ?? 0);
          citationsValid += Number(metric.citations_valid ?? 0);
          supportedAnswers.push(Boolean(metric.supported));
          correctness.push(Number(metric.correctness ?? 0));
          evidenceSupport.push(Number(metric.evidence_support ?? 0));
          completeness.push(Number(metric.completeness ?? 0));
          semantic.push(Number(metric.semantic_score ?? 0));
          if (metric.refused) falseRefusals++;
          await record(c, Boolean(metric.judge_passed) && Boolean(metric.supported), metric, actual, Date.now() - started, cost, judgeReason);
          break;
        }
        case "refusal": {
          const cache = await cachedResult(c);
          let metric: Record<string, unknown>;
          let actual: unknown;
          let cost = 0;
          if (cache.result) {
            metric = { ...(cache.result.metricJson as Record<string, unknown>), cache_hit: true };
            actual = cache.result.actualJson;
          } else {
            const a = await askQuestion({ workspaceId: opts.workspaceId, userId: opts.userId ?? null, question: c.question ?? "", mode: "answer" });
            cost = a.usage.costUsd;
            inputTokens += a.usage.inputTokens;
            outputTokens += a.usage.outputTokens;
            const exactRefusal = canonical(a.answerText) === canonical(INSUFFICIENT_EVIDENCE);
            metric = { cache_key: cache.key, cache_hit: false, refused: !a.sufficient, exact_refusal_string: exactRefusal, answer_id: a.answerId };
            actual = { answer: a.answerText, refusal_reason: a.refusalReason };
          }
          refusalHits.push(Boolean(metric.refused));
          await record(c, Boolean(metric.refused), metric, actual, Date.now() - started, cost);
          break;
        }
        case "duplicate": {
          dupCases++;
          const exp = c.expectedJson as { filename: string; duplicate_of: string };
          const file = path.join(DOCUMENTS_DIR, exp.filename);
          if (!fs.existsSync(file)) throw new EvalFixtureError(`fixture file missing: ${exp.filename}`);
          const hash = sha256(fs.readFileSync(file));
          const versions = [...corpus.values()].filter((v) => v.contentHash === hash);
          const [event] = await db
            .select()
            .from(schema.runEvents)
            .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.runEvents.processingRunId))
            .where(and(eq(schema.processingRuns.workspaceId, opts.workspaceId), eq(schema.runEvents.eventType, "duplicate_detected"), sql`${schema.runEvents.payloadJson}->>'filename' = ${exp.filename}`))
            .limit(1);
          const passed = versions.length === 1 && Boolean(event);
          if (passed) dupPassed++;
          await record(c, passed, { versions_with_hash: versions.length, duplicate_event: Boolean(event) }, { hash }, Date.now() - started, 0);
          break;
        }
        case "version": {
          verCases++;
          const exp = c.expectedJson as { supersedes: string };
          const v1 = corpus.get(exp.supersedes);
          const v2 = [...corpus.values()].find((v) => v.logicalKey === c.documentLogicalKey && v.versionNumber === (v1?.versionNumber ?? 1) + 1);
          let passed = false;
          if (v1 && v2) {
            const [row] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, v2.versionId)).limit(1);
            passed = Boolean(row && row.supersedesVersionId === v1.versionId && row.isCurrent && !v1.isCurrent);
          }
          if (passed) verPassed++;
          await record(c, passed, { v1: v1?.versionId ?? null, v2: v2?.versionId ?? null }, null, Date.now() - started, 0);
          break;
        }
      }
    } catch (err) {
      if (err instanceof EvalFixtureError) {
        await db.update(schema.evalRuns).set({ status: "failed", errorMessage: err.message, completedAt: new Date() }).where(eq(schema.evalRuns.id, evalRunId));
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      log(`case ${c.caseKey} errored: ${message}`);
      await record(c, false, { error: message }, null, Date.now() - started, 0);
      if (c.caseType === "answer") {
        supportedAnswers.push(false);
        semantic.push(0);
        correctness.push(0);
        evidenceSupport.push(0);
        completeness.push(0);
      }
      if (c.caseType === "refusal") refusalHits.push(false);
      if (c.caseType === "retrieval") {
        retrievalRecalls.push(0);
        retrievalFailures++;
      }
    }
      return { results: results.slice(before.results), latencies: latencies.slice(before.latencies), scalarHits: scalarHits.slice(before.scalarHits), listComparisons: listComparisons.slice(before.listComparisons), classificationHits: classificationHits.slice(before.classificationHits), retrievalRecalls: retrievalRecalls.slice(before.retrievalRecalls), evidenceRanks: evidenceRanks.slice(before.evidenceRanks), supportedAnswers: supportedAnswers.slice(before.supportedAnswers), correctness: correctness.slice(before.correctness), evidenceSupport: evidenceSupport.slice(before.evidenceSupport), completeness: completeness.slice(before.completeness), semantic: semantic.slice(before.semantic), refusalHits: refusalHits.slice(before.refusalHits), costTotal: costTotal - before.costTotal, inputTokens: inputTokens - before.inputTokens, outputTokens: outputTokens - before.outputTokens, provClaims: provClaims - before.provClaims, provValid: provValid - before.provValid, provExact: provExact - before.provExact, planted: planted - before.planted, plantedCaught: plantedCaught - before.plantedCaught, routed: routed - before.routed, belowThresholdMissing: belowThresholdMissing - before.belowThresholdMissing, autoApproved: autoApproved - before.autoApproved, reviewCount: reviewCount - before.reviewCount, blockedCount: blockedCount - before.blockedCount, retrievalFailures: retrievalFailures - before.retrievalFailures, citationsValid: citationsValid - before.citationsValid, citationsTotal: citationsTotal - before.citationsTotal, falseRefusals: falseRefusals - before.falseRefusals, dupPassed: dupPassed - before.dupPassed, dupCases: dupCases - before.dupCases, verPassed: verPassed - before.verPassed, verCases: verCases - before.verCases };
    });
    // Inngest replays completed cases from their compact aggregate contributions.
    if (!executed) {
      results.push(...delta.results);
      latencies.push(...delta.latencies);
      scalarHits.push(...delta.scalarHits);
      listComparisons.push(...delta.listComparisons);
      classificationHits.push(...delta.classificationHits);
      retrievalRecalls.push(...delta.retrievalRecalls);
      evidenceRanks.push(...delta.evidenceRanks);
      supportedAnswers.push(...delta.supportedAnswers);
      correctness.push(...delta.correctness);
      evidenceSupport.push(...delta.evidenceSupport);
      completeness.push(...delta.completeness);
      semantic.push(...delta.semantic);
      refusalHits.push(...delta.refusalHits);
      costTotal += delta.costTotal;
      inputTokens += delta.inputTokens;
      outputTokens += delta.outputTokens;
      provClaims += delta.provClaims;
      provValid += delta.provValid;
      provExact += delta.provExact;
      planted += delta.planted;
      plantedCaught += delta.plantedCaught;
      routed += delta.routed;
      belowThresholdMissing += delta.belowThresholdMissing;
      autoApproved += delta.autoApproved;
      reviewCount += delta.reviewCount;
      blockedCount += delta.blockedCount;
      retrievalFailures += delta.retrievalFailures;
      citationsValid += delta.citationsValid;
      citationsTotal += delta.citationsTotal;
      falseRefusals += delta.falseRefusals;
      dupPassed += delta.dupPassed;
      dupCases += delta.dupCases;
      verPassed += delta.verPassed;
      verCases += delta.verCases;
      for (const result of delta.results) {
        const counts = (byType[result.caseType] ??= { total: 0, passed: 0 });
        counts.total++; if (result.passed) counts.passed++;
      }
    }
  }

  let resumability: ResumabilityResult | null = null;
  if (!opts.skipResumability) {
    try {
      resumability = await checkpoint("resumability", () => runResumabilityTest({ log }));
    } catch (err) {
      log(`resumability test errored: ${err instanceof Error ? err.message : String(err)}`);
      resumability = { passed: false, checks: [{ name: "test executed", passed: false, detail: err instanceof Error ? err.message : String(err) }], processingRunId: null };
    }
  }

  const dupRecords = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(
      db
        .select({ dv: schema.recordVersions.documentVersionId, hash: schema.recordVersions.modelConfigHash, c: sql<number>`count(*)`.as("c") })
        .from(schema.recordVersions)
        .where(eq(schema.recordVersions.createdByType, "model"))
        .groupBy(schema.recordVersions.documentVersionId, schema.recordVersions.modelConfigHash)
        .having(sql`count(*) > 1`)
        .as("dups"),
    );
  const [reprocess] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.processingRuns).where(and(eq(schema.processingRuns.workspaceId, opts.workspaceId), eq(schema.processingRuns.runType, "reprocess")));

  const f1 = microF1(listComparisons);
  const catCount = (cat: string) => cases.filter((c) => (c.caseType === "answer" || c.caseType === "refusal") && (c.tags ?? []).includes(cat)).length;
  const metrics: AggregateMetrics = {
    extraction: {
      scalar_exact_accuracy: scalarHits.length ? scalarHits.filter(Boolean).length / scalarHits.length : 0,
      list_micro_f1: f1.f1,
      classification_accuracy: classificationHits.length ? classificationHits.filter(Boolean).length / classificationHits.length : 0,
      provenance_validity: provClaims ? provValid / provClaims : 0,
      documents: classificationHits.length,
      scalar_fields: scalarHits.length,
      provenance_claims: provClaims,
      provenance_valid: provValid,
      provenance_exact: provExact,
      provenance_invalid: provClaims - provValid,
    },
    review: { recall: planted ? plantedCaught / planted : 1, precision: routed ? plantedCaught / routed : 1, planted, planted_caught: plantedCaught, routed, below_threshold_missing: belowThresholdMissing, auto_approved: autoApproved, review: reviewCount, blocked: blockedCount },
    rag: {
      retrieval_recall_at_5: mean(retrievalRecalls),
      average_evidence_rank: mean(evidenceRanks),
      citation_precision: citationsTotal ? citationsValid / citationsTotal : 1,
      evidence_supported_rate: supportedAnswers.length ? supportedAnswers.filter(Boolean).length / supportedAnswers.length : 0,
      refusal_accuracy: refusalHits.length ? refusalHits.filter(Boolean).length / refusalHits.length : 1,
      semantic_score: mean(semantic),
      correctness: mean(correctness),
      evidence_support: mean(evidenceSupport),
      completeness: mean(completeness),
      false_refusal_rate: supportedAnswers.length ? falseRefusals / supportedAnswers.length : 0,
      single_document_cases: catCount("single_document"),
      cross_document_cases: catCount("cross_document"),
      unanswerable_cases: catCount("unanswerable"),
      retrieval_failures: retrievalFailures,
    },
    integrity: { duplicate_cases_passed: dupPassed, duplicate_cases: dupCases, version_cases_passed: verPassed, version_cases: verCases, duplicate_records: dupRecords[0]?.n ?? 0, resumability_passed: resumability ? resumability.passed : null, reprocess_count: reprocess?.n ?? 0 },
    cost: { cached_answer_cases: results.filter(r => r.metric.cache_hit === true).length, estimated_cost_usd: costTotal, input_tokens: inputTokens, output_tokens: outputTokens, latency_p50_ms: percentile(latencies, 50), latency_p95_ms: percentile(latencies, 95) },
    cases: { total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length, by_type: byType },
  };

  const [baselineRun] = await db
    .select()
    .from(schema.evalRuns)
    .where(and(eq(schema.evalRuns.workspaceId, opts.workspaceId), eq(schema.evalRuns.provider, llm.name), eq(schema.evalRuns.isBaseline, true), eq(schema.evalRuns.status, "completed"), sql`${schema.evalRuns.aggregateMetricsJson}->>'corpus_version' = ${corpusVersion}`))
    .orderBy(desc(schema.evalRuns.completedAt))
    .limit(1);
  const candidateBaseline = readBaselineFile(llm.name);
  const fileBaseline = candidateBaseline?.corpusVersion === corpusVersion ? candidateBaseline : null;
  const baselineMetrics = (baselineRun?.aggregateMetricsJson as AggregateMetrics | undefined) ?? fileBaseline?.metrics ?? null;
  const regression = evaluateRegression(metrics, baselineMetrics, baselineRun?.id ?? fileBaseline?.evalRunId ?? null);
  const targetsMet = metrics.extraction.scalar_exact_accuracy >= SUCCESS_TARGETS.scalarExactAccuracy
    && metrics.extraction.list_micro_f1 >= SUCCESS_TARGETS.listMicroF1
    && metrics.extraction.classification_accuracy >= SUCCESS_TARGETS.classificationAccuracy
    && metrics.extraction.provenance_validity >= SUCCESS_TARGETS.provenanceValidity
    && metrics.review.recall >= SUCCESS_TARGETS.reviewRecall && metrics.review.precision >= SUCCESS_TARGETS.reviewPrecision
    && metrics.rag.retrieval_recall_at_5 >= SUCCESS_TARGETS.retrievalRecallAt5
    && metrics.rag.citation_precision >= SUCCESS_TARGETS.citationPrecision
    && metrics.rag.evidence_supported_rate >= SUCCESS_TARGETS.evidenceSupportedRate
    && metrics.rag.refusal_accuracy >= SUCCESS_TARGETS.refusalAccuracy && metrics.rag.semantic_score >= SUCCESS_TARGETS.semanticScore
    && metrics.integrity.duplicate_records === 0 && metrics.review.below_threshold_missing === 0;
  const becomeBaseline = (Boolean(opts.setBaseline) || baselineMetrics === null) && targetsMet && regression.passed;

  await db
    .update(schema.evalRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      aggregateMetricsJson: { ...(metrics as unknown as Record<string, unknown>), resumability, corpus_version: corpusVersion },
      regressionJson: regression as unknown as Record<string, unknown>,
      regressionPassed: regression.passed,
      baselineEvalRunId: baselineRun?.id ?? null,
      isBaseline: becomeBaseline,
    })
    .where(eq(schema.evalRuns.id, evalRunId));
  if (becomeBaseline) {
    if (baselineRun) await db.update(schema.evalRuns).set({ isBaseline: false }).where(eq(schema.evalRuns.id, baselineRun.id));
    if (!process.env.VERCEL) writeBaselineFile({ provider: llm.name, modelConfigHash: configHash, corpusVersion, evalRunId, recordedAt: new Date().toISOString(), metrics });
    log(`baseline ${baselineMetrics === null ? "initialized" : "updated"} for provider ${llm.name}`);
  }
  log(`eval complete: ${metrics.cases.passed}/${metrics.cases.total} cases passed; regression ${regression.passed ? "PASSED" : "FAILED"}`);
  return { evalRunId, metrics, regression, targetsMet, resumability, results };
}

export async function createEvaluationRun(opts: { workspaceId: string; processingRunId?: string | null }) {
  const llm = getLlm();
  const [run] = await getDb().insert(schema.evalRuns).values({ workspaceId: opts.workspaceId, processingRunId: opts.processingRunId ?? null, provider: llm.name, modelConfigHash: modelConfigHash(llm), status: "running" }).returning();
  return run!;
}
