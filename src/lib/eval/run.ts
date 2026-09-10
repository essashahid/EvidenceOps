import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getLlm, modelConfigHash } from "@/lib/llm";
import { ROUTING_THRESHOLDS, JUDGE_PROMPT_VERSION, estimateCostUsd } from "@/lib/config";
import { sha256 } from "@/lib/hash";
import { reportRecordSchema, type ReportRecord } from "@/lib/schema/report";
import { retrieve } from "@/lib/rag/retrieve";
import { askQuestion } from "@/lib/rag/answer";
import { recordLlmCall } from "@/lib/pipeline/llm-log";
import { FIXTURES_DIR } from "./cases";
import { compareLists, compareScalars, mean, microF1, percentile } from "./metrics";
import { evaluateRegression, type AggregateMetrics, type RegressionReport } from "./regression";
import { readBaselineFile, writeBaselineFile } from "./baseline";

export type EvalOptions = {
  workspaceId: string;
  userId?: string | null;
  processingRunId?: string | null;
  setBaseline?: boolean;
  reuseCachedAnswers?: boolean;
  log?: (msg: string) => void;
};

export type EvalOutcome = {
  evalRunId: string;
  metrics: AggregateMetrics;
  regression: RegressionReport;
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
  evidence: Map<string, typeof schema.fieldEvidence.$inferSelect>;
  reviewItems: (typeof schema.reviewItems.$inferSelect)[];
};

class EvalFixtureError extends Error {
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
    const reviewItems = modelRecord ? await db.select().from(schema.reviewItems).where(eq(schema.reviewItems.recordVersionId, modelRecord.id)) : [];
    out.set(`${d.logicalKey}.v${v.versionNumber}`, {
      versionId: v.id,
      documentId: d.id,
      logicalKey: d.logicalKey,
      versionNumber: v.versionNumber,
      isCurrent: v.isCurrent,
      contentHash: v.contentHash,
      modelRecord: modelRecord ? (reportRecordSchema.parse(modelRecord.payloadJson) as ReportRecord) : null,
      modelRecordVersionId: modelRecord?.id ?? null,
      fields,
      evidence: new Map(evidenceRows.map((e) => [e.fieldValueId, e])),
      reviewItems,
    });
  }
  return out;
}

/**
 * Run the golden evaluation suite against the workspace corpus, persist per-case results,
 * aggregate metrics, compare against the baseline and return the outcome. Missing fixtures
 * fail loudly instead of silently lowering scores.
 */
export async function runEvaluation(opts: EvalOptions): Promise<EvalOutcome> {
  const db = getDb();
  const llm = getLlm();
  const log = opts.log ?? (() => {});
  const configHash = modelConfigHash(llm);
  const cases = await db.select().from(schema.evalCases).where(eq(schema.evalCases.active, true));
  if (cases.length === 0) throw new EvalFixtureError("no eval cases are seeded; run `pnpm db:seed`");
  const corpus = await loadCorpus(opts.workspaceId);
  const corpusVersion = sha256([...corpus.values()].map((v) => v.contentHash).sort().join("|")).slice(0, 16);

  const [evalRun] = await db
    .insert(schema.evalRuns)
    .values({ workspaceId: opts.workspaceId, processingRunId: opts.processingRunId ?? null, provider: llm.name, modelConfigHash: configHash, status: "running" })
    .returning();
  const evalRunId = evalRun!.id;
  log(`eval run ${evalRunId} (${llm.name}, config ${configHash}, corpus ${corpusVersion}, ${cases.length} cases)`);

  const results: EvalOutcome["results"] = [];
  const latencies: number[] = [];
  let costTotal = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  const scalarHits: boolean[] = [];
  const listComparisons: ReturnType<typeof compareLists> = [];
  const provenanceFlags: boolean[] = [];
  const classificationHits: boolean[] = [];
  let planted = 0;
  let plantedCaught = 0;
  let routed = 0;
  let belowThresholdMissing = 0;
  const retrievalRecalls: number[] = [];
  let citationsValid = 0;
  let citationsTotal = 0;
  const supportedAnswers: boolean[] = [];
  const semanticScores: number[] = [];
  let falseRefusals = 0;
  const refusalHits: boolean[] = [];
  let dupPassed = 0;
  let dupCases = 0;
  let verPassed = 0;
  let verCases = 0;

  const cachedResult = async (c: CaseRow) => {
    if (opts.reuseCachedAnswers === false) return null;
    const key = `${c.id}:${corpusVersion}:${configHash}`;
    const [prior] = await db
      .select({ r: schema.evalResults })
      .from(schema.evalResults)
      .innerJoin(schema.evalRuns, eq(schema.evalRuns.id, schema.evalResults.evalRunId))
      .where(and(eq(schema.evalResults.evalCaseId, c.id), eq(schema.evalRuns.status, "completed"), sql`${schema.evalResults.metricJson}->>'cache_key' = ${key}`))
      .orderBy(desc(schema.evalResults.createdAt))
      .limit(1);
    return prior ? { key, result: prior.r } : { key, result: null };
  };

  const record = async (c: CaseRow, passed: boolean, metric: Record<string, unknown>, actual: unknown, latencyMs: number, cost: number, judgeReason: string | null = null) => {
    latencies.push(latencyMs);
    costTotal += cost;
    await db.insert(schema.evalResults).values({ evalRunId, evalCaseId: c.id, passed, metricJson: metric, expectedJson: c.expectedJson as object, actualJson: actual as object, judgeReason, latencyMs, estimatedCostUsd: cost.toFixed(6) });
    results.push({ caseKey: c.caseKey, caseType: c.caseType, passed, metric });
  };

  const versionFor = (c: CaseRow): VersionInfo => {
    const exp = c.expectedJson as { version?: number };
    const key = `${c.documentLogicalKey}.v${exp.version ?? 1}`;
    const v = corpus.get(key);
    if (!v) throw new EvalFixtureError(`fixture ${key} is not ingested in this workspace; run \`pnpm ingest:corpus\``);
    if (!v.modelRecord) throw new EvalFixtureError(`fixture ${key} has no extracted record; processing did not complete`);
    return v;
  };

  for (const c of cases) {
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
          await record(c, passed, { scalars, list_f1: f1.f1, list_tp: f1.tp, list_fp: f1.fp, list_fn: f1.fn }, v.modelRecord, Date.now() - started, 0);
          break;
        }
        case "provenance": {
          const v = versionFor(c);
          let ok = 0;
          for (const f of v.fields) {
            const ev = v.evidence.get(f.id);
            const valid = Boolean(ev && ev.sourceBlockId && ev.exactMatch);
            provenanceFlags.push(valid);
            if (valid) ok++;
          }
          const rate = v.fields.length ? ok / v.fields.length : 0;
          await record(c, rate >= 0.98, { fields: v.fields.length, valid: ok, validity: rate }, { validity: rate }, Date.now() - started, 0);
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
          const raw = c.expectedJson as { planted: { field_path: string; kind: string; verifier_status?: string }[] };
          // Planted readings the verifier fully supports (formatting variants) are expected to auto-approve.
          const exp = { planted: raw.planted.filter((p) => p.verifier_status !== "supported") };
          const routedPaths = new Set(v.fields.filter((f) => f.routingStatus === "review" || f.routingStatus === "blocked").map((f) => f.fieldPath));
          routed += routedPaths.size;
          const caught = exp.planted.filter((p) => routedPaths.has(p.field_path));
          planted += exp.planted.length;
          plantedCaught += caught.length;
          const missingReview = v.fields.filter((f) => Number(f.confidence) < ROUTING_THRESHOLDS.autoApprove && !v.reviewItems.some((r) => r.fieldValueId === f.id));
          belowThresholdMissing += missingReview.length;
          const passed = caught.length === exp.planted.length && missingReview.length === 0;
          await record(c, passed, { planted: exp.planted.length, caught: caught.length, routed: routedPaths.size, missing_review_items: missingReview.length, missed: exp.planted.filter((p) => !routedPaths.has(p.field_path)).map((p) => p.field_path) }, { routed: [...routedPaths] }, Date.now() - started, 0);
          break;
        }
        case "retrieval": {
          const exp = c.expectedJson as { expected_documents: string[] };
          const r = await retrieve({ workspaceId: opts.workspaceId, query: c.question ?? "", topK: 5 });
          const gotKeys = new Set(r.results.map((x) => x.logicalKey));
          const hit = exp.expected_documents.filter((k) => gotKeys.has(k)).length;
          const recall = exp.expected_documents.length ? hit / exp.expected_documents.length : 1;
          retrievalRecalls.push(recall);
          await record(c, recall >= 1 - 1e-9, { recall_at_5: recall, expected: exp.expected_documents, retrieved: r.results.map((x) => `${x.logicalKey}.v${x.versionNumber}#${x.chunkIndex}`) }, { retrieved: r.results.map((x) => x.logicalKey) }, Date.now() - started, estimateCostUsd(r.usage.model, r.usage.inputTokens, 0));
          break;
        }
        case "answer": {
          const exp = c.expectedJson as { expected_documents: string[]; expected_facts: string[]; reference_answer: string };
          const cache = await cachedResult(c);
          let metric: Record<string, unknown>;
          let actual: unknown;
          let cost = 0;
          let judgeReason: string | null = null;
          if (cache?.result) {
            metric = { ...(cache.result.metricJson as Record<string, unknown>), cache_hit: true };
            actual = cache.result.actualJson;
            judgeReason = cache.result.judgeReason;
          } else {
            const a = await askQuestion({ workspaceId: opts.workspaceId, userId: opts.userId ?? null, question: c.question ?? "", mode: "answer" });
            const total = a.claims.reduce((n, cl) => n + cl.citations.length, 0);
            const valid = a.claims.reduce((n, cl) => n + cl.citations.filter((x) => x.valid).length, 0);
            const supported = a.sufficient && a.claims.length > 0 && a.claims.every((cl) => cl.supported);
            const judge = await llm.judge({ question: c.question ?? "", referenceAnswer: exp.reference_answer, expectedFacts: exp.expected_facts, answer: a.answerText });
            await recordLlmCall({ workspaceId: opts.workspaceId, provider: llm.name }, "judge", judge.usage, { promptVersion: JUDGE_PROMPT_VERSION });
            cost = a.usage.costUsd + estimateCostUsd(judge.usage.model, judge.usage.inputTokens, judge.usage.outputTokens);
            inputTokens += a.usage.inputTokens + judge.usage.inputTokens;
            outputTokens += a.usage.outputTokens + judge.usage.outputTokens;
            judgeReason = judge.reason;
            metric = { cache_key: cache?.key, cache_hit: false, sufficient: a.sufficient, citations_total: total, citations_valid: valid, supported, semantic_score: judge.score, refused: !a.sufficient, answer_id: a.answerId };
            actual = { answer: a.answerText, refusal_reason: a.refusalReason, citations: a.citations.map((x) => x.sourceLocator) };
          }
          citationsTotal += Number(metric.citations_total ?? 0);
          citationsValid += Number(metric.citations_valid ?? 0);
          supportedAnswers.push(Boolean(metric.supported));
          semanticScores.push(Number(metric.semantic_score ?? 0));
          if (metric.refused) falseRefusals++;
          const passed = Boolean(metric.supported) && Number(metric.semantic_score ?? 0) >= 0.5;
          await record(c, passed, metric, actual, Date.now() - started, cost, judgeReason);
          break;
        }
        case "refusal": {
          const cache = await cachedResult(c);
          let metric: Record<string, unknown>;
          let actual: unknown;
          let cost = 0;
          if (cache?.result) {
            metric = { ...(cache.result.metricJson as Record<string, unknown>), cache_hit: true };
            actual = cache.result.actualJson;
          } else {
            const a = await askQuestion({ workspaceId: opts.workspaceId, userId: opts.userId ?? null, question: c.question ?? "", mode: "answer" });
            cost = a.usage.costUsd;
            inputTokens += a.usage.inputTokens;
            outputTokens += a.usage.outputTokens;
            metric = { cache_key: cache?.key, cache_hit: false, refused: !a.sufficient, answer_id: a.answerId };
            actual = { answer: a.answerText, refusal_reason: a.refusalReason };
          }
          refusalHits.push(Boolean(metric.refused));
          await record(c, Boolean(metric.refused), metric, actual, Date.now() - started, cost);
          break;
        }
        case "duplicate": {
          dupCases++;
          const exp = c.expectedJson as { filename: string; duplicate_of: string };
          const file = path.join(FIXTURES_DIR, "corpus", exp.filename);
          if (!fs.existsSync(file)) throw new EvalFixtureError(`fixture file missing: ${exp.filename}`);
          const hash = sha256(fs.readFileSync(file));
          const versions = [...corpus.values()].filter((v) => v.contentHash === hash);
          const [event] = await db
            .select()
            .from(schema.runEvents)
            .where(and(eq(schema.runEvents.eventType, "duplicate_detected"), sql`${schema.runEvents.payloadJson}->>'filename' = ${exp.filename}`))
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
        semanticScores.push(0);
      }
      if (c.caseType === "refusal") refusalHits.push(false);
      if (c.caseType === "retrieval") retrievalRecalls.push(0);
    }
  }

  // Integrity: no duplicate model records per document version.
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

  const f1 = microF1(listComparisons);
  const metrics: AggregateMetrics = {
    extraction: {
      scalar_exact_accuracy: scalarHits.length ? scalarHits.filter(Boolean).length / scalarHits.length : 0,
      list_micro_f1: f1.f1,
      evidence_validity: provenanceFlags.length ? provenanceFlags.filter(Boolean).length / provenanceFlags.length : 0,
      classification_accuracy: classificationHits.length ? classificationHits.filter(Boolean).length / classificationHits.length : 0,
      documents: classificationHits.length,
      scalar_fields: scalarHits.length,
    },
    review: {
      recall: planted ? plantedCaught / planted : 1,
      precision: routed ? plantedCaught / routed : 1,
      planted,
      planted_caught: plantedCaught,
      routed,
      below_threshold_missing: belowThresholdMissing,
    },
    rag: {
      retrieval_recall_at_5: mean(retrievalRecalls),
      citation_precision: citationsTotal ? citationsValid / citationsTotal : 1,
      evidence_supported_rate: supportedAnswers.length ? supportedAnswers.filter(Boolean).length / supportedAnswers.length : 0,
      refusal_accuracy: refusalHits.length ? refusalHits.filter(Boolean).length / refusalHits.length : 1,
      semantic_score: mean(semanticScores),
      false_refusal_rate: supportedAnswers.length ? falseRefusals / supportedAnswers.length : 0,
      answer_cases: supportedAnswers.length,
      refusal_cases: refusalHits.length,
      retrieval_cases: retrievalRecalls.length,
    },
    integrity: { duplicate_cases_passed: dupPassed, duplicate_cases: dupCases, version_cases_passed: verPassed, version_cases: verCases, duplicate_records: dupRecords[0]?.n ?? 0 },
    cost: { estimated_cost_usd: costTotal, input_tokens: inputTokens, output_tokens: outputTokens, latency_p50_ms: percentile(latencies, 50), latency_p95_ms: percentile(latencies, 95) },
    cases: { total: results.length, passed: results.filter((r) => r.passed).length, failed: results.filter((r) => !r.passed).length },
  };

  // Baseline: most recent baseline eval run for this provider in the DB, else the committed file.
  const [baselineRun] = await db
    .select()
    .from(schema.evalRuns)
    .where(and(eq(schema.evalRuns.workspaceId, opts.workspaceId), eq(schema.evalRuns.provider, llm.name), eq(schema.evalRuns.isBaseline, true), eq(schema.evalRuns.status, "completed")))
    .orderBy(desc(schema.evalRuns.completedAt))
    .limit(1);
  const fileBaseline = readBaselineFile(llm.name);
  const baselineMetrics = (baselineRun?.aggregateMetricsJson as AggregateMetrics | undefined) ?? fileBaseline?.metrics ?? null;
  const regression = evaluateRegression(metrics, baselineMetrics, baselineRun?.id ?? fileBaseline?.evalRunId ?? null);
  const becomeBaseline = Boolean(opts.setBaseline) || baselineMetrics === null;

  await db
    .update(schema.evalRuns)
    .set({
      status: "completed",
      completedAt: new Date(),
      aggregateMetricsJson: metrics as unknown as Record<string, unknown>,
      regressionJson: regression as unknown as Record<string, unknown>,
      regressionPassed: regression.passed,
      baselineEvalRunId: baselineRun?.id ?? null,
      isBaseline: becomeBaseline,
    })
    .where(eq(schema.evalRuns.id, evalRunId));
  if (becomeBaseline) {
    if (baselineRun) await db.update(schema.evalRuns).set({ isBaseline: false }).where(eq(schema.evalRuns.id, baselineRun.id));
    writeBaselineFile({ provider: llm.name, modelConfigHash: configHash, evalRunId, recordedAt: new Date().toISOString(), metrics });
    log(`baseline ${baselineMetrics === null ? "initialized" : "updated"} for provider ${llm.name}`);
  }
  log(`eval complete: ${metrics.cases.passed}/${metrics.cases.total} cases passed; regression ${regression.passed ? "PASSED" : "FAILED"}`);
  return { evalRunId, metrics, regression, results };
}
