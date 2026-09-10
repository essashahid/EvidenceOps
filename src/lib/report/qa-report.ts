import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { getStorage } from "@/lib/storage";
import { PIPELINE_VERSION, ROUTING_THRESHOLDS, SUCCESS_TARGETS } from "@/lib/config";
import { percentile } from "@/lib/eval/metrics";
import type { AggregateMetrics, RegressionReport } from "@/lib/eval/regression";

export type QaReportInput = { processingRunId: string; evalRunId?: string | null };

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "n/a" : `${(x * 100).toFixed(1)}%`);
const num = (x: number | string | null | undefined, d = 0) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d));

/** Build the QA report HTML for a processing run (optionally with an evaluation run) and store it. */
export async function generateQaReport(input: QaReportInput): Promise<{ reportId: string; storagePath: string | null; status: "generated" | "failed"; error?: string }> {
  const db = getDb();
  const [report] = await db.insert(schema.qaReports).values({ processingRunId: input.processingRunId, evalRunId: input.evalRunId ?? null, status: "pending" }).returning();
  try {
    const html = await renderQaReport(input);
    const storagePath = `reports/${input.processingRunId}/evidenceops_run_${input.processingRunId}_qa.html`;
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
    ? await db
        .select({ v: schema.documentVersions, d: schema.documents })
        .from(schema.documentVersions)
        .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
        .where(inArray(schema.documentVersions.id, versionIds))
    : [];
  const steps = await db.select().from(schema.runSteps).where(eq(schema.runSteps.processingRunId, run.id)).orderBy(asc(schema.runSteps.createdAt));
  const deadLetters = await db.select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, run.id));
  const events = await db.select().from(schema.runEvents).where(eq(schema.runEvents.processingRunId, run.id)).orderBy(asc(schema.runEvents.createdAt));
  const llmCalls = await db.select().from(schema.llmCalls).where(eq(schema.llmCalls.processingRunId, run.id));
  const blocks = versionIds.length ? await db.select({ n: sql<number>`count(*)::int` }).from(schema.sourceBlocks).where(inArray(schema.sourceBlocks.documentVersionId, versionIds)) : [{ n: 0 }];
  const chunks = versionIds.length
    ? await db.select({ n: sql<number>`count(*)::int`, embedded: sql<number>`count(embedding)::int` }).from(schema.chunks).where(inArray(schema.chunks.documentVersionId, versionIds))
    : [{ n: 0, embedded: 0 }];
  const records = versionIds.length
    ? await db.select().from(schema.recordVersions).where(and(inArray(schema.recordVersions.documentVersionId, versionIds), inArray(schema.recordVersions.createdByType, ["model", "reprocess"])))
    : [];
  const recordIds = records.map((r) => r.id);
  const fields = recordIds.length ? await db.select().from(schema.fieldValues).where(inArray(schema.fieldValues.recordVersionId, recordIds)) : [];
  const evidence = fields.length ? await db.select().from(schema.fieldEvidence).where(inArray(schema.fieldEvidence.fieldValueId, fields.map((f) => f.id))) : [];
  const reviewItems = versionIds.length ? await db.select().from(schema.reviewItems).where(inArray(schema.reviewItems.documentVersionId, versionIds)) : [];
  const reviewActions = reviewItems.length ? await db.select().from(schema.reviewActions).where(inArray(schema.reviewActions.reviewItemId, reviewItems.map((r) => r.id))) : [];
  const duplicateEvents = await db
    .select()
    .from(schema.runEvents)
    .innerJoin(schema.processingRuns, eq(schema.processingRuns.id, schema.runEvents.processingRunId))
    .where(and(eq(schema.processingRuns.workspaceId, run.workspaceId), eq(schema.runEvents.eventType, "duplicate_detected")))
    .orderBy(desc(schema.runEvents.createdAt))
    .limit(50);
  let evalRun: typeof schema.evalRuns.$inferSelect | null = null;
  if (input.evalRunId) {
    [evalRun = null] = await db.select().from(schema.evalRuns).where(eq(schema.evalRuns.id, input.evalRunId)).limit(1);
  } else {
    [evalRun = null] = await db
      .select()
      .from(schema.evalRuns)
      .where(and(eq(schema.evalRuns.workspaceId, run.workspaceId), eq(schema.evalRuns.status, "completed")))
      .orderBy(desc(schema.evalRuns.completedAt))
      .limit(1);
  }
  const evalResults = evalRun
    ? await db
        .select({ r: schema.evalResults, c: schema.evalCases })
        .from(schema.evalResults)
        .innerJoin(schema.evalCases, eq(schema.evalCases.id, schema.evalResults.evalCaseId))
        .where(eq(schema.evalResults.evalRunId, evalRun.id))
    : [];
  const metrics = (evalRun?.aggregateMetricsJson ?? null) as AggregateMetrics | null;
  const regression = (evalRun?.regressionJson ?? null) as RegressionReport | null;

  // ---- derived stats
  const confidences = fields.map((f) => Number(f.confidence));
  const buckets = [
    ["< 0.50", (c: number) => c < 0.5],
    ["0.50 to 0.64", (c: number) => c >= 0.5 && c < ROUTING_THRESHOLDS.review],
    ["0.65 to 0.85", (c: number) => c >= ROUTING_THRESHOLDS.review && c < ROUTING_THRESHOLDS.autoApprove],
    ["0.86 to 0.94", (c: number) => c >= ROUTING_THRESHOLDS.autoApprove && c < 0.95],
    [">= 0.95", (c: number) => c >= 0.95],
  ] as const;
  const routingCounts: Record<string, number> = {};
  for (const f of fields) routingCounts[f.routingStatus] = (routingCounts[f.routingStatus] ?? 0) + 1;
  const evidenceExact = evidence.filter((e) => e.exactMatch).length;
  const evidenceLocated = evidence.filter((e) => e.sourceBlockId).length;
  const reviewByStatus: Record<string, number> = {};
  for (const r of reviewItems) reviewByStatus[r.status] = (reviewByStatus[r.status] ?? 0) + 1;
  const reviewByField: Record<string, number> = {};
  for (const r of reviewItems) {
    const k = r.fieldPath.replace(/\[\d+\]/g, "[]");
    reviewByField[k] = (reviewByField[k] ?? 0) + 1;
  }
  const actionsByKind: Record<string, number> = {};
  for (const a of reviewActions) actionsByKind[a.action] = (actionsByKind[a.action] ?? 0) + 1;
  const stepLatency = new Map<string, number[]>();
  for (const s of steps) {
    if (s.latencyMs === null) continue;
    stepLatency.set(s.stepName, [...(stepLatency.get(s.stepName) ?? []), s.latencyMs]);
  }
  const allLat = steps.map((s) => s.latencyMs ?? 0).filter((x) => x > 0);
  const retried = steps.filter((s) => s.attemptCount > 1);
  const failedSteps = steps.filter((s) => s.status === "failed" || s.status === "dead_letter");
  const reused = events.filter((e) => e.eventType === "step.reused").length;
  const callsByPurpose: Record<string, { calls: number; input: number; output: number; cost: number; cacheHits: number }> = {};
  for (const c of llmCalls) {
    const p = (callsByPurpose[c.purpose] ??= { calls: 0, input: 0, output: 0, cost: 0, cacheHits: 0 });
    p.calls++;
    p.input += c.inputTokens;
    p.output += c.outputTokens;
    p.cost += Number(c.costUsd);
    if (c.cacheHit) p.cacheHits++;
  }
  const pdfCount = versions.filter((x) => x.v.mimeType === "application/pdf").length;
  const docxCount = versions.length - pdfCount;
  const supersedes = versions.filter((x) => x.v.supersedesVersionId);
  const durationMs = run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null;

  const targetRows = metrics
    ? ([
        ["Scalar-field exact accuracy", metrics.extraction.scalar_exact_accuracy, SUCCESS_TARGETS.scalarExactAccuracy],
        ["List/object micro-F1", metrics.extraction.list_micro_f1, SUCCESS_TARGETS.listMicroF1],
        ["Evidence/provenance validity", metrics.extraction.evidence_validity, SUCCESS_TARGETS.evidenceValidity],
        ["Document classification accuracy", metrics.extraction.classification_accuracy, SUCCESS_TARGETS.classificationAccuracy],
        ["Review recall on planted fields", metrics.review.recall, SUCCESS_TARGETS.reviewRecall],
        ["Review-queue precision", metrics.review.precision, SUCCESS_TARGETS.reviewPrecision],
        ["Retrieval Recall@5", metrics.rag.retrieval_recall_at_5, SUCCESS_TARGETS.retrievalRecallAt5],
        ["Citation precision", metrics.rag.citation_precision, SUCCESS_TARGETS.citationPrecision],
        ["Evidence-supported answer rate", metrics.rag.evidence_supported_rate, SUCCESS_TARGETS.evidenceSupportedRate],
        ["Refusal accuracy", metrics.rag.refusal_accuracy, SUCCESS_TARGETS.refusalAccuracy],
        ["Semantic answer score", metrics.rag.semantic_score, SUCCESS_TARGETS.semanticScore],
      ] as const)
    : [];

  const section = (title: string, body: string) => `<section><h2>${esc(title)}</h2>${body}</section>`;
  const table = (head: string[], rows: string[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="muted">none</td></tr>`}</tbody></table>`;
  const kv = (rows: [string, string][]) => `<dl>${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
  const badge = (ok: boolean, label?: string) => `<span class="badge ${ok ? "ok" : "bad"}">${esc(label ?? (ok ? "pass" : "fail"))}</span>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>EvidenceOps QA report ${esc(run.id.slice(0, 8))}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 0; background: #f7f7f5; color: #1a1a1a; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .04em; color: #6b6b66; margin: 32px 0 10px; }
  .sub { color: #6b6b66; font-size: 13px; }
  section { background: #fff; border: 1px solid #e2e2dd; border-radius: 8px; padding: 16px 20px; margin-top: 16px; }
  section h2 { margin-top: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eeeeea; vertical-align: top; }
  th { font-weight: 600; color: #6b6b66; font-size: 12px; }
  dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px 20px; margin: 0; }
  dl div { border: 1px solid #eeeeea; border-radius: 6px; padding: 8px 10px; }
  dt { font-size: 11px; color: #6b6b66; text-transform: uppercase; letter-spacing: .03em; } dd { margin: 2px 0 0; font-size: 16px; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .ok { background: #e3f3ea; color: #1f7a4d; } .bad { background: #f7e1e3; color: #a8323a; } .warn { background: #f8ecd9; color: #a2620f; }
  .muted { color: #6b6b66; } code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .bar { display: flex; height: 10px; background: #eeeeea; border-radius: 4px; overflow: hidden; margin-top: 8px; }
  .bar span { display: block; height: 100%; }
</style></head><body><main>
<h1>EvidenceOps QA report</h1>
<div class="sub">Run <code>${esc(run.id)}</code> &middot; ${esc(run.runType)} &middot; pipeline ${esc(run.pipelineVersion)} &middot; provider ${esc(run.provider)} &middot; model config <code>${esc(run.modelConfigHash)}</code> &middot; generated ${esc(new Date().toISOString())}</div>

${section(
  "Run status",
  kv([
    ["Status", badge(run.status !== "failed", run.status)],
    ["Documents", `${run.documentsCompleted} completed / ${run.documentsFailed} failed / ${run.documentsTotal} total`],
    ["Review items created", String(run.reviewItemsCreated)],
    ["Retries", String(run.retries)],
    ["Duration", durationMs === null ? "n/a" : `${(durationMs / 1000).toFixed(1)} s`],
    ["Started", esc(run.startedAt?.toISOString() ?? "n/a")],
    ["Completed", esc(run.completedAt?.toISOString() ?? "n/a")],
  ]),
)}

${section(
  "Corpus",
  kv([
    ["Document versions in run", String(versions.length)],
    ["PDF / DOCX", `${pdfCount} / ${docxCount}`],
    ["Pages", String(versions.reduce((n, x) => n + (x.v.pageCount ?? 0), 0))],
    ["Source blocks", String(blocks[0]?.n ?? 0)],
    ["Chunks (embedded)", `${chunks[0]?.n ?? 0} (${chunks[0]?.embedded ?? 0})`],
    ["Parse status", Object.entries(countBy(versions.map((x) => x.v.parseStatus))).map(([k, v]) => `${esc(k)}: ${v}`).join(", ") || "n/a"],
  ]) +
    table(
      ["Document", "Logical key", "Version", "Type", "Pages", "Status", "Supersedes"],
      versions.map((x) => [esc(x.d.displayName), `<code>${esc(x.d.logicalKey)}</code>`, `v${x.v.versionNumber}`, x.v.mimeType === "application/pdf" ? "PDF" : "DOCX", String(x.v.pageCount ?? ""), badge(x.v.processingStatus !== "failed" && x.v.processingStatus !== "unsupported", x.v.processingStatus), x.v.supersedesVersionId ? `<code>${esc(x.v.supersedesVersionId.slice(0, 8))}</code>` : ""]),
    ),
)}

${section(
  "Extraction quality" + (evalRun ? ` (eval run ${esc(evalRun.id.slice(0, 8))})` : ""),
  metrics
    ? table(
        ["Metric", "Value", "Target", "Status"],
        targetRows.map(([label, value, target]) => [esc(label), pct(value), `>= ${pct(target)}`, badge(value >= target - 1e-9)]),
      ) + `<p class="muted">Cases: ${metrics.cases.passed}/${metrics.cases.total} passed. Documents evaluated: ${metrics.extraction.documents}; scalar fields: ${metrics.extraction.scalar_fields}.</p>`
    : `<p class="muted">No evaluation run attached. Run <code>pnpm eval</code> to populate extraction, review and RAG metrics.</p>`,
)}

${section(
  "Confidence distribution",
  table(
    ["Bucket", "Fields", "Share"],
    buckets.map(([label, pred]) => {
      const n = confidences.filter(pred).length;
      return [esc(label), String(n), pct(confidences.length ? n / confidences.length : 0)];
    }),
  ) +
    `<div class="bar">${buckets
      .map(([label, pred], i) => {
        const n = confidences.filter(pred).length;
        const colors = ["#a8323a", "#d9737a", "#e0a54a", "#7fbf9a", "#1f7a4d"];
        return `<span title="${esc(label)}: ${n}" style="width:${confidences.length ? (n / confidences.length) * 100 : 0}%;background:${colors[i]}"></span>`;
      })
      .join("")}</div>` +
    `<p class="muted">Routing: ${Object.entries(routingCounts).map(([k, v]) => `${esc(k)} ${v}`).join(", ") || "none"}. Mean confidence ${num(confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0, 3)}.</p>`,
)}

${section(
  "Provenance",
  kv([
    ["Extracted fields", String(fields.length)],
    ["Evidence records", String(evidence.length)],
    ["Locator resolved", pct(evidence.length ? evidenceLocated / evidence.length : 0)],
    ["Quote exact match", pct(evidence.length ? evidenceExact / evidence.length : 0)],
    ["Verifier: supported", String(fields.filter((f) => f.verifierStatus === "supported").length)],
    ["Verifier: partial / unsupported", `${fields.filter((f) => f.verifierStatus === "partially_supported").length} / ${fields.filter((f) => f.verifierStatus === "unsupported").length}`],
    ["Contradictions flagged", String(fields.filter((f) => f.contradiction).length)],
  ]),
)}

${section(
  "Human review",
  kv([
    ["Review items", String(reviewItems.length)],
    ["Open", String(reviewByStatus.open ?? 0)],
    ["Resolved / rejected / needs source", `${reviewByStatus.resolved ?? 0} / ${reviewByStatus.rejected ?? 0} / ${reviewByStatus.needs_source ?? 0}`],
    ["Actions", Object.entries(actionsByKind).map(([k, v]) => `${esc(k)} ${v}`).join(", ") || "none"],
    ["High priority", String(reviewItems.filter((r) => r.priority === "high").length)],
  ]) + table(["Field", "Items"], Object.entries(reviewByField).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`<code>${esc(k)}</code>`, String(v)])),
)}

${section(
  "RAG evaluation",
  metrics
    ? kv([
        ["Retrieval Recall@5", pct(metrics.rag.retrieval_recall_at_5)],
        ["Citation precision", pct(metrics.rag.citation_precision)],
        ["Evidence-supported answers", pct(metrics.rag.evidence_supported_rate)],
        ["Refusal accuracy", pct(metrics.rag.refusal_accuracy)],
        ["Semantic score (avg)", num(metrics.rag.semantic_score, 3)],
        ["False refusals", pct(metrics.rag.false_refusal_rate)],
        ["Cases (answer / refusal / retrieval)", `${metrics.rag.answer_cases} / ${metrics.rag.refusal_cases} / ${metrics.rag.retrieval_cases}`],
      ]) +
      table(
        ["Case", "Type", "Result", "Detail"],
        evalResults
          .filter((x) => ["answer", "refusal", "retrieval"].includes(x.c.caseType))
          .sort((a, b) => a.c.caseKey.localeCompare(b.c.caseKey))
          .map((x) => [`<code>${esc(x.c.caseKey)}</code>`, esc(x.c.caseType), badge(x.r.passed), esc(summarizeMetric(x.r.metricJson as Record<string, unknown>))]),
      )
    : `<p class="muted">No evaluation run attached.</p>`,
)}

${section(
  "Duplicate and version events",
  kv([
    ["Duplicate uploads detected (workspace)", String(duplicateEvents.length)],
    ["Versions superseding a prior version (this run)", String(supersedes.length)],
  ]) +
    table(
      ["When", "Filename", "Existing version"],
      duplicateEvents.map((e) => [esc(e.run_events.createdAt.toISOString()), esc(String((e.run_events.payloadJson as Record<string, unknown>).filename ?? "")), `<code>${esc(String((e.run_events.payloadJson as Record<string, unknown>).existingVersionId ?? "").slice(0, 8))}</code>`]),
    ) +
    table(
      ["Document", "New version", "Supersedes"],
      supersedes.map((x) => [esc(x.d.displayName), `v${x.v.versionNumber}`, `<code>${esc(x.v.supersedesVersionId!.slice(0, 8))}</code>`]),
    ),
)}

${section(
  "Retries, failures and resumability",
  kv([
    ["Steps executed", String(steps.length)],
    ["Steps reused from prior runs", String(reused)],
    ["Steps retried", String(retried.length)],
    ["Failed / dead-lettered steps", `${failedSteps.filter((s) => s.status === "failed").length} / ${failedSteps.filter((s) => s.status === "dead_letter").length}`],
    ["Open dead letters", String(deadLetters.filter((d) => d.status === "open").length)],
  ]) +
    table(
      ["Document version", "Step", "Status", "Attempts", "Error"],
      [...retried, ...failedSteps.filter((s) => !retried.includes(s))].map((s) => [`<code>${esc((s.documentVersionId ?? "").slice(0, 8))}</code>`, esc(s.stepName), badge(s.status === "succeeded", s.status), String(s.attemptCount), esc(s.errorMessage ?? "")]),
    ) +
    table(
      ["Document version", "Step", "Code", "Message", "Attempts", "Retryable", "Status"],
      deadLetters.map((d) => [`<code>${esc(d.documentVersionId.slice(0, 8))}</code>`, esc(d.failedStep), `<code>${esc(d.errorCode)}</code>`, esc(d.errorMessage), String(d.attemptCount), d.retryable ? "yes" : "no", esc(d.status)]),
    ),
)}

${section(
  "Cost",
  kv([
    ["Estimated cost (run)", `$${num(run.estimatedCostUsd, 6)}`],
    ["Input / output tokens", `${run.inputTokens} / ${run.outputTokens}`],
    ["Embedding tokens", String(run.embeddingTokens)],
    ["Eval cost", metrics ? `$${num(metrics.cost.estimated_cost_usd, 6)}` : "n/a"],
  ]) +
    table(
      ["Purpose", "Calls", "Cache hits", "Input tokens", "Output tokens", "Cost"],
      Object.entries(callsByPurpose).map(([k, v]) => [esc(k), String(v.calls), String(v.cacheHits), String(v.input), String(v.output), `$${num(v.cost, 6)}`]),
    ),
)}

${section(
  "Latency",
  kv([
    ["Step latency p50", `${num(percentile(allLat, 50))} ms`],
    ["Step latency p95", `${num(percentile(allLat, 95))} ms`],
    ["Eval case latency p50 / p95", metrics ? `${num(metrics.cost.latency_p50_ms)} / ${num(metrics.cost.latency_p95_ms)} ms` : "n/a"],
  ]) +
    table(
      ["Step", "Runs", "p50 (ms)", "p95 (ms)", "max (ms)"],
      [...stepLatency.entries()].map(([k, v]) => [esc(k), String(v.length), num(percentile(v, 50)), num(percentile(v, 95)), num(Math.max(...v))]),
    ),
)}

${section(
  "Regression status",
  regression
    ? `<p>${badge(regression.passed, regression.passed ? "no regression" : "REGRESSION")} ${regression.hasBaseline ? `compared against baseline ${regression.baselineEvalRunId ? `<code>${esc(regression.baselineEvalRunId.slice(0, 8))}</code>` : "(file)"}` : "no prior baseline; this run becomes the baseline"}</p>` +
      table(
        ["Metric", "Baseline", "Current", "Rule", "Status"],
        regression.checks.map((c) => [`<code>${esc(c.metric)}</code>`, c.baseline === null ? "n/a" : pct(c.baseline), pct(c.current), esc(c.threshold), badge(c.passed)]),
      )
    : `<p class="muted">No evaluation run attached.</p>`,
)}
</main></body></html>`;
  return html;
}

function countBy(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function summarizeMetric(m: Record<string, unknown>): string {
  if ("recall_at_5" in m) return `recall@5 ${(Number(m.recall_at_5) * 100).toFixed(0)}%`;
  if ("semantic_score" in m) return `semantic ${Number(m.semantic_score).toFixed(2)}; citations ${m.citations_valid}/${m.citations_total}${m.refused ? "; refused" : ""}${m.cache_hit ? "; cached" : ""}`;
  if ("refused" in m) return m.refused ? "refused correctly" : "answered (should have refused)";
  if ("error" in m) return `error: ${String(m.error)}`;
  return "";
}

export { PIPELINE_VERSION };
