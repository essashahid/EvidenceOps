import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { listRuns } from "@/lib/queries/runs";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtDuration, fmtNumber, fmtUsd, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
  const { workspace } = await requireWorkspace();
  const runs = await listRuns(workspace.workspaceId);
  return (
    <>
      <PageHeader title="Processing runs" subtitle={`${runs.length} run(s), newest first`} />
      <Table>
        <THead>
          <Th>Run</Th>
          <Th>Type</Th>
          <Th>Provider</Th>
          <Th>Status</Th>
          <Th>Step</Th>
          <Th align="right">Docs done / failed / total</Th>
          <Th align="right">Review</Th>
          <Th align="right">Retries</Th>
          <Th align="right">Tokens in / out / emb</Th>
          <Th align="right">Cost</Th>
          <Th>Started</Th>
          <Th>Completed</Th>
          <Th align="right">Duration</Th>
        </THead>
        <tbody>
          {runs.length === 0 ? <TableEmpty colSpan={13}>No runs yet.</TableEmpty> : null}
          {runs.map((r) => {
            const duration = r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null;
            return (
              <Tr key={r.id}>
                <Td>
                  <Link href={`/runs/${r.id}`} className="text-[var(--accent)] underline">
                    <Mono title={r.id}>{shortId(r.id)}</Mono>
                  </Link>
                  {r.configJson.label ? <div className="max-w-[240px] truncate text-xs text-[var(--muted)]">{String(r.configJson.label)}</div> : null}
                </Td>
                <Td>{r.runType}</Td>
                <Td>{r.provider}</Td>
                <Td>
                  <StatusBadge status={r.status} />
                </Td>
                <Td>
                  <Mono>{r.currentStep ?? ""}</Mono>
                </Td>
                <Td align="right">
                  {r.documentsCompleted} / {r.documentsFailed > 0 ? <span className="text-[var(--bad)]">{r.documentsFailed}</span> : 0} / {r.documentsTotal}
                </Td>
                <Td align="right">{r.reviewItemsCreated}</Td>
                <Td align="right">{r.retries}</Td>
                <Td align="right">
                  {fmtNumber(r.inputTokens)} / {fmtNumber(r.outputTokens)} / {fmtNumber(r.embeddingTokens)}
                </Td>
                <Td align="right">{fmtUsd(r.estimatedCostUsd)}</Td>
                <Td>
                  <Mono>{fmtDate(r.startedAt)}</Mono>
                </Td>
                <Td>
                  <Mono>{fmtDate(r.completedAt)}</Mono>
                </Td>
                <Td align="right">{fmtDuration(duration)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
