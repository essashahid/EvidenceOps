import Link from "next/link";
import { notFound } from "next/navigation";
import { isAdmin, requireWorkspace } from "@/lib/workspace";
import { getRun, listDeadLetters, listRunDocuments, listRunEvents, listRunSteps, percentile } from "@/lib/queries/runs";
import { latestCompletedEvalRun, listQaReportsForRun } from "@/lib/queries/evals";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { AutoRefresh } from "@/components/AutoRefresh";
import { FormButton } from "@/components/FormButton";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtDuration, fmtNumber, fmtUsd, shortId } from "@/components/format";
import { RetryButton } from "./RetryButton";
import { generateRunReportAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const { workspace } = await requireWorkspace();
  const run = await getRun(workspace.workspaceId, runId);
  if (!run) notFound();
  const versionIds = run.configJson.documentVersionIds ?? [];
  const [docs, steps, deadLetters, events, reports, latestEval] = await Promise.all([
    listRunDocuments(workspace.workspaceId, versionIds),
    listRunSteps(run.id),
    listDeadLetters(run.id),
    listRunEvents(run.id, 200),
    listQaReportsForRun(run.id),
    latestCompletedEvalRun(workspace.workspaceId),
  ]);
  const docById = new Map(docs.map((d) => [d.version.id, d]));
  const latencies = steps.map((s) => s.latencyMs).filter((v): v is number => v !== null);
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const active = run.status === "queued" || run.status === "running";
  const duration = run.startedAt ? (run.completedAt ?? new Date()).getTime() - run.startedAt.getTime() : null;
  const admin = isAdmin(workspace.role);

  const docLabel = (versionId: string | null) => {
    if (!versionId) return <span className="text-[var(--muted)]">run</span>;
    const d = docById.get(versionId);
    if (!d) return <Mono title={versionId}>{shortId(versionId)}</Mono>;
    return (
      <Link href={`/documents/${d.document.id}/versions/${d.version.id}`} className="text-[var(--accent)] underline">
        {d.document.logicalKey} v{d.version.versionNumber}
      </Link>
    );
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            Run <Mono title={run.id}>{shortId(run.id)}</Mono> <StatusBadge status={run.status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{run.runType}</span>
            {run.configJson.label ? <span>{String(run.configJson.label)}</span> : null}
            <span>
              provider <Mono>{run.provider}</Mono>
            </span>
            <span>
              pipeline <Mono>{run.pipelineVersion}</Mono>
            </span>
            <span>
              model config <Mono title={run.modelConfigHash}>{shortId(run.modelConfigHash)}</Mono>
            </span>
            {run.currentStep ? (
              <span>
                step <Mono>{run.currentStep}</Mono>
              </span>
            ) : null}
            <span>started {fmtDate(run.startedAt, true) || "not yet"}</span>
            <span>completed {fmtDate(run.completedAt, true) || "not yet"}</span>
          </span>
        }
        actions={
          <>
            <AutoRefresh active={active} />
            <Link href="/runs" className="text-sm text-[var(--accent)] underline">
              All runs
            </Link>
          </>
        }
      />
      {run.errorMessage ? <div className="mb-3 rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">{run.errorMessage}</div> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Documents" value={`${run.documentsCompleted} / ${run.documentsTotal}`} hint={run.documentsFailed > 0 ? <span className="text-[var(--bad)]">{run.documentsFailed} failed</span> : "completed / total"} />
        <StatCard label="Review items" value={fmtNumber(run.reviewItemsCreated)} tone={run.reviewItemsCreated > 0 ? "warn" : undefined} />
        <StatCard label="Retries" value={fmtNumber(run.retries)} hint={`${deadLetters.filter((d) => d.status !== "resolved").length} open dead letter(s)`} tone={deadLetters.some((d) => d.status !== "resolved") ? "bad" : undefined} />
        <StatCard label="Step latency p50" value={fmtDuration(p50) || "n/a"} hint={`${latencies.length} step(s)`} />
        <StatCard label="Step latency p95" value={fmtDuration(p95) || "n/a"} />
        <StatCard label="Duration" value={fmtDuration(duration) || "n/a"} hint={active ? "in progress" : undefined} />
        <StatCard label="Tokens" value={`${fmtNumber(run.inputTokens)} / ${fmtNumber(run.outputTokens)}`} hint={`${fmtNumber(run.embeddingTokens)} embedding`} />
        <StatCard label="Est. cost" value={fmtUsd(run.estimatedCostUsd)} />
      </div>

      <SectionHeader title="Documents" count={versionIds.length} />
      <Table>
        <THead>
          <Th>Document</Th>
          <Th align="right">Version</Th>
          <Th>Filename</Th>
          <Th>Parse</Th>
          <Th>Processing</Th>
          <Th align="right">Pages</Th>
        </THead>
        <tbody>
          {versionIds.length === 0 ? <TableEmpty colSpan={6}>This run has no document versions attached.</TableEmpty> : null}
          {versionIds.map((id) => {
            const d = docById.get(id);
            if (!d)
              return (
                <Tr key={id}>
                  <Td colSpan={6}>
                    <Mono>{id}</Mono> <span className="text-[var(--muted)]">not found in this workspace</span>
                  </Td>
                </Tr>
              );
            return (
              <Tr key={id}>
                <Td>
                  <Link href={`/documents/${d.document.id}/versions/${d.version.id}`} className="text-[var(--accent)] underline">
                    {d.document.displayName}
                  </Link>
                  <div className="text-xs text-[var(--muted)]">
                    <Mono>{d.document.logicalKey}</Mono>
                  </div>
                </Td>
                <Td align="right">v{d.version.versionNumber}</Td>
                <Td className="max-w-[320px] truncate" title={d.version.sourceFilename}>
                  {d.version.sourceFilename}
                </Td>
                <Td>
                  <StatusBadge status={d.version.parseStatus} />
                </Td>
                <Td>
                  <StatusBadge status={d.version.processingStatus} />
                </Td>
                <Td align="right">{d.version.pageCount ?? ""}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <SectionHeader title="Steps" count={steps.length} />
      <Table>
        <THead>
          <Th>Document</Th>
          <Th>Step</Th>
          <Th>Status</Th>
          <Th align="right">Attempts</Th>
          <Th align="right">Latency</Th>
          <Th>Error</Th>
          <Th>Started</Th>
          <Th>Completed</Th>
        </THead>
        <tbody>
          {steps.length === 0 ? <TableEmpty colSpan={8}>No steps recorded.</TableEmpty> : null}
          {steps.map((s) => (
            <Tr key={s.id}>
              <Td>{docLabel(s.documentVersionId)}</Td>
              <Td>
                <Mono>{s.stepName}</Mono>
              </Td>
              <Td>
                <StatusBadge status={s.status} />
              </Td>
              <Td align="right">{s.attemptCount}</Td>
              <Td align="right">{fmtDuration(s.latencyMs)}</Td>
              <Td className="max-w-[420px] text-xs text-[var(--bad)]">
                {s.errorCode ? <Mono>{s.errorCode}</Mono> : null}
                {s.errorMessage ? <span className="ml-1">{s.errorMessage}</span> : null}
              </Td>
              <Td>
                <Mono>{fmtDate(s.startedAt, true)}</Mono>
              </Td>
              <Td>
                <Mono>{fmtDate(s.completedAt, true)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <SectionHeader title="Dead letters" count={deadLetters.length} actions={!admin ? <span className="text-xs text-[var(--muted)]">Retrying requires the admin role</span> : null} />
      <Table>
        <THead>
          <Th>Document</Th>
          <Th>Step</Th>
          <Th>Error code</Th>
          <Th>Message</Th>
          <Th align="right">Attempts</Th>
          <Th>Retryable</Th>
          <Th>Status</Th>
          <Th>Created</Th>
          <Th>Action</Th>
        </THead>
        <tbody>
          {deadLetters.length === 0 ? <TableEmpty colSpan={9}>No dead letters.</TableEmpty> : null}
          {deadLetters.map((d) => (
            <Tr key={d.id}>
              <Td>{docLabel(d.documentVersionId)}</Td>
              <Td>
                <Mono>{d.failedStep}</Mono>
              </Td>
              <Td>
                <Mono>{d.errorCode}</Mono>
              </Td>
              <Td className="max-w-[420px] text-xs">{d.errorMessage}</Td>
              <Td align="right">{d.attemptCount}</Td>
              <Td>{d.retryable ? "yes" : "no"}</Td>
              <Td>
                <StatusBadge status={d.status} />
              </Td>
              <Td>
                <Mono>{fmtDate(d.createdAt, true)}</Mono>
              </Td>
              <Td>{d.status === "resolved" ? <span className="text-xs text-[var(--muted)]">resolved {fmtDate(d.resolvedAt)}</span> : <RetryButton runId={run.id} documentVersionId={d.documentVersionId} failedStep={d.failedStep} canRetry={admin} retryable={d.retryable} />}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <SectionHeader
        title="QA reports"
        count={reports.length}
        actions={
          admin ? (
            <form action={generateRunReportAction} className="flex items-center gap-2">
              <input type="hidden" name="runId" value={run.id} />
              <span className="text-xs text-[var(--muted)]">
                {latestEval ? (
                  <>
                    attaches eval{" "}
                    <Link href={`/evals/${latestEval.id}`} className="underline">
                      <Mono>{shortId(latestEval.id)}</Mono>
                    </Link>
                  </>
                ) : (
                  "no completed evaluation to attach"
                )}
              </span>
              <FormButton size="sm" variant="secondary" pendingText="Generating...">
                Generate QA report
              </FormButton>
            </form>
          ) : (
            <span className="text-xs text-[var(--muted)]">Generating reports requires the admin role</span>
          )
        }
      />
      <Table>
        <THead>
          <Th>Report</Th>
          <Th>Status</Th>
          <Th>Eval run</Th>
          <Th>Created</Th>
          <Th>Completed</Th>
          <Th>Links</Th>
        </THead>
        <tbody>
          {reports.length === 0 ? <TableEmpty colSpan={6}>No QA reports generated for this run.</TableEmpty> : null}
          {reports.map((r) => (
            <Tr key={r.id}>
              <Td>
                <Mono title={r.id}>{shortId(r.id)}</Mono>
              </Td>
              <Td>
                <StatusBadge status={r.status} />
                {r.status === "failed" && r.errorMessage ? <div className="mt-0.5 max-w-[420px] text-xs text-[var(--bad)]">{r.errorMessage}</div> : null}
              </Td>
              <Td>
                {r.evalRunId ? (
                  <Link href={`/evals/${r.evalRunId}`} className="text-[var(--accent)] underline">
                    <Mono title={r.evalRunId}>{shortId(r.evalRunId)}</Mono>
                  </Link>
                ) : (
                  <span className="text-xs text-[var(--muted)]">none</span>
                )}
              </Td>
              <Td>
                <Mono>{fmtDate(r.createdAt, true)}</Mono>
              </Td>
              <Td>
                <Mono>{fmtDate(r.completedAt, true)}</Mono>
              </Td>
              <Td>
                {r.status === "generated" ? (
                  <span className="flex items-center gap-2 text-xs">
                    <Link href={`/reports/${r.id}`} className="text-[var(--accent)] underline">
                      view
                    </Link>
                    <a href={`/reports/${r.id}?download=1`} className="text-[var(--accent)] underline">
                      download
                    </a>
                  </span>
                ) : (
                  ""
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <SectionHeader title="Events" count={events.length} actions={<span className="text-xs text-[var(--muted)]">newest 200</span>} />
      <Table>
        <THead>
          <Th>Time</Th>
          <Th>Level</Th>
          <Th>Type</Th>
          <Th>Document</Th>
          <Th>Message</Th>
        </THead>
        <tbody>
          {events.length === 0 ? <TableEmpty colSpan={5}>No events.</TableEmpty> : null}
          {events.map((e) => (
            <Tr key={e.id}>
              <Td>
                <Mono>{fmtDate(e.createdAt, true)}</Mono>
              </Td>
              <Td>
                <StatusBadge status={e.level} />
              </Td>
              <Td>
                <Mono>{e.eventType}</Mono>
              </Td>
              <Td>{docLabel(e.documentVersionId)}</Td>
              <Td className="max-w-[640px] break-words text-xs">{e.message}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
