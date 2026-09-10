import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getStorage } from "@/lib/storage";
import { COST_WARNING_USD, PIPELINE_VERSION, ROUTING_THRESHOLDS, SUCCESS_TARGETS } from "@/lib/config";
import { modelConfigSummary } from "@/lib/llm";
import { percentile } from "@/lib/eval/metrics";
import type { AggregateMetrics, RegressionReport } from "@/lib/eval/regression";
import type { ResumabilityResult } from "@/lib/eval/resumability";

export type QaReportInput = { processingRunId: string; evalRunId?: string | null };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (x: number | null | undefined) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | string | null | undefined, d = 0) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d));
const usd = (x: number | string | null | undefined) => (x === null || x === undefined ? "n/a" : `$${Number(x).toFixed(6)}`);

/** Build, store and register the QA report for a processing run (spec section 48). */
export async function generateQaReport(input: QaReportInput): Promise<{ reportId: string; storagePath: string | null; status: "generated" | "failed"; error?: string }> {
  const db = getDb();
  const [report] = await db.insert(schema.qaReports).values({ processingRunId: input.processingRunId, evalRunId: input.evalRunId ?? null, status: "pending" }).returning();
  try {
    const html = await renderQaReport(input);
    const storagePath = `reports/${input.processingRunId}/${report!.id}/evidenceops_run_${input.processingRunId}_qa.html`;
    await getStorage().put(storagePath, Buffer.from(html, "utf8"), "text/html");
    await db.update(schema.qaReports).set({ status: "generated", storagePath, completedAt: new Date() }).where(eq(schema.qaReports.id, report!.id));
    return { reportId: report!.id, storagePath, status: "generated" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(schema.qaReports).set({ status: "failed", errorMessage: message, completedAt: new Date() }).where(eq(schema.qaReports.id, report!.id));
    return { reportId: report!.id, storagePath: null, status: "failed", error: message };
  }
}

export async function loadQaReportHtml(reportId: string): Promise<string | null> {
  const [row] = await getDb().select().from(schema.qaReports).where(eq(schema.qaReports.id, reportId)).limit(1);
  if (!row?.storagePath) return null;
  return (await getStorage().get(row.storagePath)).toString("utf8");
}

export async function renderQaReport(input: QaReportInput): Promise<string> {
  const db = getDb();
  const [run] = await db.select().from(schema.processingRuns).where(eq(schema.processingRuns.id, input.processingRunId)).limit(1);
  if (!run) throw new Error(`run ${input.processingRunId} not found`);
  const versionIds = run.configJson.documentVersionIds ?? [];
  const versions = versionIds.length
    ? await db.select({ v: schema.documentVersions, d: schema.documents }).from(schema.documentVersions).innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId)).where(inArray(schema.documentVersions.id, versionIds))
    : [];
  const steps = await db.select().from(schema.runSteps).where(eq(schema.runSteps.processingRunId, run.id)).orderBy(asc(schema.runSteps.createdAt));
  const deadLetters = await db.select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
  const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.processingRunId, run.id)).orderBy(asc(schema.runEvents.createdAt));
  const llmCalls = await db.select().from(schema.llmCalls).where(eq(schema.llmCalls.processingRunId, run.id));
  const blockStats = versionIds.length
    ? await db.select({ pages: sql<number>`count(*) filter (where block_type = 'page')::int`, paragraphs: sql<number>`count(*) filter (where block_type = 'paragraph')::int` }).from(schema.sourceBlocks).where(inArray(schema.sourceBlocks.documentVersionId, versionIds))
    : [{ pages: 0, paragraphs: 0 }];
  const records = versionIds.length ? await db.select().from(schema.recordVersions).where(and(inArray(schema.recordVersions.documentVersionId, versionIds), inArray(schema.recordVersions.createdByType, ["model", "reprocess"]))) : [];
  const recordIds = records.map((r) => r.id);
  const fields = recordIds.length ? await db.select().from(schema.fieldValues).where(inArray(schema.fieldValues.recordVersionId, recordIds)) : [];
  const evidence = fields.length ? await db.select().from(schema.fieldEvidence).where(inArray(schema.fieldEvidence.fieldValueId, fields.map((f) => f.id))) : [];
  const reviewItems = versionIds.length ? await db.select().from(schema.reviewItems).where(inArray(schema.reviewItems.documentVersionId, versionIds)) : [];
  const duplicateEvents = await db
    .select({ e: schema.runEvents })
    .from(schema.runEvents)
    .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.runEvents.processingRunId))
    .where(and(eq(schema.processingRuns.workspaceId, run.workspaceId), eq(schema.runEvents.eventType, "duplicate_detected")))
    .orderBy(desc(schema.runEvents.createdAt))
    .limit(50);
  const allVersions = await db.select({ v: schema.documentVersions, d: schema.documents }).from(schema.documentVersions).innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId)).where(eq(schema.documentVersions.workspaceId, run.workspaceId));
  let evalRun: typeof schema.evalRuns.$inferSelect | null = null;
  if (input.evalRunId) [evalRun = null] = await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.id, input.evalRunId)).limit(1);
  else [evalRun = null] = await db.select().from(schema.evalRuns).where(and(eq(schema.evalRuns.workspaceId, run.workspaceId), eq(schema.evalRuns.status, "completed"))).orderBy(desc(schema.evalRuns.completedAt)).limit(1);
  const evalResults = evalRun ? await db.select({ r: schema.evalResults, c: schema.evalCases }).from(schema.evalResults).innerJoin(schema.evalCases, eq(schema.evalCases.id, schema.evalResults.evalCaseId)).where(eq(schema.evalResults.evalRunId, evalRun.id)) : [];
  const metrics = (evalRun?.aggregateMetricsJson ?? null) as (AggregateMetrics & { resumability?: ResumabilityResult | null; corpus_version?: string }) | null;
  const regression = (evalRun?.regressionJson ?? null) as RegressionReport | null;
  const config = modelConfigSummary();

  // derived
  const confidences = fields.map((f) => Number(f.confidence));
  const routing: Record<string, number> = {};
  for (const f of fields) routing[f.routingStatus] = (routing[f.routingStatus] ?? 0) + 1;
  const buckets = [
    ["< 0.50", (c: number) => c < 0.5],
    ["0.50 to 0.64", (c: number) => c >= 0.5 && c < ROUTING_THRESHOLDS.review],
    ["0.65 to 0.85", (c: number) => c >= ROUTING_THRESHOLDS.review && c < ROUTING_THRESHOLDS.autoApprove],
    ["0.86 to 0.94", (c: number) => c >= ROUTING_THRESHOLDS.autoApprove && c < 0.95],
    [">= 0.95", (c: number) => c >= 0.95],
  ] as const;
  const claims = fields.filter((f) => f.valueJson !== null);
  const evByField = new Map<string, typeof evidence>();
  for (const e of evidence) evByField.set(e.fieldValueId, [...(evByField.get(e.fieldValueId) ?? []), e]);
  const validRefs = claims.filter((f) => (evByField.get(f.id) ?? []).length > 0 && (evByField.get(f.id) ?? []).every((e) => e.sourceBlockId)).length;
  const exactRefs = claims.filter((f) => (evByField.get(f.id) ?? []).length > 0 && (evByField.get(f.id) ?? []).every((e) => e.exactMatch)).length;
  const stepLatency = new Map<string, number[]>();
  for (const s of steps) if (s.latencyMs !== null) stepLatency.set(s.stepName, [...(stepLatency.get(s.stepName) ?? []), s.latencyMs]);
  const retried = steps.filter((s) => s.attemptCount > 1);
  const failedSteps = steps.filter((s) => s.status === "failed" || s.status === "dead_letter");
  const reused = events.filter((e) => e.eventType === "step.reused").length;
  const cost: Record<string, number> = { extract: 0, verify: 0, embed: 0, answer: 0, draft: 0, judge: 0 };
  for (const c of llmCalls) cost[c.purpose] = (cost[c.purpose] ?? 0) + Number(c.costUsd);
  const evalCost = evalResults.reduce((n, r) => n + Number(r.r.estimatedCostUsd), 0);
  const totalCost = Number(run.estimatedCostUsd) + evalCost;
  const pdfCount = versions.filter((x) => x.v.mimeType === "application/pdf").length;
  const supersedes = versions.filter((x) => x.v.supersedesVersionId);
  const chains = allVersions.filter((x) => x.v.supersedesVersionId);
  const completionRate = run.documentsTotal ? run.documentsCompleted / run.documentsTotal : 1;
  const criticalFailures = [...deadLetters.filter((d) => d.status !== "resolved").map((d) => `${d.failedStep}: ${d.errorCode}`), ...(regression && !regression.passed ? ["regression"] : [])];
  const overallPass = run.status !== "failed" && (regression?.passed ?? true) && deadLetters.filter((d) => d.status !== "resolved").length === 0;
  const targetRows = metrics
    ? ([
        ["Scalar extraction accuracy", metrics.extraction.scalar_exact_accuracy, SUCCESS_TARGETS.scalarExactAccuracy],
        ["List/object F1", metrics.extraction.list_micro_f1, SUCCESS_TARGETS.listMicroF1],
        ["Classification accuracy", metrics.extraction.classification_accuracy, SUCCESS_TARGETS.classificationAccuracy],
      ] as const)
    : [];
  const perDoc = versions.map((x) => {
    const rec = records.find((r) => r.documentVersionId === x.v.id);
    const fs = fields.filter((f) => f.recordVersionId === rec?.id);
    const conf = fs.map((f) => Number(f.confidence));
    const st = steps.filter((s) => s.documentVersionId === x.v.id);
    const extractCase = evalResults.find((r) => r.c.caseType === "extraction" && r.c.documentLogicalKey === x.d.logicalKey && (r.c.expectedJson as { version?: number }).version === x.v.versionNumber);
    const provCase = evalResults.find((r) => r.c.caseType === "provenance" && r.c.documentLogicalKey === x.d.logicalKey && (r.c.expectedJson as { version?: number }).version === x.v.versionNumber);
    return { x, fs, conf, st, extractCase, provCase, review: reviewItems.filter((r) => r.documentVersionId === x.v.id) };
  });

  const section = (n: number, title: string, body: string) => `<section id="s${n}"><h2>${n}. ${esc(title)}</h2>${body}</section>`;
  const table = (head: string[], rows: string[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="muted">none</td></tr>`}</tbody></table>`;
  const kv = (rows: [string, string][]) => `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const badge = (ok: boolean, label?: string) => `<span class="badge ${ok ? "ok" : "bad"}">${esc(label ?? (ok ? "PASS" : "FAIL"))}</span>`;
  const delta = (d: number | null) => (d === null ? "n/a" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)} pp`);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EvidenceOps QA report ${esc(run.id.slice(0, 8))}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f7f7f5; color: #1a1a1a; }
  main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b66; margin: 0 0 10px; }
  .sub { color: #6b6b66; font-size: 13px; } nav { font-size: 12px; margin: 12px 0 4px; } nav a { margin-right: 10px; color: #1f4e79; }
  section { background: #fff; border: 1px solid #e2e2dd; border-radius: 8px; padding: 16px 20px; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eeeeea; vertical-align: top; }
  th { font-weight: 600; color: #6b6b66; font-size: 12px; }
  dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin: 0; }
  dl div { border: 1px solid #eeeeea; border-radius: 6px; padding: 8px 10px; }
  dt { font-size: 11px; color: #6b6b66; text-transform: uppercase; letter-spacing: .03em; } dd { margin: 2px 0 0; font-size: 16px; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .ok { background: #e3f3ea; color: #1f7a4d; } .bad { background: #f7e1e3; color: #a8323a; } .warn { background: #f8ecd9; color: #a2620f; }
  .muted { color: #6b6b66; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .bar { display: flex; height: 10px; background: #eeeeea; border-radius: 4px; overflow: hidden; margin-top: 8px; } .bar span { display: block; height: 100%; }
</style></head><body><main>
<h1>EvidenceOps QA report</h1>
<div class="sub">${esc(`evidenceops_run_${run.id}_qa.html`)} &middot; generated ${esc(new Date().toISOString())}</div>
<nav>${["Run Identity", "Executive Quality Summary", "Corpus", "Processing Reliability", "Extraction Quality", "Provenance", "Confidence & Review", "Duplicate & Version Handling", "RAG Retrieval", "Answer Quality", "Regression Comparison", "Cost", "Latency", "Errors", "Per-Document Results"].map((t, i) => `<a href="#s${i + 1}">${i + 1}. ${esc(t)}</a>`).join("")}</nav>

${section(1, "Run Identity", kv([
  ["Run ID", `<code>${esc(run.id)}</code>`],
  ["Pipeline version", esc(run.pipelineVersion)],
  ["Timestamp", esc(run.completedAt?.toISOString() ?? run.createdAt.toISOString())],
  ["Corpus version", `<code>${esc(metrics?.corpus_version ?? "n/a")}</code>`],
  ["Model configuration", `<code>${esc(run.modelConfigHash)}</code> (${esc(config.provider)}: extract ${esc(config.models.extract)}, verify ${esc(config.models.verify)}, rag ${esc(config.models.rag)}, eval ${esc(config.models.eval)}, embed ${esc(config.models.embed)}@${config.models.embedDimensions})`],
  ["Prompt versions", `extract ${esc(config.prompts.extract)}, verify ${esc(config.prompts.verify)}, rag ${esc(config.prompts.rag)}, draft ${esc(config.prompts.draft)}, eval ${esc(config.prompts.eval)}`],
  ["Run type / status", `${esc(run.runType)} / ${badge(run.status !== "failed", run.status)}`],
  ["Evaluation run", evalRun ? `<code>${esc(evalRun.id)}</code>` : "none attached"],
]))}

${section(2, "Executive Quality Summary", kv([
  ["Overall", badge(overallPass)],
  ["Documents", `${run.documentsCompleted} completed / ${run.documentsFailed} failed / ${run.documentsTotal} total`],
  ["Review items", String(run.reviewItemsCreated)],
  ["Regressions", regression ? badge(regression.passed, regression.passed ? "none" : `${regression.checks.filter((c) => !c.passed).length} failing`) : "no evaluation attached"],
  ["Estimated cost", `${usd(totalCost)} ${totalCost > COST_WARNING_USD ? `<span class="badge warn">above $${COST_WARNING_USD} warning threshold</span>` : ""}`],
  ["Critical failures", criticalFailures.length ? esc(criticalFailures.join("; ")) : "none"],
]))}

${section(3, "Corpus", kv([
  ["Files in run", String(versions.length)],
  ["PDF count", String(pdfCount)],
  ["DOCX count", String(versions.length - pdfCount)],
  ["Pages / paragraphs", `${blockStats[0]?.pages ?? 0} / ${blockStats[0]?.paragraphs ?? 0}`],
  ["Duplicates detected (workspace)", String(duplicateEvents.length)],
  ["Corrected versions (workspace)", String(chains.length)],
]))}

${section(4, "Processing Reliability", kv([
  ["Completion rate", pct(completionRate)],
  ["Retry count", String(run.retries)],
  ["Dead letters", `${deadLetters.length} (${deadLetters.filter((d) => d.status === "open").length} open)`],
  ["Failed steps", String(failedSteps.length)],
  ["Steps reused from prior runs", String(reused)],
  ["Resumability result", metrics?.resumability ? badge(metrics.resumability.passed) : "not run"],
]) + (metrics?.resumability ? table(["Check", "Result", "Detail"], metrics.resumability.checks.map((c) => [esc(c.name), badge(c.passed), esc(c.detail)])) : ""))}

${section(5, "Extraction Quality", metrics ? table(["Metric", "Value", "Target", "Status"], targetRows.map(([l, v, t]) => [esc(l), pct(v), `>= ${pct(t)}`, badge(v >= t - 1e-9)])) + `<p class="muted">Documents evaluated ${metrics.extraction.documents}; scalar fields ${metrics.extraction.scalar_fields}.</p>` : `<p class="muted">No evaluation run attached. Run <code>pnpm eval</code>.</p>`)}

${section(6, "Provenance", kv([
  ["Total claims", String(claims.length)],
  ["Valid evidence references", `${validRefs} (${pct(claims.length ? validRefs / claims.length : 0)})`],
  ["Exact evidence matches", `${exactRefs} (${pct(claims.length ? exactRefs / claims.length : 0)})`],
  ["Invalid references", String(claims.length - validRefs)],
  ["Eval provenance validity", metrics ? `${pct(metrics.extraction.provenance_validity)} ${badge(metrics.extraction.provenance_validity >= SUCCESS_TARGETS.provenanceValidity - 1e-9)}` : "n/a"],
]))}

${section(7, "Confidence & Review", kv([
  ["Auto-approved", String(routing.auto_approved ?? 0)],
  ["Review", String(routing.review ?? 0)],
  ["Blocked", String(routing.blocked ?? 0)],
  ["Review recall", metrics ? `${pct(metrics.review.recall)} ${badge(metrics.review.recall >= SUCCESS_TARGETS.reviewRecall - 1e-9)}` : "n/a"],
  ["Review precision", metrics ? `${pct(metrics.review.precision)} ${badge(metrics.review.precision >= SUCCESS_TARGETS.reviewPrecision - 1e-9)}` : "n/a"],
  ["Mean confidence", num(confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0, 3)],
]) + table(["Confidence bucket", "Fields", "Share"], buckets.map(([label, pred]) => { const n = confidences.filter(pred).length; return [esc(label), String(n), pct(confidences.length ? n / confidences.length : 0)]; })) +
  `<div class="bar">${buckets.map(([label, pred], i) => { const n = confidences.filter(pred).length; const colors = ["#a8323a", "#d9737a", "#e0a54a", "#7fbf9a", "#1f7a4d"]; return `<span title="${esc(label)}: ${n}" style="width:${confidences.length ? (n / confidences.length) * 100 : 0}%;background:${colors[i]}"></span>`; }).join("")}</div>`)}

${section(8, "Duplicate & Version Handling", kv([
  ["Duplicate detections", String(duplicateEvents.length)],
  ["Corrected versions in this run", String(supersedes.length)],
  ["Supersession chains (workspace)", String(chains.length)],
  ["Reprocess count", String(metrics?.integrity.reprocess_count ?? 0)],
  ["Duplicate/version cases", metrics ? `${metrics.integrity.duplicate_cases_passed}/${metrics.integrity.duplicate_cases} and ${metrics.integrity.version_cases_passed}/${metrics.integrity.version_cases}` : "n/a"],
]) + table(["Document", "Version", "Supersedes"], chains.map((x) => [esc(x.d.displayName), `v${x.v.versionNumber}`, `<code>${esc(x.v.supersedesVersionId!.slice(0, 8))}</code>`])) +
  table(["When", "Filename", "Existing version"], duplicateEvents.map(({ e }) => [esc(e.createdAt.toISOString()), esc(String((e.payloadJson as Record<string, unknown>).filename ?? "")), `<code>${esc(String((e.payloadJson as Record<string, unknown>).existingVersionId ?? "").slice(0, 8))}</code>`])))}

${section(9, "RAG Retrieval", metrics ? kv([
  ["Recall@5", `${pct(metrics.rag.retrieval_recall_at_5)} ${badge(metrics.rag.retrieval_recall_at_5 >= SUCCESS_TARGETS.retrievalRecallAt5 - 1e-9)}`],
  ["Average evidence rank", num(metrics.rag.average_evidence_rank, 2)],
  ["Failures", String(metrics.rag.retrieval_failures)],
]) + table(["Case", "Result", "Detail"], evalResults.filter((r) => r.c.caseType === "retrieval" && !r.r.passed).map((r) => [`<code>${esc(r.c.caseKey)}</code>`, badge(false), esc(JSON.stringify(r.r.metricJson).slice(0, 300))])) : `<p class="muted">No evaluation run attached.</p>`)}

${section(10, "Answer Quality", metrics ? kv([
  ["Citation precision", `${pct(metrics.rag.citation_precision)} ${badge(metrics.rag.citation_precision >= SUCCESS_TARGETS.citationPrecision - 1e-9)}`],
  ["Evidence support (judge)", pct(metrics.rag.evidence_support)],
  ["Semantic correctness (judge)", pct(metrics.rag.correctness)],
  ["Semantic answer score", `${num(metrics.rag.semantic_score, 3)} ${badge(metrics.rag.semantic_score >= SUCCESS_TARGETS.semanticScore - 1e-9)}`],
  ["Refusal accuracy", `${pct(metrics.rag.refusal_accuracy)} ${badge(metrics.rag.refusal_accuracy >= SUCCESS_TARGETS.refusalAccuracy - 1e-9)}`],
  ["Evidence-supported answers", pct(metrics.rag.evidence_supported_rate)],
  ["Cases (single / cross / unanswerable)", `${metrics.rag.single_document_cases} / ${metrics.rag.cross_document_cases} / ${metrics.rag.unanswerable_cases}`],
]) + table(["Case", "Type", "Result", "Judge"], evalResults.filter((r) => ["answer", "refusal"].includes(r.c.caseType)).sort((a, b) => a.c.caseKey.localeCompare(b.c.caseKey)).map((r) => [`<code>${esc(r.c.caseKey)}</code>`, esc((r.c.tags ?? [])[0] ?? r.c.caseType), badge(r.r.passed), esc(r.r.judgeReason ?? "")])) : `<p class="muted">No evaluation run attached.</p>`)}

${section(11, "Regression Comparison", regression ? `<p>${badge(regression.passed, regression.passed ? "PASS" : "REGRESSION")} ${regression.hasBaseline ? `against baseline ${regression.baselineEvalRunId ? `<code>${esc(regression.baselineEvalRunId.slice(0, 8))}</code>` : "(file)"}` : "no compatible prior baseline; only a passing run may initialize one"}</p>` +
  table(["Metric", "Baseline", "Current", "Delta", "Threshold", "Status"], regression.checks.map((c) => [esc(c.label), c.baseline === null ? "n/a" : pct(c.baseline), c.threshold === "must pass" ? (c.current ? "pass" : "fail") : pct(c.current), delta(c.delta), esc(c.threshold), badge(c.passed)])) : `<p class="muted">No evaluation run attached.</p>`)}

${section(12, "Cost", table(["Component", "Cost"], [
  ["Extraction", usd(cost.extract)],
  ["Verification", usd(cost.verify)],
  ["Embeddings", usd(cost.embed)],
  ["RAG (answers and drafts)", usd((cost.answer ?? 0) + (cost.draft ?? 0))],
  ["Evaluation", usd(evalCost)],
  ["Total", `<strong>${usd(totalCost)}</strong>`],
]) + `<p class="muted">Tokens: ${run.inputTokens} in / ${run.outputTokens} out / ${run.embeddingTokens} embedding.${totalCost > COST_WARNING_USD ? ` Warning: total exceeds the $${COST_WARNING_USD} demo-corpus threshold.` : ""}</p>`)}

${section(13, "Latency", table(["Step", "Runs", "p50 (ms)", "p95 (ms)"], [...stepLatency.entries()].map(([k, v]) => [esc(k), String(v.length), num(percentile(v, 50)), num(percentile(v, 95))])) + (metrics ? `<p class="muted">Evaluation case latency p50 ${num(metrics.cost.latency_p50_ms)} ms, p95 ${num(metrics.cost.latency_p95_ms)} ms.</p>` : ""))}

${section(14, "Errors", table(["Document", "Step", "Attempts", "Error", "Final disposition"], [
  ...deadLetters.map((d) => [`<code>${esc(d.documentVersionId.slice(0, 8))}</code>`, esc(d.failedStep), String(d.attemptCount), esc(`${d.errorCode}: ${d.errorMessage}`), esc(d.status === "resolved" ? "resolved" : d.retryable ? "dead letter (retryable)" : "dead letter (manual)")]),
  ...retried.filter((s) => s.status === "succeeded").map((s) => [`<code>${esc((s.documentVersionId ?? "").slice(0, 8))}</code>`, esc(s.stepName), String(s.attemptCount), esc(s.errorMessage ?? "transient failure"), "recovered after retry"]),
]))}

${section(15, "Per-Document Results", table(["Document", "Version", "Format", "Pages", "Status", "Fields", "Auto / review / blocked", "Mean confidence", "Extraction case", "Provenance", "Review items", "Retries", "Errors"], perDoc.map((p) => [
  esc(p.x.d.displayName), `v${p.x.v.versionNumber}`, p.x.v.mimeType === "application/pdf" ? "PDF" : "DOCX", String(p.x.v.pageCount ?? ""), badge(!["failed", "unsupported"].includes(p.x.v.processingStatus), p.x.v.processingStatus), String(p.fs.length),
  `${p.fs.filter((f) => f.routingStatus === "auto_approved").length} / ${p.fs.filter((f) => f.routingStatus === "review").length} / ${p.fs.filter((f) => f.routingStatus === "blocked").length}`,
  num(p.conf.length ? p.conf.reduce((a, b) => a + b, 0) / p.conf.length : 0, 3),
  p.extractCase ? badge(p.extractCase.r.passed) : "n/a", p.provCase ? pct(Number((p.provCase.r.metricJson as { validity?: number }).validity ?? 0)) : "n/a",
  String(p.review.length), String(p.st.reduce((n, s) => n + Math.max(0, s.attemptCount - 1), 0)), esc(p.st.filter((s) => s.errorMessage).map((s) => `${s.stepName}: ${s.errorMessage}`).join("; ")),
])))}
</main></body></html>`;
}

export { PIPELINE_VERSION };
