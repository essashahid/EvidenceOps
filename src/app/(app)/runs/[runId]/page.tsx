import { jobsConfigured } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleDashed, CircleSlash, Loader2, XCircle } from "lucide-react";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { getRun, listDeadLetters, listRunDocuments, listRunEvents, listRunSteps, percentile } from "@/lib/queries/runs";
import { latestCompletedEvalRun, listQaReportsForRun } from "@/lib/queries/evals";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelBody, SectionTitle, Notice } from "@/components/ui/panel";
import { MetricStrip } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FormButton } from "@/components/FormButton";
import { Button } from "@/components/ui/button";
import { Field, FilterBar, Select } from "@/components/ui/field";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty, rowLink } from "@/components/ui/table";
import { TimeStamp } from "@/components/ui/time";
import { EmptyLine } from "@/components/ui/empty";
import { MetaRow } from "@/components/ui/kv";
import { fmtCompact, fmtDate, fmtDuration, fmtNumber, fmtUsd, plural, shortId } from "@/components/format";
import { RetryButton } from "./RetryButton";
import { generateRunReportAction } from "./actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STEP_ICON = {
  succeeded: CheckCircle2,
  running: Loader2,
  pending: CircleDashed,
  failed: XCircle,
  dead_letter: XCircle,
  skipped: CircleSlash,
} as const;

const STEP_STYLE: Record<string, string> = {
  succeeded: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
  running: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
  pending: "border-[var(--line-strong)] bg-[var(--surface-sunken)] text-[var(--muted)]",
  failed: "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]",
  dead_letter: "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]",
  skipped: "border-[var(--line-strong)] bg-[var(--surface-sunken)] text-[var(--faint)]",
};

export default async function RunPage({ params, searchParams }: { params: Promise<{ runId: string }>; searchParams: Promise<{ level?: string; document?: string; step?: string }> }) {
  const filters = await searchParams;
  const { runId } = await params;
  const { workspace } = await requireWorkspace();
  const run = await getRun(workspace.workspaceId, runId);
  if (!run) notFound();
  const versionIds = run.configJson.documentVersionIds ?? [];
  const [docs, steps, deadLetters, events, reports, latestEval] = await Promise.all([
    listRunDocuments(workspace.workspaceId, versionIds),
    listRunSteps(run.id),
    listDeadLetters(run.id),
    listRunEvents(run.id, 200, filters),
    listQaReportsForRun(run.id),
    latestCompletedEvalRun(workspace.workspaceId),
  ]);
  const docById = new Map(docs.map((d) => [d.version.id, d]));
  const latencies = steps.map((s) => s.latencyMs).filter((v): v is number => v !== null);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const active = run.status === "queued" || run.status === "running";
  const duration = run.startedAt ? (run.completedAt ?? new Date()).getTime() - run.startedAt.getTime() : null;
  const admin = isAdmin(workspace.role) && jobsConfigured();
  const openDeadLetters = deadLetters.filter((d) => d.status !== "resolved").length;
  const processedNothing = versionIds.length === 0;
  const filtered = Boolean(filters.level || filters.document || filters.step);

  // Steps grouped per document, in pipeline order, for the timeline.
  const stepsByVersion = new Map<string, typeof steps>();
  for (const s of steps) {
    const key = s.documentVersionId ?? "run";
    stepsByVersion.set(key, [...(stepsByVersion.get(key) ?? []), s]);
  }

  const docLabel = (versionId: string | null) => {
    if (!versionId) return <span className="text-[var(--muted)]">run</span>;
    const d = docById.get(versionId);
    if (!d) return <Mono title={versionId}>{shortId(versionId)}</Mono>;
    return (
      <Link href={`/documents/${d.document.id}/versions/${d.version.id}`} className="text-[var(--accent)] transition-colors hover:underline">
        {d.document.logicalKey} v{d.version.versionNumber}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Run activity", href: "/runs" }, { label: shortId(run.id) }]}
        title={
          <>
            <span className="capitalize">{run.runType} run</span>
            <Mono className="text-[18px] text-[var(--muted)]" title={run.id}>
              {shortId(run.id)}
            </Mono>
            <StatusBadge status={run.status} />
          </>
        }
        meta={
          <MetaRow
            items={[
              ...(run.configJson.label ? [{ label: "Label", value: String(run.configJson.label) }] : []),
              { label: "Provider", value: <Mono>{run.provider}</Mono> },
              { label: "Pipeline", value: <Mono>{run.pipelineVersion}</Mono> },
              { label: "Model config", value: <Mono title={run.modelConfigHash}>{shortId(run.modelConfigHash)}</Mono> },
              ...(run.currentStep ? [{ label: "Current step", value: <Mono>{run.currentStep}</Mono> }] : []),
              { label: "Started", value: run.startedAt ? fmtDate(run.startedAt, true) : "not yet" },
              { label: "Completed", value: run.completedAt ? fmtDate(run.completedAt, true) : "not yet" },
            ]}
          />
        }
        actions={
          <>
            <AutoRefresh active={active} />
            <Button asChild variant="ghost" size="sm">
              <Link href="/runs">All runs</Link>
            </Button>
          </>
        }
      />

      {run.errorMessage ? (
        <Notice tone="bad" title="Run error" className="mb-4">
          {run.errorMessage}
        </Notice>
      ) : null}

      <Panel className="mb-5">
        <MetricStrip
          items={[
            { label: "Documents", value: processedNothing ? "—" : `${run.documentsCompleted}/${run.documentsTotal}`, tone: run.documentsFailed > 0 ? "bad" : "default", title: `${run.documentsCompleted} completed, ${run.documentsFailed} failed, ${run.documentsTotal} total` },
            { label: "Review items", value: fmtNumber(run.reviewItemsCreated), tone: run.reviewItemsCreated > 0 ? "warn" : "default" },
            { label: "Retries", value: fmtNumber(run.retries), tone: run.retries > 0 ? "warn" : "default" },
            { label: "Dead letters", value: fmtNumber(openDeadLetters), tone: openDeadLetters > 0 ? "bad" : "ok" },
            { label: "Duration", value: fmtDuration(duration) || "—", title: active ? "In progress" : undefined },
            { label: "Est. cost", value: fmtUsd(run.estimatedCostUsd), title: `${fmtNumber(run.inputTokens)} in / ${fmtNumber(run.outputTokens)} out / ${fmtNumber(run.embeddingTokens)} embedding tokens` },
          ]}
        />
      </Panel>

      {processedNothing ? (
        /* Duplicate uploads and no-op runs get a one-line explanation instead of five empty tables. */
        <Notice tone="info" title="This run processed no documents." className="mb-5">
          Every uploaded file already existed in this workspace with the same content hash, so nothing was parsed or sent to a model. The events below record what was skipped.
        </Notice>
      ) : (
        <>
          {/* ------------------------------ Timeline ------------------------------ */}
          <SectionTitle title="Pipeline" count={steps.length} description="Durable steps per document. Reused steps are not re-executed on a retry or reprocess." />
          <Panel className="mb-6">
            <div className="divide-y divide-[var(--line)]">
              {stepsByVersion.size === 0 ? (
                <PanelBody className="text-[13px] text-[var(--muted)]">No steps have been recorded yet.</PanelBody>
              ) : (
                [...stepsByVersion.entries()].map(([versionId, list]) => {
                  const d = versionId === "run" ? null : docById.get(versionId);
                  return (
                    <div key={versionId} className="flex flex-col gap-2 px-4 py-3 lg:flex-row lg:items-center lg:gap-4">
                      <div className="min-w-0 lg:w-[240px] lg:shrink-0">
                        {d ? (
                          <>
                            <Link href={`/documents/${d.document.id}/versions/${d.version.id}`} className="block truncate text-[13px] font-medium text-[var(--fg)] transition-colors hover:text-[var(--accent)]" title={d.document.displayName}>
                              {d.document.displayName}
                            </Link>
                            <span className="text-[12px] text-[var(--muted)]">
                              <Mono>{d.document.logicalKey}</Mono> v{d.version.versionNumber}
                            </span>
                          </>
                        ) : (
                          <span className="text-[13px] text-[var(--muted)]">Run-level steps</span>
                        )}
                      </div>
                      <ol className="scroll-thin flex min-w-0 flex-1 flex-wrap gap-1.5">
                        {list.map((s) => {
                          const Icon = STEP_ICON[s.status as keyof typeof STEP_ICON] ?? CircleDashed;
                          return (
                            <li key={s.id}>
                              <span
                                title={`${s.stepName}: ${s.status}${s.attemptCount > 1 ? `, ${s.attemptCount} attempts` : ""}${s.latencyMs !== null ? `, ${fmtDuration(s.latencyMs)}` : ""}${s.errorMessage ? `\n${s.errorMessage}` : ""}`}
                                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium", STEP_STYLE[s.status] ?? STEP_STYLE.pending)}
                              >
                                <Icon size={12} aria-hidden className={s.status === "running" ? "animate-spin" : undefined} />
                                {s.stepName}
                                {s.attemptCount > 1 ? <span className="tnum opacity-70">×{s.attemptCount}</span> : null}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  );
                })
              )}
            </div>
          </Panel>

          {/* ------------------------------ Documents ------------------------------ */}
          <SectionTitle title="Documents" count={versionIds.length} />
          <Table minWidth={860} className="mb-6">
            <THead>
              <Th>Document</Th>
              <Th align="right" width={80}>
                Version
              </Th>
              <Th>Filename</Th>
              <Th width={110}>Parse</Th>
              <Th width={150}>Processing</Th>
              <Th align="right" width={70}>
                Pages
              </Th>
            </THead>
            <tbody>
              {versionIds.map((id) => {
                const d = docById.get(id);
                if (!d)
                  return (
                    <Tr key={id}>
                      <Td colSpan={6} className="text-[var(--muted)]">
                        <Mono>{id}</Mono> is not in this workspace.
                      </Td>
                    </Tr>
                  );
                return (
                  <Tr key={id}>
                    <Td className="max-w-[300px]">
                      <Link href={`/documents/${d.document.id}/versions/${d.version.id}`} className={rowLink} title={d.document.displayName}>
                        {d.document.displayName}
                      </Link>
                      <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                        <Mono>{d.document.logicalKey}</Mono>
                      </div>
                    </Td>
                    <Td align="right">v{d.version.versionNumber}</Td>
                    <Td className="max-w-[300px] truncate text-[var(--muted)]" title={d.version.sourceFilename}>
                      {d.version.sourceFilename}
                    </Td>
                    <Td>
                      <StatusBadge status={d.version.parseStatus} size="sm" />
                    </Td>
                    <Td>
                      <StatusBadge status={d.version.processingStatus} size="sm" />
                    </Td>
                    <Td align="right">{d.version.pageCount ?? <span className="text-[var(--faint)]">—</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>

          {/* -------------------------------- Steps -------------------------------- */}
          <SectionTitle
            title="Step detail"
            count={steps.length}
            actions={
              latencies.length > 0 ? (
                <span className="text-[12.5px] text-[var(--muted)]">
                  p50 {fmtDuration(p50)} · p95 {fmtDuration(p95)} across {plural(latencies.length, "step")}
                </span>
              ) : null
            }
          />
          {steps.length === 0 ? (
            <EmptyLine>No steps recorded for this run.</EmptyLine>
          ) : (
            <Table minWidth={1000} className="mb-6">
              <THead>
                <Th width={150}>Document</Th>
                <Th width={180}>Step</Th>
                <Th width={130}>Status</Th>
                <Th align="right" width={90}>
                  Attempts
                </Th>
                <Th align="right" width={100}>
                  Latency
                </Th>
                <Th>Error</Th>
                <Th align="right" width={160}>
                  Started
                </Th>
              </THead>
              <tbody>
                {steps.map((s) => (
                  <Tr key={s.id}>
                    <Td>{docLabel(s.documentVersionId)}</Td>
                    <Td>
                      <Mono className="font-medium text-[var(--fg)]">{s.stepName}</Mono>
                    </Td>
                    <Td>
                      <StatusBadge status={s.status} size="sm" />
                    </Td>
                    <Td align="right" className={s.attemptCount > 1 ? "font-semibold text-[var(--warn)]" : ""}>
                      {s.attemptCount}
                    </Td>
                    <Td align="right">{fmtDuration(s.latencyMs) || <span className="text-[var(--faint)]">—</span>}</Td>
                    <Td className="max-w-[380px] text-[12.5px] text-[var(--bad)]">
                      {s.errorCode ? <Mono className="font-semibold">{s.errorCode}</Mono> : null}
                      {s.errorMessage ? <span className="ml-1.5">{s.errorMessage}</span> : null}
                      {!s.errorCode && !s.errorMessage ? <span className="text-[var(--faint)]">—</span> : null}
                    </Td>
                    <Td align="right">
                      <TimeStamp value={s.startedAt} withSeconds />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </>
      )}

      {/* ----------------------------- Dead letters ----------------------------- */}
      <SectionTitle title="Dead letters" count={deadLetters.length} description="Steps that exhausted their retries. Nothing is silently dropped." actions={!admin && deadLetters.length > 0 ? <span className="text-[12.5px] text-[var(--muted)]">Retrying requires the admin role</span> : null} />
      {deadLetters.length === 0 ? (
        <EmptyLine>No step in this run exhausted its retries.</EmptyLine>
      ) : (
        <Table minWidth={1000}>
          <THead>
            <Th width={150}>Document</Th>
            <Th width={160}>Step</Th>
            <Th width={170}>Error</Th>
            <Th>Message</Th>
            <Th align="right" width={90}>
              Attempts
            </Th>
            <Th width={120}>Status</Th>
            <Th width={150}>Action</Th>
          </THead>
          <tbody>
            {deadLetters.map((d) => (
              <Tr key={d.id}>
                <Td>{docLabel(d.documentVersionId)}</Td>
                <Td>
                  <Mono className="font-medium">{d.failedStep}</Mono>
                </Td>
                <Td>
                  <Mono className="text-[var(--bad)]">{d.errorCode}</Mono>
                  {!d.retryable ? <div className="mt-0.5 text-[11.5px] text-[var(--muted)]">not retryable</div> : null}
                </Td>
                <Td className="max-w-[380px] text-[12.5px]">{d.errorMessage}</Td>
                <Td align="right">{d.attemptCount}</Td>
                <Td>
                  <StatusBadge status={d.status === "open" ? "failed" : d.status === "resolved" ? "resolved" : "retrying"} size="sm" title={d.status} />
                </Td>
                <Td>
                  {d.status === "resolved" ? (
                    <span className="text-[12px] text-[var(--muted)]">resolved {fmtDate(d.resolvedAt)}</span>
                  ) : (
                    <RetryButton runId={run.id} documentVersionId={d.documentVersionId} failedStep={d.failedStep} canRetry={admin} retryable={d.retryable} />
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* ------------------------------ QA reports ------------------------------ */}
      <SectionTitle
        id="qa-report-slot"
        title="QA reports"
        count={reports.length}
        className="mt-6"
        description="A self-contained HTML report covering corpus, quality, provenance, review, retries, cost and regression."
        actions={
          admin ? (
            <form action={generateRunReportAction} className="flex items-center gap-2">
              <input type="hidden" name="runId" value={run.id} />
              <span className="text-[12.5px] text-[var(--muted)]">
                {latestEval ? (
                  <>
                    attaches eval{" "}
                    <Link href={`/evals/${latestEval.id}`} className="text-[var(--accent)] hover:underline">
                      <Mono>{shortId(latestEval.id)}</Mono>
                    </Link>
                  </>
                ) : (
                  "no completed evaluation to attach"
                )}
              </span>
              <FormButton size="sm" variant="secondary" pendingText="Generating…">
                Generate report
              </FormButton>
            </form>
          ) : (
            <span className="text-[12.5px] text-[var(--muted)]">Generating reports requires the admin role</span>
          )
        }
      />
      {reports.length === 0 ? (
        <EmptyLine>No QA report has been generated for this run yet.</EmptyLine>
      ) : (
        <Table minWidth={800}>
          <THead>
            <Th width={120}>Report</Th>
            <Th width={140}>Status</Th>
            <Th width={140}>Eval run</Th>
            <Th align="right" width={170}>
              Created
            </Th>
            <Th width={170}>Links</Th>
          </THead>
          <tbody>
            {reports.map((r) => (
              <Tr key={r.id}>
                <Td>
                  <Mono title={r.id}>{shortId(r.id)}</Mono>
                </Td>
                <Td>
                  <StatusBadge status={r.status} size="sm" />
                  {r.status === "failed" && r.errorMessage ? <div className="mt-0.5 max-w-[320px] text-[12px] text-[var(--bad)]">{r.errorMessage}</div> : null}
                </Td>
                <Td>
                  {r.evalRunId ? (
                    <Link href={`/evals/${r.evalRunId}`} className="text-[var(--accent)] hover:underline">
                      <Mono title={r.evalRunId}>{shortId(r.evalRunId)}</Mono>
                    </Link>
                  ) : (
                    <span className="text-[var(--faint)]">none</span>
                  )}
                </Td>
                <Td align="right">
                  <TimeStamp value={r.createdAt} withSeconds />
                </Td>
                <Td>
                  {r.status === "generated" ? (
                    <span className="flex items-center gap-2">
                      <Button asChild variant="secondary" size="xs">
                        <Link href={`/reports/${r.id}`}>View</Link>
                      </Button>
                      <Button asChild variant="ghost" size="xs">
                        <a href={`/reports/${r.id}?download=1`}>Download</a>
                      </Button>
                    </span>
                  ) : (
                    <span className="text-[var(--faint)]">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* -------------------------------- Events -------------------------------- */}
      <SectionTitle title="Events" count={events.length} className="mt-6" description="Newest 200 events for this run." />
      <form method="get">
        <FilterBar
          actions={
            <>
              <Button type="submit" size="sm">
                Filter
              </Button>
              {filtered ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/runs/${run.id}`}>Reset</Link>
                </Button>
              ) : null}
            </>
          }
        >
          <Field label="Level" className="w-[140px]">
            <Select name="level" defaultValue={filters.level ?? ""}>
              <option value="">All levels</option>
              {["debug", "info", "warn", "error"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Document" className="w-full sm:w-[260px]">
            <Select name="document" defaultValue={filters.document ?? ""}>
              <option value="">All documents</option>
              {docs.map((d) => (
                <option key={d.version.id} value={d.version.id}>
                  {d.document.logicalKey} v{d.version.versionNumber}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Step" className="w-[190px]">
            <Select name="step" defaultValue={filters.step ?? ""}>
              <option value="">All steps</option>
              {[...new Set(steps.map((s) => s.stepName))].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      </form>
      <Table minWidth={920}>
        <THead sticky>
          <Th align="right" width={160}>
            Time
          </Th>
          <Th width={110}>Level</Th>
          <Th width={180}>Type</Th>
          <Th width={150}>Document</Th>
          <Th>Message</Th>
        </THead>
        <tbody>
          {events.length === 0 ? <TableEmpty colSpan={5}>{filtered ? "No events match these filters." : "No events recorded."}</TableEmpty> : null}
          {events.map((e) => (
            <Tr key={e.id}>
              <Td align="right">
                <TimeStamp value={e.createdAt} withSeconds />
              </Td>
              <Td>
                <StatusBadge status={e.level} size="sm" />
              </Td>
              <Td>
                <Mono className="text-[var(--muted)]">{e.eventType}</Mono>
              </Td>
              <Td>{docLabel(e.documentVersionId)}</Td>
              <Td className="max-w-[560px] break-words text-[12.5px]">{e.message}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      <p className="mt-2 text-[12px] text-[var(--muted)]">Token usage: {fmtCompact(run.inputTokens)} in, {fmtCompact(run.outputTokens)} out, {fmtCompact(run.embeddingTokens)} embedding.</p>
    </>
  );
}
