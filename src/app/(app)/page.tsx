import Link from "next/link";
import { ArrowRight, FileText, Upload } from "lucide-react";
import { QualityTrend } from "@/components/QualityCharts";
import { canReview, isAdmin, requireWorkspace } from "@/lib/workspace";
import { mutationAllowed } from "@/lib/access";
import { jobsConfigured } from "@/lib/env";
import { getDashboardStats, listRecentRuns } from "@/lib/queries/dashboard";
import { listDocuments } from "@/lib/queries/documents";
import { listEvalRuns, latestEvalRun, metricsOf, regressionOf } from "@/lib/queries/evals";
import { getWorkflowSnapshot } from "@/lib/queries/workflow";
import { buildStages, guideSteps, nextAction } from "@/lib/workflow";
import { PageHeader } from "@/components/PageHeader";
import { WorkflowStrip, NextActionCard } from "@/components/WorkflowStrip";
import { GettingStarted } from "@/components/GettingStarted";
import { SectionTitle, Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { Metric, MetricGroup, MetricStrip } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono, CellStack, TableEmpty, rowLink, inlineLink } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { fmtCompact, fmtNumber, fmtPct, fmtUsd, plural, shortId } from "@/components/format";
import { SUCCESS_TARGETS } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await requireWorkspace();
  const { workspace } = context;
  const [stats, runs, docs, evalRun, history, snapshot] = await Promise.all([
    getDashboardStats(workspace.workspaceId),
    listRecentRuns(workspace.workspaceId, 6),
    listDocuments(workspace.workspaceId, 6),
    latestEvalRun(workspace.workspaceId),
    listEvalRuns(workspace.workspaceId, 8),
    getWorkflowSnapshot(workspace.workspaceId),
  ]);
  const metrics = evalRun ? metricsOf(evalRun) : null;
  const regression = evalRun ? regressionOf(evalRun) : null;
  const trend = history
    .toReversed()
    .flatMap((r, i) => {
      const m = metricsOf(r);
      return m ? [{ name: `Run ${i + 1}`, extraction: m.extraction.scalar_exact_accuracy * 100, citations: m.rag.citation_precision * 100, recall: m.rag.retrieval_recall_at_5 * 100 }] : [];
    });
  const latestRun = runs[0];
  const empty = stats.documents === 0;

  const jobs = jobsConfigured();
  const perms = {
    canUpload: mutationAllowed(context) && jobs,
    canReview: mutationAllowed(context) && canReview(workspace.role),
    canAsk: mutationAllowed(context),
    canEvaluate: isAdmin(workspace.role) && jobs,
  };
  const stages = buildStages(snapshot);
  const next = nextAction(snapshot, perms);
  const guide = guideSteps(snapshot);

  return (
    <>
      {/* Hero: where the workspace is in the flow and the one thing to do next. */}
      <section className="-mx-4 mb-6 border-b border-[var(--line)] px-4 pb-6 pt-1 sm:-mx-6 sm:px-6" style={{ background: "var(--hero)" }} aria-label="Workspace status">
        <PageHeader
          className="mb-4"
          title="Workspace overview"
          subtitle={empty ? "Nothing has been uploaded yet. The flow below fills in as work happens." : "Where the corpus stands, what is waiting on a person, and how quality is trending."}
          actions={
            <>
              <Button asChild variant="secondary" size="sm">
                <Link href="/documents">
                  <FileText size={14} aria-hidden />
                  Browse documents
                </Link>
              </Button>
              {perms.canUpload ? (
                <Button asChild size="sm">
                  <Link href="/upload">
                    <Upload size={14} aria-hidden />
                    Upload documents
                  </Link>
                </Button>
              ) : null}
            </>
          }
        />
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <WorkflowStrip stages={stages} />
          <NextActionCard action={next} />
        </div>
      </section>

      <GettingStarted steps={guide} storageKey={`eo:guide:${workspace.workspaceId}`} />

      {empty ? null : (
        <>
          {/* The four numbers that describe the workspace right now. */}
          <MetricGroup className="mb-3">
            <Metric size="lg" label="Documents" value={fmtNumber(stats.documents)} hint={`${plural(stats.versions, "source version")} preserved`} href="/documents" />
            <Metric
              size="lg"
              label="Open review items"
              value={fmtNumber(stats.openReviewItems)}
              tone={stats.openReviewItems > 0 ? "warn" : "ok"}
              hint={stats.openReviewItems > 0 ? "Awaiting a reviewer decision" : "Nothing waiting on a reviewer"}
              href="/review"
            />
            <Metric
              size="lg"
              label="Extraction accuracy"
              value={metrics ? fmtPct(metrics.extraction.scalar_exact_accuracy, 1) : "—"}
              tone={metrics ? (metrics.extraction.scalar_exact_accuracy >= SUCCESS_TARGETS.scalarExactAccuracy ? "ok" : "bad") : "default"}
              hint="Latest evaluation"
              target={metrics ? { met: metrics.extraction.scalar_exact_accuracy >= SUCCESS_TARGETS.scalarExactAccuracy, text: `target ${fmtPct(SUCCESS_TARGETS.scalarExactAccuracy)}` } : undefined}
              href={evalRun ? `/evals/${evalRun.id}` : "/evals"}
            />
            <Metric
              size="lg"
              label="Citation precision"
              value={metrics ? fmtPct(metrics.rag.citation_precision, 1) : "—"}
              tone={metrics ? (metrics.rag.citation_precision >= SUCCESS_TARGETS.citationPrecision ? "ok" : "bad") : "default"}
              hint="Latest evaluation"
              target={metrics ? { met: metrics.rag.citation_precision >= SUCCESS_TARGETS.citationPrecision, text: `target ${fmtPct(SUCCESS_TARGETS.citationPrecision)}` } : undefined}
              href={evalRun ? `/evals/${evalRun.id}` : "/evals"}
            />
          </MetricGroup>

          {/* Operational secondaries stay quiet: one strip, no cards. */}
          <Panel className="mb-6">
            <MetricStrip
              items={[
                { label: "Latest run", value: latestRun ? <StatusBadge status={latestRun.status} /> : "—", title: latestRun ? `run ${latestRun.id}` : undefined },
                { label: "Latest run cost", value: latestRun ? fmtUsd(latestRun.estimatedCostUsd) : "—" },
                { label: "Runs recorded", value: fmtNumber(stats.runsTotal) },
                { label: "Open failures", value: fmtNumber(stats.deadLettersOpen), tone: stats.deadLettersOpen > 0 ? "bad" : "ok" },
                { label: "Total spend", value: fmtUsd(stats.costUsd) },
                { label: "Tokens used", value: fmtCompact(stats.inputTokens + stats.outputTokens + stats.embeddingTokens) },
              ]}
            />
          </Panel>

          {/* Quality: trend on the left, the run that produced the numbers on the right. */}
          <SectionTitle
            title="Quality"
            description="Golden-suite results across recent evaluation runs."
            actions={
              <Link href="/evals" className={`${inlineLink} text-[13px]`}>
                All evaluations
              </Link>
            }
          />
          <div className="mb-6 grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <Panel>
              <PanelHeader title="Quality over time" description={trend.length > 1 ? `${trend.length} evaluation runs` : undefined} />
              <PanelBody className="p-3">
                {trend.length > 1 ? (
                  <QualityTrend data={trend} />
                ) : (
                  <div className="flex h-[196px] flex-col items-center justify-center gap-1 text-center text-[13px]">
                    <span className="font-medium">Not enough history yet</span>
                    <span className="text-[var(--muted)]">A trend appears once a second evaluation run completes.</span>
                  </div>
                )}
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader
                title="Latest evaluation"
                actions={
                  evalRun ? (
                    <Button asChild variant="secondary" size="xs">
                      <Link href={`/evals/${evalRun.id}`}>
                        Open run
                        <ArrowRight size={13} aria-hidden />
                      </Link>
                    </Button>
                  ) : null
                }
              />
              {evalRun ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5 text-[12.5px] text-[var(--muted)]">
                    <Mono title={evalRun.id}>{shortId(evalRun.id)}</Mono>
                    <StatusBadge status={evalRun.status} size="sm" />
                    {evalRun.regressionPassed === null ? null : (
                      <StatusBadge status={evalRun.regressionPassed ? "pass" : "fail"} size="sm" title={regression?.hasBaseline ? "Compared against the baseline run" : "No baseline: absolute rules only"} />
                    )}
                    {evalRun.isBaseline ? <StatusBadge status="baseline" size="sm" /> : null}
                    <TimeAgo value={evalRun.startedAt} className="ml-auto" />
                  </div>
                  {metrics ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3">
                      {[
                        { label: "Cases passed", value: `${metrics.cases.passed} / ${metrics.cases.total}` },
                        { label: "List F1", value: fmtPct(metrics.extraction.list_micro_f1, 1) },
                        { label: "Evidence validity", value: fmtPct(metrics.extraction.provenance_validity, 1) },
                        { label: "Review recall", value: fmtPct(metrics.review.recall, 1) },
                        { label: "Retrieval recall@5", value: fmtPct(metrics.rag.retrieval_recall_at_5, 1) },
                        { label: "Refusal accuracy", value: fmtPct(metrics.rag.refusal_accuracy, 1) },
                      ].map((m) => (
                        <div key={m.label} className="min-w-0">
                          <dt className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">{m.label}</dt>
                          <dd className="tnum mt-0.5 text-[15px] font-semibold">{m.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <PanelBody className="text-[13px] text-[var(--muted)]">{evalRun.status === "running" ? "Metrics appear when the suite finishes." : "This run recorded no aggregate metrics."}</PanelBody>
                  )}
                </>
              ) : (
                <PanelBody className="text-[13px] text-[var(--muted)]">
                  No evaluation has run in this workspace yet.{" "}
                  <Link href="/evals" className={inlineLink}>
                    Run the golden suite
                  </Link>{" "}
                  to measure extraction, retrieval and refusal quality.
                </PanelBody>
              )}
            </Panel>
          </div>

          {/* Recent activity: two focused tables, not the full lists. A workspace
              with only a run or two would leave half the row empty, so pair them
              side by side only once the runs table can hold its own column. */}
          <div className={`grid gap-5 ${runs.length >= 3 ? "xl:grid-cols-2" : ""}`}>
            <section className="min-w-0">
              <SectionTitle
                title="Recent runs"
                actions={
                  <Link href="/runs" className={`${inlineLink} text-[13px]`}>
                    All runs
                  </Link>
                }
              />
              <Table minWidth={520}>
                <THead>
                  <Th>Run</Th>
                  <Th>Status</Th>
                  <Th align="right">Documents</Th>
                  <Th align="right">Review</Th>
                  <Th align="right">Started</Th>
                </THead>
                <tbody>
                  {runs.length === 0 ? <TableEmpty colSpan={5}>No processing runs yet.</TableEmpty> : null}
                  {runs.map((r) => (
                    <Tr key={r.id}>
                      <Td>
                        <CellStack
                          primary={
                            <Link href={`/runs/${r.id}`} className={rowLink}>
                              <Mono>{shortId(r.id)}</Mono>
                            </Link>
                          }
                          secondary={r.configJson.label ? String(r.configJson.label) : r.runType}
                        />
                      </Td>
                      <Td>
                        <StatusBadge status={r.status} />
                      </Td>
                      <Td align="right" title={`${r.documentsCompleted} completed, ${r.documentsFailed} failed, ${r.documentsTotal} total`}>
                        {r.documentsCompleted}
                        <span className="text-[var(--faint)]">/{r.documentsTotal}</span>
                        {r.documentsFailed > 0 ? <span className="ml-1 text-[var(--bad)]">{r.documentsFailed} failed</span> : null}
                      </Td>
                      <Td align="right">{r.reviewItemsCreated || <span className="text-[var(--faint)]">0</span>}</Td>
                      <Td align="right">
                        <TimeAgo value={r.startedAt ?? r.createdAt} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </section>

            <section className="min-w-0">
              <SectionTitle
                title="Recent documents"
                actions={
                  <Link href="/documents" className={`${inlineLink} text-[13px]`}>
                    All documents
                  </Link>
                }
              />
              <Table minWidth={520}>
                <THead>
                  <Th>Document</Th>
                  <Th align="right">Version</Th>
                  <Th>Status</Th>
                  <Th align="right">Review</Th>
                  <Th align="right">Processed</Th>
                </THead>
                <tbody>
                  {docs.length === 0 ? <TableEmpty colSpan={5}>No documents yet.</TableEmpty> : null}
                  {docs.map((d) => (
                    <Tr key={d.id}>
                      <Td className="max-w-[280px]">
                        <CellStack
                          primary={
                            <Link href={`/documents/${d.id}`} className={rowLink} title={d.displayName}>
                              {d.displayName}
                            </Link>
                          }
                          secondary={<Mono className="text-[var(--muted)]">{d.logicalKey}</Mono>}
                        />
                      </Td>
                      <Td align="right">{d.versionNumber !== null ? `v${d.versionNumber}` : "—"}</Td>
                      <Td>
                        <StatusBadge status={d.processingStatus} />
                      </Td>
                      <Td align="right">
                        {d.openReviewCount > 0 ? <span className="font-semibold text-[var(--warn)]">{d.openReviewCount}</span> : <span className="text-[var(--faint)]">0</span>}
                      </Td>
                      <Td align="right">
                        <TimeAgo value={d.updatedAt} />
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </section>
          </div>
        </>
      )}
    </>
  );
}
