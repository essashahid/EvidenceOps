import Link from "next/link";
import { ArrowRight, ChevronRight, ListChecks } from "lucide-react";
import { canReview, requireWorkspace } from "@/lib/workspace";
import { listReviewItems, reviewCounts, type ReviewFilters } from "@/lib/review/queries";
import { firstOpenReviewItemId, listReviewFieldRoots, listReviewVersions } from "@/lib/queries/review";
import { fieldLabel, LIST_FIELDS, SCALAR_FIELDS } from "@/lib/schema/report";
import { PageHeader } from "@/components/PageHeader";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { StatusBadge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { FieldValue } from "@/components/FieldValue";
import { Field, FilterBar, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono, rowLink } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { EmptyState } from "@/components/ui/empty";
import { Notice } from "@/components/ui/panel";
import { plural, truncate } from "@/components/format";

/**
 * The stored reason repeats what the badges already say. Prefer the verifier's own
 * explanation when there is one, otherwise the substance after the routing prefix.
 */
function explainReason(reason: string): string {
  const verifier = /\(verifier:\s*([^)]+)\)/i.exec(reason);
  if (verifier?.[1]) return verifier[1].trim();
  return reason
    .replace(/^(blocked|review|auto_approved):\s*/i, "")
    .replace(/^verifier found the value (unsupported|only partially supported);?\s*/i, "")
    .trim();
}

export const dynamic = "force-dynamic";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
  { value: "needs_source", label: "Needs source" },
  { value: "superseded", label: "Superseded" },
  { value: "all", label: "All statuses" },
] as const;
type Status = (typeof STATUSES)[number]["value"];

type Search = { [key: string]: string | string[] | undefined };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function numOrUndefined(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const statusRaw = one(sp.status) || "open";
  const status: Status = (STATUSES as readonly { value: string }[]).some((s) => s.value === statusRaw) ? (statusRaw as Status) : "open";
  const field = one(sp.field);
  const versionId = one(sp.version);
  const priority = one(sp.priority);
  const min = one(sp.min);
  const max = one(sp.max);
  const flash = one(sp.flash);

  const filters: ReviewFilters = {
    status,
    priority: priority === "high" ? "high" : priority === "normal" ? "normal" : undefined,
    fieldPath: field ? `${field}%` : undefined,
    documentVersionId: versionId || undefined,
    minConfidence: numOrUndefined(min),
    maxConfidence: numOrUndefined(max),
  };
  const [counts, items, versions, roots, firstOpenId] = await Promise.all([
    reviewCounts(workspace.workspaceId),
    listReviewItems(workspace.workspaceId, filters),
    listReviewVersions(workspace.workspaceId),
    listReviewFieldRoots(workspace.workspaceId),
    firstOpenReviewItemId(workspace.workspaceId),
  ]);
  const reviewer = canReview(workspace.role);
  const knownRoots: string[] = [...SCALAR_FIELDS, ...LIST_FIELDS];
  const fieldOptions = [...knownRoots.filter((r) => roots.includes(r)), ...roots.filter((r) => !knownRoots.includes(r))];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtered = Boolean(field || versionId || priority || min || max) || status !== "open";
  const showStatus = status !== "open";

  return (
    <>
      <PageHeader
        section="review"
        title="Review queue"
        subtitle="Every value the pipeline could not auto-approve, with the evidence behind it. Decisions create a new immutable record version."
        actions={
          firstOpenId ? (
            <Button asChild size="sm">
              <Link href={`/review/${firstOpenId}`}>
                {reviewer ? "Start reviewing" : "Open the first item"}
                <ArrowRight size={14} aria-hidden />
              </Link>
            </Button>
          ) : null
        }
      />

      {flash ? (
        <Notice tone="ok" className="mb-4">
          {flash}
        </Notice>
      ) : null}

      <MetricGroup className="mb-4">
        <Metric label="Open" value={counts.open ?? 0} tone={(counts.open ?? 0) > 0 ? "warn" : "ok"} hint="Awaiting a reviewer" href="/review?status=open" />
        <Metric label="Resolved" value={counts.resolved ?? 0} tone="ok" hint="Accepted or edited" href="/review?status=resolved" />
        <Metric label="Rejected" value={counts.rejected ?? 0} tone={(counts.rejected ?? 0) > 0 ? "bad" : "default"} hint="Value cleared" href="/review?status=rejected" />
        <Metric label="Needs source" value={counts.needs_source ?? 0} tone={(counts.needs_source ?? 0) > 0 ? "bad" : "default"} hint="Evidence insufficient" href="/review?status=needs_source" />
      </MetricGroup>

      <form method="get">
        <FilterBar
          actions={
            <>
              <Button type="submit" size="sm">
                Apply
              </Button>
              {filtered ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/review">Reset</Link>
                </Button>
              ) : null}
            </>
          }
          meta={
            <>
              {plural(items.length, "item")}
              {filtered ? ` of ${total}` : null}
            </>
          }
        >
          <Field label="Status" className="w-[150px]">
            <Select name="status" defaultValue={status}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Field" className="w-[180px]">
            <Select name="field" defaultValue={field}>
              <option value="">All fields</option>
              {fieldOptions.map((r) => (
                <option key={r} value={r}>
                  {fieldLabel(r)}
                  {(LIST_FIELDS as readonly string[]).includes(r) ? " (list)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Document" className="w-full sm:w-[300px]">
            <Select name="version" defaultValue={versionId}>
              <option value="">All documents</option>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.logicalKey} v{v.versionNumber} — {v.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority" className="w-[140px]">
            <Select name="priority" defaultValue={priority}>
              <option value="">Any priority</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
            </Select>
          </Field>
          <Field label="Confidence">
            <div className="flex items-center gap-1.5">
              <Input name="min" type="number" step="0.01" min="0" max="1" defaultValue={min} placeholder="0.00" className="w-[74px]" aria-label="Minimum confidence" />
              <span className="text-[12px] text-[var(--faint)]">to</span>
              <Input name="max" type="number" step="0.01" min="0" max="1" defaultValue={max} placeholder="1.00" className="w-[74px]" aria-label="Maximum confidence" />
            </div>
          </Field>
        </FilterBar>
      </form>

      {items.length === 0 ? (
        <EmptyState hue="review"
          icon={<ListChecks size={18} aria-hidden />}
          title={filtered ? "No items match these filters" : "The review queue is clear"}
          action={
            filtered ? (
              <Button asChild variant="secondary" size="sm">
                <Link href="/review">Clear filters</Link>
              </Button>
            ) : (
              <Button asChild variant="secondary" size="sm">
                <Link href="/documents">Browse documents</Link>
              </Button>
            )
          }
        >
          {filtered
            ? "Widen the confidence range or clear a filter to see more of the queue."
            : "Every extracted value either cleared the auto-approval threshold or has already been decided by a reviewer."}
        </EmptyState>
      ) : (
        <>
        <Table minWidth={1000} className="hidden md:block">
          <THead sticky>
            <Th width={230}>Field</Th>
            <Th width={210}>Document</Th>
            <Th>Candidate value</Th>
            <Th width={130}>Confidence</Th>
            <Th width={190}>Signals</Th>
            {showStatus ? <Th width={110}>Status</Th> : null}
            <Th width={92} align="right">
              Age
            </Th>
            <Th width={36} />
          </THead>
          <tbody>
            {items.map((r) => {
              const high = r.item.priority === "high";
              return (
                <Tr key={r.item.id}>
                  <Td className="relative">
                    {high ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[var(--bad)]" /> : null}
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link href={`/review/${r.item.id}`} className={rowLink}>
                        {r.fieldLabel}
                      </Link>
                      <span className="flex items-center gap-1.5">
                        <Mono className="text-[var(--muted)]">{r.item.fieldPath}</Mono>
                        {high && r.field.routingStatus !== "blocked" ? <StatusBadge status="high" size="sm" title="High priority: a required field" /> : null}
                      </span>
                    </div>
                  </Td>
                  <Td className="max-w-[210px]">
                    <div className="min-w-0">
                      <Link href={`/documents/${r.document.id}`} className="block truncate text-[var(--fg)] transition-colors hover:text-[var(--accent)]" title={r.document.displayName}>
                        {r.document.displayName}
                      </Link>
                      <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">
                        <Mono>{r.document.logicalKey}</Mono> v{r.version.versionNumber}
                      </div>
                    </div>
                  </Td>
                  <Td className="max-w-[420px] py-2">
                    <Link href={`/review/${r.item.id}`} className="block min-w-0 text-[var(--fg)]">
                      <FieldValue fieldPath={r.item.fieldPath} value={r.field.valueJson} limit={150} />
                    </Link>
                  </Td>
                  <Td>
                    <ConfidenceBar value={r.field.confidence} width={74} />
                  </Td>
                  <Td title={r.item.reason}>
                    <span className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={r.field.routingStatus} size="sm" />
                      <StatusBadge status={r.field.verifierStatus ?? "unverified"} size="sm" title={`Verifier: ${r.field.verifierStatus ?? "not run"}`} />
                      {r.field.contradiction ? <StatusBadge status="contradicted" size="sm" title="The verifier found conflicting evidence" /> : null}
                    </span>
                    <span className="mt-1 block truncate text-[12px] text-[var(--muted)]">{truncate(explainReason(r.item.reason), 70)}</span>
                  </Td>
                  {showStatus ? (
                    <Td>
                      <StatusBadge status={r.item.status} size="sm" />
                    </Td>
                  ) : null}
                  <Td align="right">
                    <TimeAgo value={r.item.createdAt} />
                  </Td>
                  <Td align="right">
                    <Link href={`/review/${r.item.id}`} aria-label={`Review ${r.fieldLabel} on ${r.document.displayName}`} className="inline-flex text-[var(--faint)] transition-colors hover:text-[var(--accent)]">
                      <ChevronRight size={16} aria-hidden />
                    </Link>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>

        {/* Phones: one card per item, so the queue never needs sideways scrolling. */}
        <ul className="flex flex-col gap-2 md:hidden">
          {items.map((r) => (
            <li key={r.item.id}>
              <Link
                href={`/review/${r.item.id}`}
                className="relative block rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 pl-4 shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--surface-hover)]"
              >
                {r.item.priority === "high" ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-l-[var(--r-lg)] bg-[var(--bad)]" /> : null}
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate font-medium text-[var(--fg)]">{r.fieldLabel}</span>
                  <TimeAgo value={r.item.createdAt} className="shrink-0 text-[11.5px]" />
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-[var(--muted)]">
                  {r.document.displayName} · <Mono>{r.document.logicalKey}</Mono> v{r.version.versionNumber}
                </span>
                <span className="mt-2 block text-[13px] leading-5">
                  <FieldValue fieldPath={r.item.fieldPath} value={r.field.valueJson} limit={120} compact />
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <ConfidenceBar value={r.field.confidence} width={56} />
                  <StatusBadge status={r.field.routingStatus} size="sm" />
                  <StatusBadge status={r.field.verifierStatus ?? "unverified"} size="sm" />
                  {r.field.contradiction ? <StatusBadge status="contradicted" size="sm" /> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        </>
      )}
    </>
  );
}
