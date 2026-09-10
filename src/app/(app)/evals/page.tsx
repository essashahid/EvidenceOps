import { jobsConfigured } from "@/lib/env";
import Link from "next/link";
import { BookOpenCheck, Play } from "lucide-react";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { listEvalRuns, metricsOf, regressionOf } from "@/lib/queries/evals";
import { latestCorpusRun } from "@/lib/eval/corpus";
import { SUCCESS_TARGETS } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { FormButton } from "@/components/FormButton";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Notice } from "@/components/ui/panel";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty, rowLink } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty";
import { fmtDuration, fmtPct, shortId } from "@/components/format";
import { runEvaluationAction } from "./actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

/** A metric cell that reads against its target without shouting when it passes. */
function MetricCell({ value, target, digits = 1, asRatio = false }: { value: number | undefined; target: number; digits?: number; asRatio?: boolean }) {
  if (value === undefined) return <span className="text-[var(--faint)]">—</span>;
  const met = value >= target - 1e-9;
  return (
    <span className={cn("tnum", met ? "" : "font-semibold text-[var(--bad)]")} title={met ? `Target ${asRatio ? target.toFixed(2) : fmtPct(target)} met` : `Below the ${asRatio ? target.toFixed(2) : fmtPct(target)} target`}>
      {asRatio ? value.toFixed(3) : fmtPct(value, digits)}
    </span>
  );
}

export default async function EvalsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const [runs, corpusRun] = await Promise.all([listEvalRuns(workspace.workspaceId), latestCorpusRun(workspace.workspaceId)]);
  const admin = isAdmin(workspace.role) && jobsConfigured();
  const error = one(sp.error);

  const latest = runs[0];
  const latestMetrics = latest ? metricsOf(latest) : null;
  const baseline = runs.find((r) => r.isBaseline);
  const regressions = runs.filter((r) => r.regressionPassed === false).length;
  // Comparison can also come from the committed baseline file when no run is flagged.
  const fileBaseline = !baseline && regressionOf(latest ?? { regressionJson: {} })?.hasBaseline;

  return (
    <>
      <PageHeader
        title="Evaluations"
        subtitle="The golden suite scores extraction, provenance, review routing, retrieval, cited answers, refusals and corpus integrity, then compares the result against the baseline."
        actions={
          admin ? (
            <form action={runEvaluationAction} className="flex items-center gap-2">
              <span className="hidden text-[12.5px] text-[var(--muted)] sm:inline">
                {corpusRun ? (
                  <>
                    attaches run <Mono title={corpusRun.id}>{shortId(corpusRun.id)}</Mono>
                  </>
                ) : (
                  "no corpus run yet"
                )}
              </span>
              <FormButton size="sm" pendingText="Running the suite…" title="Runs every active eval case against the current corpus">
                <Play size={14} aria-hidden />
                Run evaluation
              </FormButton>
            </form>
          ) : (
            <span className="text-[12.5px] text-[var(--muted)]">Running evaluations requires the admin role</span>
          )
        }
      />

      {error ? (
        <Notice tone="bad" className="mb-4">
          {error}
        </Notice>
      ) : null}

      {runs.length === 0 ? (
        <EmptyState icon={<BookOpenCheck size={18} aria-hidden />} title="No evaluation has run yet">
          The golden suite measures the pipeline against committed fixtures and fails the build on regression. Run it once to establish a baseline.
        </EmptyState>
      ) : (
        <>
          <MetricGroup className="mb-4">
            <Metric
              label="Latest result"
              value={latest?.regressionPassed === null ? "—" : latest?.regressionPassed ? "Pass" : "Regression"}
              tone={latest?.regressionPassed === false ? "bad" : "ok"}
              hint={latest ? `Run ${shortId(latest.id)}` : undefined}
              href={latest ? `/evals/${latest.id}` : undefined}
            />
            <Metric label="Cases passed" value={latestMetrics ? `${latestMetrics.cases.passed}/${latestMetrics.cases.total}` : "—"} tone={latestMetrics && latestMetrics.cases.failed > 0 ? "warn" : "ok"} hint={latestMetrics ? `${latestMetrics.cases.failed} failed` : undefined} />
            <Metric label="Runs recorded" value={runs.length} hint={regressions > 0 ? `${regressions} with a regression` : "No regressions recorded"} tone={regressions > 0 ? "warn" : "default"} />
            <Metric
              label="Baseline"
              value={baseline ? shortId(baseline.id) : fileBaseline ? "Committed" : "None"}
              hint={baseline ? "Comparison target for new runs" : fileBaseline ? `From eval/baselines/${latest?.provider ?? "provider"}.json` : "The next run becomes the baseline"}
              href={baseline ? `/evals/${baseline.id}` : undefined}
              className={baseline ? "[&_div:nth-child(2)]:font-mono [&_div:nth-child(2)]:text-[18px]" : "[&_div:nth-child(2)]:text-[18px]"}
            />
          </MetricGroup>

          <Table minWidth={1240}>
            <THead sticky>
              <Th width={150}>Run</Th>
              <Th width={130}>Status</Th>
              <Th align="right" width={90}>
                Cases
              </Th>
              <Th align="right" width={90}>
                Scalar acc.
              </Th>
              <Th align="right" width={80}>
                List F1
              </Th>
              <Th align="right" width={90}>
                Evidence
              </Th>
              <Th align="right" width={100}>
                Review recall
              </Th>
              <Th align="right" width={95}>
                Recall@5
              </Th>
              <Th align="right" width={95}>
                Citations
              </Th>
              <Th align="right" width={90}>
                Refusals
              </Th>
              <Th align="right" width={90}>
                Semantic
              </Th>
              <Th width={130}>Regression</Th>
              <Th align="right" width={90}>
                Duration
              </Th>
              <Th align="right" width={110}>
                Started
              </Th>
            </THead>
            <tbody>
              {runs.length === 0 ? <TableEmpty colSpan={14}>No evaluation runs yet.</TableEmpty> : null}
              {runs.map((r) => {
                const m = metricsOf(r);
                const duration = r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
                return (
                  <Tr key={r.id} className={r.isBaseline ? "bg-[var(--info-soft)]/40" : undefined}>
                    <Td>
                      <div className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5">
                          <Link href={`/evals/${r.id}`} className={rowLink}>
                            <Mono title={r.id}>{shortId(r.id)}</Mono>
                          </Link>
                          {r.isBaseline ? <StatusBadge status="baseline" size="sm" /> : null}
                        </span>
                        <span className="text-[11.5px] text-[var(--muted)]">
                          {r.provider} · <Mono title={r.modelConfigHash}>{shortId(r.modelConfigHash)}</Mono>
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} title={r.errorMessage ?? undefined} />
                    </Td>
                    <Td align="right">
                      {m ? (
                        <span className={m.cases.failed > 0 ? "text-[var(--warn)]" : ""} title={`${m.cases.failed} failed`}>
                          {m.cases.passed}/{m.cases.total}
                        </span>
                      ) : (
                        <span className="text-[var(--faint)]">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.extraction.scalar_exact_accuracy} target={SUCCESS_TARGETS.scalarExactAccuracy} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.extraction.list_micro_f1} target={SUCCESS_TARGETS.listMicroF1} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.extraction.provenance_validity} target={SUCCESS_TARGETS.provenanceValidity} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.review.recall} target={SUCCESS_TARGETS.reviewRecall} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.rag.retrieval_recall_at_5} target={SUCCESS_TARGETS.retrievalRecallAt5} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.rag.citation_precision} target={SUCCESS_TARGETS.citationPrecision} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.rag.refusal_accuracy} target={SUCCESS_TARGETS.refusalAccuracy} />
                    </Td>
                    <Td align="right">
                      <MetricCell value={m?.rag.semantic_score} target={SUCCESS_TARGETS.semanticScore} asRatio />
                    </Td>
                    <Td>
                      {r.regressionPassed === null ? <span className="text-[var(--faint)]">—</span> : <StatusBadge status={r.regressionPassed ? "pass" : "fail"} title="Regression rules against the baseline" />}
                    </Td>
                    <Td align="right">{fmtDuration(duration) || <span className="text-[var(--faint)]">—</span>}</Td>
                    <Td align="right">
                      <TimeAgo value={r.startedAt} />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </>
  );
}
