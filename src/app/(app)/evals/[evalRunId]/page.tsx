import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { getEvalRun, listEvalResults, listQaReportsForEvalRun, metricsOf, regressionOf } from "@/lib/queries/evals";
import { latestCorpusRun } from "@/lib/eval/corpus";
import { EVAL_CASE_TYPES } from "@/lib/db/schema";
import { SUCCESS_TARGETS } from "@/lib/config";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { FormButton } from "@/components/FormButton";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtDuration, fmtNumber, fmtPct, fmtUsd, shortId } from "@/components/format";
import { generateEvalReportAction } from "../actions";

export const dynamic = "force-dynamic";

const HIDDEN_METRIC_KEYS = new Set(["cache_key", "answer_id", "cache_hit"]);

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtMetric(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.length > 60 ? `${v.slice(0, 59)}…` : v;
  const s = JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 79)}…` : s;
}

function PassBadge({ ok, title }: { ok: boolean; title?: string }) {
  return <StatusBadge status={ok ? "pass" : "fail"} title={title} />;
}

export default async function EvalRunPage({ params, searchParams }: { params: Promise<{ evalRunId: string }>; searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const [{ evalRunId }, sp] = await Promise.all([params, searchParams]);
  const { workspace } = await requireWorkspace();
  const run = await getEvalRun(workspace.workspaceId, evalRunId);
  if (!run) notFound();
  const [results, reports, corpusRun] = await Promise.all([listEvalResults(run.id), listQaReportsForEvalRun(run.id), run.processingRunId ? Promise.resolve(null) : latestCorpusRun(workspace.workspaceId)]);
  const admin = isAdmin(workspace.role);
  const error = one(sp.error);
  const typeFilter = one(sp.type);
  const m = metricsOf(run);
  const regression = regressionOf(run);
  const duration = run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null;
  const reportRunId = run.processingRunId ?? corpusRun?.id ?? null;

  const targets: { label: string; value: number; target: number }[] = m
    ? [
        { label: "scalar exact accuracy", value: m.extraction.scalar_exact_accuracy, target: SUCCESS_TARGETS.scalarExactAccuracy },
        { label: "list micro-F1", value: m.extraction.list_micro_f1, target: SUCCESS_TARGETS.listMicroF1 },
        { label: "evidence validity", value: m.extraction.evidence_validity, target: SUCCESS_TARGETS.evidenceValidity },
        { label: "classification accuracy", value: m.extraction.classification_accuracy, target: SUCCESS_TARGETS.classificationAccuracy },
        { label: "review recall", value: m.review.recall, target: SUCCESS_TARGETS.reviewRecall },
        { label: "review precision", value: m.review.precision, target: SUCCESS_TARGETS.reviewPrecision },
        { label: "retrieval recall@5", value: m.rag.retrieval_recall_at_5, target: SUCCESS_TARGETS.retrievalRecallAt5 },
        { label: "citation precision", value: m.rag.citation_precision, target: SUCCESS_TARGETS.citationPrecision },
        { label: "evidence-supported answers", value: m.rag.evidence_supported_rate, target: SUCCESS_TARGETS.evidenceSupportedRate },
        { label: "refusal accuracy", value: m.rag.refusal_accuracy, target: SUCCESS_TARGETS.refusalAccuracy },
        { label: "semantic score", value: m.rag.semantic_score, target: SUCCESS_TARGETS.semanticScore },
      ]
    : [];
  const targetsMet = targets.filter((t) => t.value >= t.target - 1e-9).length;

  const typeCounts = new Map<string, { total: number; failed: number }>();
  for (const r of results) {
    const c = typeCounts.get(r.evalCase.caseType) ?? { total: 0, failed: 0 };
    c.total++;
    if (!r.result.passed) c.failed++;
    typeCounts.set(r.evalCase.caseType, c);
  }
  const shown = typeFilter ? results.filter((r) => r.evalCase.caseType === typeFilter) : results;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Eval run <Mono title={run.id}>{shortId(run.id)}</Mono> <StatusBadge status={run.status} />
            {run.isBaseline ? <StatusBadge status="accepted" title="baseline run" /> : null}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              provider <Mono>{run.provider}</Mono>
            </span>
            <span>
              model config <Mono title={run.modelConfigHash}>{shortId(run.modelConfigHash)}</Mono>
            </span>
            {run.processingRunId ? (
              <span>
                processing run{" "}
                <Link href={`/runs/${run.processingRunId}`} className="text-[var(--accent)] underline">
                  <Mono>{shortId(run.processingRunId)}</Mono>
                </Link>
              </span>
            ) : (
              <span>no processing run attached</span>
            )}
            {run.baselineEvalRunId ? (
              <span>
                baseline{" "}
                <Link href={`/evals/${run.baselineEvalRunId}`} className="text-[var(--accent)] underline">
                  <Mono>{shortId(run.baselineEvalRunId)}</Mono>
                </Link>
              </span>
            ) : (
              <span>no baseline</span>
            )}
            <span>started {fmtDate(run.startedAt, true)}</span>
            <span>completed {fmtDate(run.completedAt, true) || "not yet"}</span>
            <span>duration {fmtDuration(duration) || "n/a"}</span>
          </span>
        }
        actions={
          <>
            {admin ? (
              <form action={generateEvalReportAction}>
                <input type="hidden" name="evalRunId" value={run.id} />
                <FormButton variant="secondary" pendingText="Generating..." disabled={!reportRunId} title={reportRunId ? `Build the HTML QA report for run ${shortId(reportRunId)} with this evaluation attached` : "No processing run to report on"}>
                  Generate QA report
                </FormButton>
              </form>
            ) : null}
            <Link href="/evals" className="text-sm text-[var(--accent)] underline">
              All evals
            </Link>
          </>
        }
      />
      {error ? <div className="mb-3 rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">{error}</div> : null}
      {run.errorMessage ? <div className="mb-3 rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">{run.errorMessage}</div> : null}

      {reports.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
          <span>QA reports:</span>
          {reports.map((r) => (
            <span key={r.id} className="flex items-center gap-1">
              <StatusBadge status={r.status} title={r.errorMessage ?? undefined} />
              {r.status === "generated" ? (
                <>
                  <Link href={`/reports/${r.id}`} className="text-[var(--accent)] underline">
                    view
                  </Link>
                  <a href={`/reports/${r.id}?download=1`} className="text-[var(--accent)] underline">
                    download
                  </a>
                </>
              ) : null}
              <Mono>{fmtDate(r.createdAt, true)}</Mono>
            </span>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Cases passed" value={m ? `${m.cases.passed} / ${m.cases.total}` : "n/a"} tone={m ? (m.cases.failed === 0 ? "ok" : "bad") : undefined} hint={m ? `${m.cases.failed} failed` : undefined} />
        <StatCard label="Targets met" value={m ? `${targetsMet} / ${targets.length}` : "n/a"} tone={m ? (targetsMet === targets.length ? "ok" : "warn") : undefined} />
        <StatCard label="Regression" value={regression ? (regression.passed ? "passed" : "failed") : "n/a"} tone={regression ? (regression.passed ? "ok" : "bad") : undefined} hint={regression ? (regression.hasBaseline ? "vs baseline" : "no baseline: absolute rules only") : undefined} />
        <StatCard label="Duplicates" value={m ? `${m.integrity.duplicate_cases_passed} / ${m.integrity.duplicate_cases}` : "n/a"} tone={m ? (m.integrity.duplicate_records > 0 ? "bad" : "ok") : undefined} hint={m ? `${m.integrity.duplicate_records} duplicate record(s)` : undefined} />
        <StatCard label="Versions" value={m ? `${m.integrity.version_cases_passed} / ${m.integrity.version_cases}` : "n/a"} tone={m ? (m.integrity.version_cases_passed === m.integrity.version_cases ? "ok" : "bad") : undefined} hint="version cases passed" />
        <StatCard label="Est. cost" value={m ? fmtUsd(m.cost.estimated_cost_usd) : "n/a"} hint={m ? `${fmtNumber(m.cost.input_tokens)} in / ${fmtNumber(m.cost.output_tokens)} out` : undefined} />
        <StatCard label="Latency p50" value={m ? fmtDuration(m.cost.latency_p50_ms) : "n/a"} hint="per case" />
        <StatCard label="Latency p95" value={m ? fmtDuration(m.cost.latency_p95_ms) : "n/a"} />
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <div>
          <SectionHeader title="Metrics vs success targets" />
          <Table>
            <THead>
              <Th>Metric</Th>
              <Th align="right">Value</Th>
              <Th align="right">Target</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {targets.length === 0 ? <TableEmpty colSpan={4}>No aggregate metrics recorded{run.status === "running" ? " yet" : ""}.</TableEmpty> : null}
              {targets.map((t) => (
                <Tr key={t.label}>
                  <Td>{t.label}</Td>
                  <Td align="right">{t.label === "semantic score" ? t.value.toFixed(3) : fmtPct(t.value, 1)}</Td>
                  <Td align="right">{t.label === "semantic score" ? t.target.toFixed(2) : fmtPct(t.target, 0)}</Td>
                  <Td>
                    <PassBadge ok={t.value >= t.target - 1e-9} />
                  </Td>
                </Tr>
              ))}
              {m ? (
                <>
                  <Tr>
                    <Td>review items below threshold missing</Td>
                    <Td align="right">{m.review.below_threshold_missing}</Td>
                    <Td align="right">0</Td>
                    <Td>
                      <PassBadge ok={m.review.below_threshold_missing === 0} />
                    </Td>
                  </Tr>
                  <Tr>
                    <Td>duplicate records</Td>
                    <Td align="right">{m.integrity.duplicate_records}</Td>
                    <Td align="right">0</Td>
                    <Td>
                      <PassBadge ok={m.integrity.duplicate_records === 0} />
                    </Td>
                  </Tr>
                </>
              ) : null}
            </tbody>
          </Table>
          {m ? (
            <div className="mt-1 text-xs text-[var(--muted)]">
              {m.extraction.documents} document(s), {m.extraction.scalar_fields} scalar field(s); review planted {m.review.planted_caught} / {m.review.planted} caught, {m.review.routed} routed; rag {m.rag.answer_cases} answer, {m.rag.refusal_cases} refusal, {m.rag.retrieval_cases} retrieval case(s), false refusal rate {fmtPct(m.rag.false_refusal_rate, 1)}
            </div>
          ) : null}
        </div>
        <div>
          <SectionHeader title="Regression checks" actions={regression ? <span className="text-xs text-[var(--muted)]">{regression.hasBaseline ? <>baseline <Mono>{shortId(regression.baselineEvalRunId)}</Mono></> : "no baseline: drop rules pass by default"}</span> : null} />
          <Table>
            <THead>
              <Th>Metric</Th>
              <Th align="right">Baseline</Th>
              <Th align="right">Current</Th>
              <Th>Rule</Th>
              <Th>Status</Th>
            </THead>
            <tbody>
              {!regression ? <TableEmpty colSpan={5}>No regression report recorded.</TableEmpty> : null}
              {regression?.checks.map((c) => (
                <Tr key={c.metric}>
                  <Td>
                    <Mono>{c.metric}</Mono>
                  </Td>
                  <Td align="right">{c.baseline === null ? <span className="text-[var(--muted)]">n/a</span> : c.baseline.toFixed(3)}</Td>
                  <Td align="right">{c.current.toFixed(3)}</Td>
                  <Td>
                    <Mono>{c.threshold}</Mono>
                  </Td>
                  <Td>
                    <PassBadge ok={c.passed} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      <SectionHeader
        title="Case results"
        count={shown.length}
        actions={
          <nav className="flex flex-wrap items-center gap-1 text-xs">
            <Link href={`/evals/${run.id}`} className={`rounded border px-2 py-0.5 ${!typeFilter ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--fg)]"}`}>
              all {results.length}
            </Link>
            {EVAL_CASE_TYPES.filter((t) => typeCounts.has(t)).map((t) => {
              const c = typeCounts.get(t)!;
              return (
                <Link key={t} href={`/evals/${run.id}?type=${t}`} className={`rounded border px-2 py-0.5 ${typeFilter === t ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--line)] text-[var(--fg)]"}`}>
                  {t} {c.total}
                  {c.failed > 0 ? <span className="ml-1 text-[var(--bad)]">{c.failed} failed</span> : null}
                </Link>
              );
            })}
          </nav>
        }
      />
      <Table>
        <THead>
          <Th>Case</Th>
          <Th>Type</Th>
          <Th>Result</Th>
          <Th>Metrics</Th>
          <Th>Judge reason</Th>
          <Th align="right">Latency</Th>
        </THead>
        <tbody>
          {shown.length === 0 ? <TableEmpty colSpan={6}>No case results{typeFilter ? ` of type ${typeFilter}` : ""}.</TableEmpty> : null}
          {shown.map(({ result, evalCase }) => {
            const entries = Object.entries(result.metricJson).filter(([k]) => !HIDDEN_METRIC_KEYS.has(k));
            return (
              <Tr key={result.id} className={result.passed ? "" : "bg-[color-mix(in_srgb,var(--bad)_5%,white)]"}>
                <Td>
                  <Mono>{evalCase.caseKey}</Mono>
                  {evalCase.question ? (
                    <div className="max-w-[320px] truncate text-xs text-[var(--muted)]" title={evalCase.question}>
                      {evalCase.question}
                    </div>
                  ) : evalCase.documentLogicalKey ? (
                    <div className="text-xs text-[var(--muted)]">
                      <Mono>{evalCase.documentLogicalKey}</Mono>
                    </div>
                  ) : null}
                </Td>
                <Td>{evalCase.caseType}</Td>
                <Td>
                  <PassBadge ok={result.passed} />
                  {result.metricJson.cache_hit ? <div className="text-[10px] text-[var(--muted)]">cached</div> : null}
                </Td>
                <Td className="max-w-[460px]">
                  <span className="flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[11px]">
                    {entries.map(([k, v]) => (
                      <span key={k} title={typeof v === "object" && v !== null ? JSON.stringify(v, null, 1) : undefined}>
                        <span className="text-[var(--muted)]">{k}=</span>
                        {fmtMetric(v)}
                      </span>
                    ))}
                  </span>
                </Td>
                <Td className="max-w-[300px] text-xs">{result.judgeReason ?? ""}</Td>
                <Td align="right">{fmtDuration(result.latencyMs)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
