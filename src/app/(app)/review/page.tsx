import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { listReviewItems, reviewCounts, type ReviewFilters } from "@/lib/review/queries";
import { listReviewFieldRoots, listReviewVersions } from "@/lib/queries/review";
import { fieldLabel, LIST_FIELDS, SCALAR_FIELDS } from "@/lib/schema/report";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtValue } from "@/components/format";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "resolved", "rejected", "needs_source", "superseded", "all"] as const;
type Status = (typeof STATUSES)[number];

type Search = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function numOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const statusRaw = one(sp.status) || "open";
  const status: Status = (STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as Status) : "open";
  const field = one(sp.field);
  const versionId = one(sp.version);
  const min = one(sp.min);
  const max = one(sp.max);
  const flash = one(sp.flash);

  const filters: ReviewFilters = {
    status,
    priority: one(sp.priority) === "high" ? "high" : one(sp.priority) === "normal" ? "normal" : undefined,
    fieldPath: field ? `${field}%` : undefined,
    documentVersionId: versionId || undefined,
    minConfidence: numOrUndefined(min),
    maxConfidence: numOrUndefined(max),
  };
  const [counts, items, versions, roots] = await Promise.all([reviewCounts(workspace.workspaceId), listReviewItems(workspace.workspaceId, filters), listReviewVersions(workspace.workspaceId), listReviewFieldRoots(workspace.workspaceId)]);
  const knownRoots: string[] = [...SCALAR_FIELDS, ...LIST_FIELDS];
  const fieldOptions = [...knownRoots.filter((r) => roots.includes(r)), ...roots.filter((r) => !knownRoots.includes(r))];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Review queue" subtitle={`${counts.open ?? 0} open of ${total} item(s) routed to human review`} />
      {flash ? <div className="mb-3 rounded border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_8%,white)] px-3 py-1.5 text-sm text-[var(--ok)]">{flash}</div> : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="Open" value={counts.open ?? 0} tone={(counts.open ?? 0) > 0 ? "warn" : undefined} hint="awaiting a reviewer" />
        <StatCard label="Resolved" value={counts.resolved ?? 0} tone="ok" hint="accepted or edited" />
        <StatCard label="Rejected" value={counts.rejected ?? 0} tone={(counts.rejected ?? 0) > 0 ? "bad" : undefined} hint="value cleared" />
        <StatCard label="Needs source" value={counts.needs_source ?? 0} tone={(counts.needs_source ?? 0) > 0 ? "bad" : undefined} hint="evidence insufficient" />
      </div>

      <form method="get" className="mt-4 mb-2 flex flex-wrap items-end gap-2 rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Status
          <select name="status" defaultValue={status} className="rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]">
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Field
          <select name="field" defaultValue={field} className="rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]">
            <option value="">all fields</option>
            {fieldOptions.map((r) => (
              <option key={r} value={r}>
                {fieldLabel(r)}
                {(LIST_FIELDS as readonly string[]).includes(r) ? " []" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Document version
          <select name="version" defaultValue={versionId} className="max-w-[320px] rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]">
            <option value="">all versions</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.logicalKey} v{v.versionNumber}: {v.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Priority
          <select name="priority" defaultValue={one(sp.priority)} className="rounded border border-[var(--line)] bg-white p-1 text-sm"><option value="">All priorities</option><option value="high">High</option><option value="normal">Normal</option></select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Confidence min
          <input name="min" type="number" step="0.01" min="0" max="1" defaultValue={min} placeholder="0.00" className="w-20 rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]" />
        </label>
        <label className="flex flex-col gap-0.5 text-xs text-[var(--muted)]">
          Confidence max
          <input name="max" type="number" step="0.01" min="0" max="1" defaultValue={max} placeholder="1.00" className="w-20 rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]" />
        </label>
        <button type="submit" className="rounded border border-[var(--accent)] bg-[var(--accent)] px-3 py-1 text-sm font-medium text-white hover:opacity-90">
          Apply
        </button>
        <Link href="/review" className="px-1 text-xs text-[var(--accent)] underline">
          Reset
        </Link>
        <span className="ml-auto text-xs text-[var(--muted)]">{items.length} item(s)</span>
      </form>

      <Table>
        <THead>
          <Th>Priority</Th>
          <Th>Document</Th>
          <Th>Field</Th>
          <Th>Candidate value</Th>
          <Th>Confidence</Th>
          <Th>Routing / verifier</Th>
          <Th>Status</Th>
          <Th>Reason</Th>
          <Th>Created</Th>
        </THead>
        <tbody>
          {items.length === 0 ? <TableEmpty colSpan={9}>No review items match these filters.</TableEmpty> : null}
          {items.map((r) => {
            const value = fmtValue(r.field.valueJson);
            return (
              <Tr key={r.item.id}>
                <Td>
                  <span className={`font-mono text-[11px] ${r.item.priority === "high" ? "text-[var(--bad)]" : "text-[var(--muted)]"}`}>{r.item.priority}</span>
                </Td>
                <Td>
                  <Link href={`/review/${r.item.id}`} className="text-[var(--accent)] underline">
                    {r.document.displayName}
                  </Link>
                  <div className="text-xs text-[var(--muted)]">
                    <Mono>{r.document.logicalKey}</Mono> v{r.version.versionNumber}
                  </div>
                </Td>
                <Td>
                  <Link href={`/review/${r.item.id}`} className="underline decoration-[var(--line)] hover:decoration-[var(--accent)]">
                    {r.fieldLabel}
                  </Link>
                  <div>
                    <Mono className="text-[var(--muted)]">{r.item.fieldPath}</Mono>
                  </div>
                </Td>
                <Td className="max-w-[320px]" title={value}>
                  {value === "" ? <span className="text-[var(--muted)]">null</span> : truncate(value, 90)}
                </Td>
                <Td>
                  <ConfidenceBar value={r.field.confidence} width={90} />
                </Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={r.field.routingStatus} />
                    <StatusBadge status={r.field.verifierStatus ?? "unverified"} title="verifier status" />
                    {r.field.contradiction ? <StatusBadge status="contradicted" /> : null}
                  </span>
                </Td>
                <Td>
                  <StatusBadge status={r.item.status} />
                </Td>
                <Td className="max-w-[280px] text-xs" title={r.item.reason}>
                  {truncate(r.item.reason, 80)}
                </Td>
                <Td>
                  <Mono>{fmtDate(r.item.createdAt)}</Mono>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
    </>
  );
}
