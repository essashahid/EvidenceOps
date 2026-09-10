import Link from "next/link";
import { Activity } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { listRuns } from "@/lib/queries/runs";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Table, THead, Th, Tr, Td, Mono, CellStack, rowLink } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Button } from "@/components/ui/button";
import { fmtCompact, fmtDuration, fmtUsd, plural, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

type Search = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function RunsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const runs = await listRuns(workspace.workspaceId);
  // Duplicate uploads create runs that process nothing; they are noise in the default view.
  const showAll = one(sp.show) === "all";
  const processing = runs.filter((r) => r.documentsTotal > 0);
  const skipped = runs.length - processing.length;
  const visible = showAll ? runs : processing;

  const failed = runs.filter((r) => r.status === "failed").length;
  const active = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  const totalCost = runs.reduce((n, r) => n + Number(r.estimatedCostUsd), 0);
  const totalDocs = runs.reduce((n, r) => n + r.documentsCompleted, 0);

  return (
    <>
      <PageHeader
        title="Run activity"
        subtitle="Every processing run with its steps, retries, token usage and cost. Runs always reach a terminal state."
        actions={
          skipped > 0 ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={showAll ? "/runs" : "/runs?show=all"}>{showAll ? "Hide duplicate uploads" : `Show ${skipped} duplicate uploads`}</Link>
            </Button>
          ) : null
        }
      />

      <MetricGroup className="mb-4">
        <Metric label="Runs" value={runs.length} hint={skipped > 0 ? `${skipped} were duplicate uploads` : "All runs recorded"} />
        <Metric label="In progress" value={active} tone={active > 0 ? "accent" : "default"} hint={active > 0 ? "Queued or running now" : "Nothing running"} />
        <Metric label="Failed" value={failed} tone={failed > 0 ? "bad" : "ok"} hint={failed > 0 ? "Inspect the dead letters" : "No failed runs"} />
        <Metric label="Documents processed" value={fmtCompact(totalDocs)} hint={`${fmtUsd(totalCost)} estimated spend`} />
      </MetricGroup>

      {visible.length === 0 ? (
        <EmptyState icon={<Activity size={18} aria-hidden />} title="No processing runs yet">
          Runs appear here as soon as a document is uploaded or reprocessed.
        </EmptyState>
      ) : (
        <Table minWidth={1100}>
          <THead sticky>
            <Th width={200}>Run</Th>
            <Th width={110}>Type</Th>
            <Th width={150}>Status</Th>
            <Th align="right" width={130}>Documents</Th>
            <Th align="right" width={80}>Review</Th>
            <Th align="right" width={80}>Retries</Th>
            <Th align="right" width={140}>Tokens</Th>
            <Th align="right" width={100}>Cost</Th>
            <Th align="right" width={110}>Duration</Th>
            <Th align="right" width={110}>Started</Th>
          </THead>
          <tbody>
            {visible.map((r) => {
              const duration = r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
              const idle = r.documentsTotal === 0;
              return (
                <Tr key={r.id} muted={idle}>
                  <Td>
                    <CellStack
                      primary={
                        <Link href={`/runs/${r.id}`} className={rowLink}>
                          <Mono>{shortId(r.id)}</Mono>
                        </Link>
                      }
                      secondary={r.configJson.label ? String(r.configJson.label) : undefined}
                    />
                  </Td>
                  <Td className="capitalize">{r.runType}</Td>
                  <Td>
                    <StatusBadge status={r.status} />
                    {r.currentStep ? <div className="mt-0.5 truncate font-mono text-[11.5px] text-[var(--muted)]">{r.currentStep}</div> : null}
                  </Td>
                  <Td align="right" title={`${r.documentsCompleted} completed, ${r.documentsFailed} failed, ${r.documentsTotal} total`}>
                    {idle ? (
                      <span className="text-[var(--faint)]">none</span>
                    ) : (
                      <>
                        {r.documentsCompleted}
                        <span className="text-[var(--faint)]">/{r.documentsTotal}</span>
                        {r.documentsFailed > 0 ? <span className="ml-1 font-semibold text-[var(--bad)]">{r.documentsFailed}✗</span> : null}
                      </>
                    )}
                  </Td>
                  <Td align="right">{r.reviewItemsCreated || <span className="text-[var(--faint)]">0</span>}</Td>
                  <Td align="right" className={r.retries > 0 ? "font-semibold text-[var(--warn)]" : ""}>
                    {r.retries || <span className="font-normal text-[var(--faint)]">0</span>}
                  </Td>
                  <Td align="right" title={`${r.inputTokens} in / ${r.outputTokens} out / ${r.embeddingTokens} embedding`}>
                    {r.inputTokens + r.outputTokens + r.embeddingTokens > 0 ? fmtCompact(r.inputTokens + r.outputTokens + r.embeddingTokens) : <span className="text-[var(--faint)]">0</span>}
                  </Td>
                  <Td align="right">{Number(r.estimatedCostUsd) > 0 ? fmtUsd(r.estimatedCostUsd) : <span className="text-[var(--faint)]">$0.00</span>}</Td>
                  <Td align="right">{fmtDuration(duration) || <span className="text-[var(--faint)]">—</span>}</Td>
                  <Td align="right">
                    <TimeAgo value={r.startedAt ?? r.createdAt} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {!showAll && skipped > 0 ? (
        <p className="mt-3 text-[12.5px] text-[var(--muted)]">
          {plural(skipped, "duplicate upload")} processed no documents and {skipped === 1 ? "is" : "are"} hidden.{" "}
          <Link href="/runs?show=all" className="text-[var(--accent)] hover:underline">
            Show them
          </Link>
          .
        </p>
      ) : null}
    </>
  );
}
