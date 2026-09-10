import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EvaluationCharts } from "@/components/QualityCharts";
import { getDb, schema } from "@/lib/db/client";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { getEvalRun, listEvalResults, listQaReportsForEvalRun, metricsOf, regressionOf } from "@/lib/queries/evals";
import { latestCorpusRun } from "@/lib/eval/corpus";
import { EVAL_CASE_TYPES } from "@/lib/db/schema";
import { SUCCESS_TARGETS } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelHeader, SectionTitle, Notice } from "@/components/ui/panel";
import { Metric, MetricGroup, MetricStrip } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/badge";
import { FormButton } from "@/components/FormButton";
import { Button } from "@/components/ui/button";
import { MetaRow } from "@/components/ui/kv";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/ui/table";
import { TimeStamp } from "@/components/ui/time";
import { EmptyLine } from "@/components/ui/empty";
import { fmtDate, fmtDuration, fmtNumber, fmtPct, fmtUsd, plural, shortId, truncate } from "@/components/format";
import { generateEvalReportAction } from "../actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const HIDDEN_METRIC_KEYS = new Set(["cache_key", "answer_id", "cache_hit"]);
/** For a passing case only the headline numbers are worth a row; failures show everything. */
const HEADLINE_METRIC_KEYS = ["semantic_score", "correctness", "recall_at_5", "list_f1", "validity", "citations_valid", "caught", "refused"];
const CASE_PAGE = 60;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtMetric(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return truncate(v, 60);
  return truncate(JSON.stringify(v), 80);
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
  const showAll = one(sp.cases) === "all";
  const m = metricsOf(run);
  const regression = regressionOf(run);
  const duration = run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null;
  const reportRunId = run.processingRunId ?? corpusRun?.id ?? null;

  const targets: { label: string; value: number; target: number; ratio?: boolean }[] = m
    ? [
        { label: "Scalar exact accuracy", value: m.extraction.scalar_exact_accuracy, target: SUCCESS_TARGETS.scalarExactAccuracy },
        { label: "List micro-F1", value: m.extraction.list_micro_f1, target: SUCCESS_TARGETS.listMicroF1 },
        { label: "Evidence validity", value: m.extraction.provenance_validity, target: SUCCESS_TARGETS.provenanceValidity },
        { label: "Classification accuracy", value: m.extraction.classification_accuracy, target: SUCCESS_TARGETS.classificationAccuracy },
        { label: "Review recall", value: m.review.recall, target: SUCCESS_TARGETS.reviewRecall },
        { label: "Review precision", value: m.review.precision, target: SUCCESS_TARGETS.reviewPrecision },
        { label: "Retrieval recall@5", value: m.rag.retrieval_recall_at_5, target: SUCCESS_TARGETS.retrievalRecallAt5 },
        { label: "Citation precision", value: m.rag.citation_precision, target: SUCCESS_TARGETS.citationPrecision },
        { label: "Evidence-supported answers", value: m.rag.evidence_supported_rate, target: SUCCESS_TARGETS.evidenceSupportedRate },
        { label: "Refusal accuracy", value: m.rag.refusal_accuracy, target: SUCCESS_TARGETS.refusalAccuracy },
        { label: "Semantic score", value: m.rag.semantic_score, target: SUCCESS_TARGETS.semanticScore, ratio: true },
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
  const confidence = await getDb()
    .select({ band: sql<string>`case when confidence < 0.65 then '< 65%' when confidence < 0.86 then '65–86%' else '≥ 86%' end`, n: sql<number>`count(*)::int` })
    .from(schema.fieldValues)
    .innerJoin(schema.recordVersions, eq(schema.fieldValues.recordVersionId, schema.recordVersions.id))
    .innerJoin(schema.documentVersions, eq(schema.recordVersions.documentVersionId, schema.documentVersions.id))
    .where(and(eq(schema.documentVersions.workspaceId, workspace.workspaceId), eq(schema.documentVersions.isCurrent, true), eq(schema.recordVersions.isCurrent, true)))
    .groupBy(sql`1`);
  const comparison = (regression?.checks ?? [])
    .filter((c) => ["extraction.scalar_exact_accuracy", "review.recall", "rag.citation_precision"].includes(c.metric))
    .map((c) => ({ name: c.metric.startsWith("extraction") ? "Extraction" : c.metric.startsWith("review") ? "Review" : "Citations", baseline: c.baseline === null ? undefined : c.baseline * 100, latest: c.current * 100 }));

  const filteredResults = typeFilter ? results.filter((r) => r.evalCase.caseType === typeFilter) : results;
  const shown = showAll ? filteredResults : filteredResults.slice(0, CASE_PAGE);
  const failedCount = results.filter((r) => !r.result.passed).length;
  const verdict = regression?.passed ?? null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Evaluations", href: "/evals" }, { label: shortId(run.id) }]}
        title={
          <>
            Evaluation run
            <Mono className="text-[18px] text-[var(--muted)]" title={run.id}>
              {shortId(run.id)}
            </Mono>
            <StatusBadge status={run.status} />
            {run.isBaseline ? <StatusBadge status="baseline" title="This run is the comparison baseline" /> : null}
          </>
        }
        meta={
          <MetaRow
            items={[
              { label: "Provider", value: <Mono>{run.provider}</Mono> },
              { label: "Model config", value: <Mono title={run.modelConfigHash}>{shortId(run.modelConfigHash)}</Mono> },
              {
                label: "Processing run",
                value: run.processingRunId ? (
                  <Link href={`/runs/${run.processingRunId}`} className="text-[var(--accent)] hover:underline">
                    <Mono>{shortId(run.processingRunId)}</Mono>
                  </Link>
                ) : (
                  "none attached"
                ),
              },
              {
                label: "Baseline",
                value: run.baselineEvalRunId ? (
                  <Link href={`/evals/${run.baselineEvalRunId}`} className="text-[var(--accent)] hover:underline">
                    <Mono>{shortId(run.baselineEvalRunId)}</Mono>
                  </Link>
                ) : regression?.hasBaseline ? (
                  "committed file"
                ) : (
                  "none"
                ),
              },
              { label: "Started", value: fmtDate(run.startedAt, true) },
              { label: "Duration", value: fmtDuration(duration) || "in progress" },
            ]}
          />
        }
        actions={
          <>
            <AutoRefresh active={run.status === "running"} />
            {admin ? (
              <form action={generateEvalReportAction}>
                <input type="hidden" name="evalRunId" value={run.id} />
                <FormButton
                  variant="secondary"
                  size="sm"
                  pendingText="Generating…"
                  disabled={!reportRunId}
                  title={reportRunId ? `Build the HTML QA report for run ${shortId(reportRunId)} with this evaluation attached` : "No processing run to report on"}
                >
                  Generate QA report
                </FormButton>
              </form>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href="/evals">All evaluations</Link>
            </Button>
          </>
        }
      />

      {error ? (
        <Notice tone="bad" className="mb-4">
          {error}
        </Notice>
      ) : null}
      {run.errorMessage ? (
        <Notice tone="bad" title="Run error" className="mb-4">
          {run.errorMessage}
        </Notice>
      ) : null}

      {/* The verdict is the headline of an evaluation, so it leads the page. */}
      {m ? (
        <Notice
          tone={verdict === false ? "bad" : targetsMet < targets.length ? "warn" : "ok"}
          title={verdict === false ? "Regression detected." : targetsMet < targets.length ? `${targets.length - targetsMet} success target(s) missed.` : "All success targets met and no regression."}
          className="mb-4"
          actions={
            reports.length > 0 && reports[0]!.status === "generated" ? (
              <Button asChild variant="secondary" size="xs">
                <Link href={`/reports/${reports[0]!.id}`}>Open QA report</Link>
              </Button>
            ) : null
          }
        >
          {m.cases.passed} of {m.cases.total} cases passed
          {failedCount > 0 ? `, ${failedCount} failed` : ""}. {regression?.hasBaseline ? "Compared against the baseline run." : "No baseline yet: absolute rules only."}
        </Notice>
      ) : null}

      {m?.cost.cached_answer_cases ? (
        <p className="mb-3 text-[12.5px] text-[var(--muted)]">
          {plural(Number(m.cost.cached_answer_cases), "answer")} reused from a matching completed evaluation; cost reflects only the calls this run made.
        </p>
      ) : null}

      {m ? (
        <>
          <MetricGroup columns={4} className="mb-4">
            <Metric size="lg" label="Cases passed" value={`${m.cases.passed}/${m.cases.total}`} tone={m.cases.failed === 0 ? "ok" : "warn"} hint={m.cases.failed === 0 ? "Every case passed" : `${m.cases.failed} failed`} />
            <Metric size="lg" label="Targets met" value={`${targetsMet}/${targets.length}`} tone={targetsMet === targets.length ? "ok" : "bad"} hint="Against the success criteria" />
            <Metric size="lg" label="Regression" value={verdict === null ? "—" : verdict ? "Passed" : "Failed"} tone={verdict === false ? "bad" : "ok"} hint={regression?.hasBaseline ? "Versus baseline" : "No baseline: absolute rules"} />
            <Metric size="lg" label="Estimated cost" value={fmtUsd(m.cost.estimated_cost_usd)} hint={`${fmtNumber(m.cost.input_tokens)} in / ${fmtNumber(m.cost.output_tokens)} out`} />
          </MetricGroup>

          <Panel className="mb-5">
            <MetricStrip
              items={[
                { label: "Duplicates", value: `${m.integrity.duplicate_cases_passed}/${m.integrity.duplicate_cases}`, tone: m.integrity.duplicate_records > 0 ? "bad" : "ok" },
                { label: "Versions", value: `${m.integrity.version_cases_passed}/${m.integrity.version_cases}`, tone: m.integrity.version_cases_passed === m.integrity.version_cases ? "ok" : "bad" },
                { label: "Duplicate records", value: m.integrity.duplicate_records, tone: m.integrity.duplicate_records > 0 ? "bad" : "ok" },
                { label: "Documents", value: m.extraction.documents },
                { label: "Latency p50", value: fmtDuration(m.cost.latency_p50_ms) || "—" },
                { label: "Latency p95", value: fmtDuration(m.cost.latency_p95_ms) || "—" },
              ]}
            />
          </Panel>

          <div className="mb-6">
            <EvaluationCharts
              comparison={comparison}
              distribution={confidence.map((c) => ({ name: c.band, count: Number(c.n) }))}
              failures={[...typeCounts].map(([name, c]) => ({ name: name.replace("review_routing", "review"), count: c.failed }))}
            />
          </div>
        </>
      ) : null}

      {reports.length > 0 ? (
        <Panel className="mb-5">
          <PanelHeader dense title="QA reports" />
          <ul className="divide-y divide-[var(--line)]">
            {reports.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-[13px]">
                <StatusBadge status={r.status} size="sm" title={r.errorMessage ?? undefined} />
                <TimeStamp value={r.createdAt} withSeconds />
                {r.status === "generated" ? (
                  <span className="ml-auto flex items-center gap-2">
                    <Button asChild variant="secondary" size="xs">
                      <Link href={`/reports/${r.id}`}>View</Link>
                    </Button>
                    <Button asChild variant="ghost" size="xs">
                      <a href={`/reports/${r.id}?download=1`}>Download</a>
                    </Button>
                  </span>
                ) : r.errorMessage ? (
                  <span className="text-[var(--bad)]">{r.errorMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <section className="min-w-0">
          <SectionTitle title="Metrics against success targets" />
          <Table minWidth={480}>
            <THead>
              <Th>Metric</Th>
              <Th align="right" width={90}>
                Value
              </Th>
              <Th align="right" width={80}>
                Target
              </Th>
              <Th width={80}>Status</Th>
            </THead>
            <tbody>
              {targets.length === 0 ? <TableEmpty colSpan={4}>No aggregate metrics recorded{run.status === "running" ? " yet" : ""}.</TableEmpty> : null}
              {targets.map((t) => {
                const ok = t.value >= t.target - 1e-9;
                return (
                  <Tr key={t.label}>
                    <Td>{t.label}</Td>
                    <Td align="right" className={cn("font-medium", !ok && "text-[var(--bad)]")}>
                      {t.ratio ? t.value.toFixed(3) : fmtPct(t.value, 1)}
                    </Td>
                    <Td align="right" className="text-[var(--muted)]">
                      {t.ratio ? t.target.toFixed(2) : fmtPct(t.target, 0)}
                    </Td>
                    <Td>
                      <StatusBadge status={ok ? "pass" : "fail"} size="sm" />
                    </Td>
                  </Tr>
                );
              })}
              {m ? (
                <>
                  <Tr>
                    <Td>Below-threshold fields without review</Td>
                    <Td align="right" className={cn("font-medium", m.review.below_threshold_missing > 0 && "text-[var(--bad)]")}>
                      {m.review.below_threshold_missing}
                    </Td>
                    <Td align="right" className="text-[var(--muted)]">
                      0
                    </Td>
                    <Td>
                      <StatusBadge status={m.review.below_threshold_missing === 0 ? "pass" : "fail"} size="sm" />
                    </Td>
                  </Tr>
                  <Tr>
                    <Td>Duplicate records created</Td>
                    <Td align="right" className={cn("font-medium", m.integrity.duplicate_records > 0 && "text-[var(--bad)]")}>
                      {m.integrity.duplicate_records}
                    </Td>
                    <Td align="right" className="text-[var(--muted)]">
                      0
                    </Td>
                    <Td>
                      <StatusBadge status={m.integrity.duplicate_records === 0 ? "pass" : "fail"} size="sm" />
                    </Td>
                  </Tr>
                </>
              ) : null}
            </tbody>
          </Table>
          {m ? (
            <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">
              {plural(m.extraction.documents, "document")}, {plural(m.extraction.scalar_fields, "scalar field")}. Review caught {m.review.planted_caught} of {m.review.planted} planted issues across {m.review.routed} routed
              fields. RAG: {m.rag.single_document_cases + m.rag.cross_document_cases} answer and {m.rag.unanswerable_cases} refusal cases, false refusal rate {fmtPct(m.rag.false_refusal_rate, 1)}.
            </p>
          ) : null}
        </section>

        <section className="min-w-0">
          <SectionTitle
            title="Regression checks"
            actions={
              regression ? (
                <span className="text-[12.5px] text-[var(--muted)]">
                  {regression.hasBaseline ? (
                    <>
                      baseline <Mono>{shortId(regression.baselineEvalRunId)}</Mono>
                    </>
                  ) : (
                    "no baseline: drop rules pass by default"
                  )}
                </span>
              ) : null
            }
          />
          {!regression ? (
            <EmptyLine>No regression report was recorded for this run.</EmptyLine>
          ) : (
            <Table minWidth={520}>
              <THead>
                <Th>Metric</Th>
                <Th align="right" width={90}>
                  Baseline
                </Th>
                <Th align="right" width={90}>
                  Current
                </Th>
                <Th width={120}>Rule</Th>
                <Th width={80}>Status</Th>
              </THead>
              <tbody>
                {regression.checks.map((c) => (
                  <Tr key={c.metric}>
                    <Td>
                      <span className="font-medium">{c.label ?? c.metric}</span>
                      <div className="mt-0.5">
                        <Mono className="text-[var(--muted)]">{c.metric}</Mono>
                      </div>
                    </Td>
                    <Td align="right" className="text-[var(--muted)]">
                      {c.baseline === null ? "—" : c.baseline.toFixed(3)}
                    </Td>
                    <Td align="right" className="font-medium">
                      {c.current.toFixed(3)}
                    </Td>
                    <Td>
                      <Mono className="text-[var(--muted)]">{c.threshold}</Mono>
                    </Td>
                    <Td>
                      <StatusBadge status={c.passed ? "pass" : "fail"} size="sm" />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      </div>

      {/* ------------------------------ Case results ------------------------------ */}
      <SectionTitle
        title="Case results"
        count={filteredResults.length}
        className="mt-6"
        description="Failing cases first."
        actions={
          <nav className="flex flex-wrap items-center gap-1">
            <FilterChip href={`/evals/${run.id}`} active={!typeFilter} label="All" count={results.length} />
            {EVAL_CASE_TYPES.filter((t) => typeCounts.has(t)).map((t) => {
              const c = typeCounts.get(t)!;
              return <FilterChip key={t} href={`/evals/${run.id}?type=${t}`} active={typeFilter === t} label={t.replaceAll("_", " ")} count={c.total} failed={c.failed} />;
            })}
          </nav>
        }
      />
      <Table minWidth={1040}>
        <THead sticky>
          <Th width={230}>Case</Th>
          <Th width={130}>Type</Th>
          <Th width={90}>Result</Th>
          <Th>Metrics</Th>
          <Th width={280}>Judge reason</Th>
          <Th align="right" width={90}>
            Latency
          </Th>
        </THead>
        <tbody>
          {shown.length === 0 ? <TableEmpty colSpan={6}>No case results{typeFilter ? ` of type ${typeFilter}` : ""}.</TableEmpty> : null}
          {shown.map(({ result, evalCase }) => {
            const entries = Object.entries(result.metricJson).filter(([k]) => !HIDDEN_METRIC_KEYS.has(k));
            const shown = result.passed ? entries.filter(([k]) => HEADLINE_METRIC_KEYS.includes(k)).slice(0, 4) : entries;
            const hidden = entries.length - shown.length;
            return (
              <Tr key={result.id} className={result.passed ? undefined : "bg-[var(--bad-soft)]/50"}>
                <Td>
                  <Mono className="font-medium">{evalCase.caseKey}</Mono>
                  {evalCase.question ? (
                    <div className="mt-0.5 max-w-[220px] truncate text-[12px] text-[var(--muted)]" title={evalCase.question}>
                      {evalCase.question}
                    </div>
                  ) : evalCase.documentLogicalKey ? (
                    <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                      <Mono>{evalCase.documentLogicalKey}</Mono>
                    </div>
                  ) : null}
                </Td>
                <Td className="capitalize text-[var(--muted)]">{evalCase.caseType.replaceAll("_", " ")}</Td>
                <Td>
                  <StatusBadge status={result.passed ? "pass" : "fail"} size="sm" />
                  {result.metricJson.cache_hit ? <div className="mt-0.5 text-[11px] text-[var(--faint)]">cached</div> : null}
                </Td>
                <Td className="max-w-[420px]" title={hidden > 0 ? entries.map(([k, v]) => `${k}: ${fmtMetric(v)}`).join("\n") : undefined}>
                  <span className="flex flex-wrap gap-x-2.5 gap-y-0.5 font-mono text-[11.5px]">
                    {shown.map(([k, v]) => (
                      <span key={k} title={typeof v === "object" && v !== null ? JSON.stringify(v, null, 1) : undefined} className="whitespace-nowrap">
                        <span className="text-[var(--faint)]">{k}</span> {fmtMetric(v)}
                      </span>
                    ))}
                    {hidden > 0 ? <span className="text-[var(--faint)]">+{hidden} more</span> : null}
                  </span>
                </Td>
                <Td className="max-w-[280px] text-[12.5px] text-[var(--muted)]">{result.judgeReason ?? <span className="text-[var(--faint)]">—</span>}</Td>
                <Td align="right">{fmtDuration(result.latencyMs) || <span className="text-[var(--faint)]">—</span>}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {!showAll && filteredResults.length > CASE_PAGE ? (
        <div className="mt-3 flex items-center gap-3">
          <Button asChild variant="secondary" size="sm">
            <Link href={`/evals/${run.id}?${typeFilter ? `type=${typeFilter}&` : ""}cases=all`}>Show all {filteredResults.length} cases</Link>
          </Button>
          <span className="text-[12.5px] text-[var(--muted)]">
            Showing the first {CASE_PAGE}, failing cases first.
          </span>
        </div>
      ) : null}
    </>
  );
}

function FilterChip({ href, active, label, count, failed }: { href: string; active: boolean; label: string; count: number; failed?: number }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium capitalize transition-colors",
        active ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
      )}
    >
      {label}
      <span className="tnum opacity-70">{count}</span>
      {failed ? <span className="tnum font-semibold text-[var(--bad)]">{failed}✗</span> : null}
    </Link>
  );
}
