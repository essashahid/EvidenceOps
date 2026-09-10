"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import type { DocumentListRow } from "@/lib/queries/documents";
import { StatusBadge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { Button } from "@/components/ui/button";
import { Mono, rowLink } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty";
import { fmtAgo, fmtDate, plural } from "@/components/format";
import { cn } from "@/lib/utils";

const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, DocumentListRow>();

const columns = helper.columns([
  helper.accessor("displayName", {
    header: "Document",
    cell: (c) => (
      <div className="min-w-[220px] max-w-[360px]">
        <Link className={rowLink} href={`/documents/${c.row.original.id}`} title={c.getValue()}>
          {c.getValue()}
        </Link>
        <div className="mt-0.5 truncate font-mono text-[11.5px] text-[var(--muted)]">{c.row.original.logicalKey}</div>
      </div>
    ),
  }),
  helper.accessor("versionNumber", {
    header: "Version",
    cell: (c) => (
      <span className="tnum whitespace-nowrap">
        v{c.getValue()}
        {c.row.original.versionCount > 1 ? <span className="text-[var(--muted)]"> of {c.row.original.versionCount}</span> : null}
      </span>
    ),
  }),
  helper.accessor("mimeType", { header: "Format", cell: (c) => <span className="text-[11.5px] font-semibold text-[var(--muted)]">{c.getValue()?.includes("pdf") ? "PDF" : "DOCX"}</span> }),
  helper.accessor("publicationDate", { header: "Published", cell: (c) => (c.getValue() ? <span className="tnum whitespace-nowrap">{c.getValue()}</span> : <span className="text-[var(--faint)]">Not stated</span>) }),
  helper.accessor("documentType", {
    header: "Classification",
    cell: (c) => (c.getValue() ? <span className="whitespace-nowrap capitalize">{c.getValue()!.replaceAll("_", " ")}</span> : <span className="text-[var(--faint)]">Pending</span>),
  }),
  helper.accessor("processingStatus", { header: "Status", cell: (c) => <StatusBadge status={c.getValue()} /> }),
  helper.accessor("openReviewCount", {
    header: "Review",
    cell: (c) =>
      c.getValue() ? (
        <Link href={`/review?version=${c.row.original.currentVersionId ?? ""}`} className="font-semibold text-[var(--warn)] transition-colors hover:underline" title="Open the review queue filtered to this document">
          {c.getValue()}
        </Link>
      ) : (
        <span className="text-[var(--faint)]">0</span>
      ),
  }),
  helper.accessor("averageConfidence", { header: "Confidence", cell: (c) => <ConfidenceBar value={c.getValue()} width={64} /> }),
  helper.accessor("updatedAt", { header: "Processed", cell: (c) => <span className="whitespace-nowrap text-[12px] text-[var(--muted)]" title={fmtDate(c.getValue(), true)}>{fmtAgo(c.getValue())}</span> }),
]);

export function DocumentTable({ documents }: { documents: DocumentListRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [review, setReview] = useState(false);
  const [versions, setVersions] = useState(false);

  const data = useMemo(
    () =>
      documents.filter(
        (d) =>
          (!query || `${d.displayName} ${d.logicalKey} ${d.sourceFilename ?? ""}`.toLowerCase().includes(query.toLowerCase())) &&
          (!status || d.processingStatus === status) &&
          (!type || d.documentType === type) &&
          (!review || d.openReviewCount > 0) &&
          (!versions || d.versionCount > 1),
      ),
    [documents, query, status, type, review, versions],
  );
  const table = useTable({ features, columns, data });
  const active = Boolean(query || status || type || review || versions);
  const statuses = Array.from(new Set(documents.map((d) => d.processingStatus).filter(Boolean)));
  const types = Array.from(new Set(documents.map((d) => d.documentType).filter(Boolean)));

  const reset = () => {
    setQuery("");
    setStatus("");
    setType("");
    setReview(false);
    setVersions(false);
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]">
        <div className="relative min-w-[200px] flex-1">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
          <input aria-label="Search documents" placeholder="Search title, key or filename" value={query} onChange={(e) => setQuery(e.target.value)} className="w-full py-1.5 pl-8 pr-2.5" />
        </div>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="px-2.5 py-1.5">
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s!}>
              {s!.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <select aria-label="Filter by classification" value={type} onChange={(e) => setType(e.target.value)} className="px-2.5 py-1.5">
          <option value="">All classifications</option>
          {types.map((t) => (
            <option key={t} value={t!}>
              {t!.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <Toggle active={review} onClick={() => setReview((v) => !v)}>
          Needs review
        </Toggle>
        <Toggle active={versions} onClick={() => setVersions((v) => !v)}>
          Multiple versions
        </Toggle>
        {active ? (
          <Button variant="ghost" size="sm" onClick={reset} type="button">
            Reset
          </Button>
        ) : null}
        <span className="ml-auto whitespace-nowrap text-[12px] text-[var(--muted)]">
          {active ? `${data.length} of ${documents.length}` : plural(documents.length, "document")}
        </span>
      </div>

      {data.length === 0 ? (
        <EmptyState title="No documents match these filters" action={<Button variant="secondary" size="sm" type="button" onClick={reset}>Clear filters</Button>}>
          Try a different search term, or clear the status and classification filters.
        </EmptyState>
      ) : (
        <>
          {/* Desktop: full table. */}
          <div className="scroll-thin hidden overflow-x-auto rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)] md:block">
            <table className="w-full min-w-[1080px] border-collapse text-left text-[13px]">
              <thead className="bg-[var(--surface-sunken)] text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">
                {table.getHeaderGroups().map((g) => (
                  <tr key={g.id}>
                    {g.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      return (
                        <th key={h.id} scope="col" className="whitespace-nowrap border-b border-[var(--line)] px-3 py-2" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                          <button onClick={h.column.getToggleSortingHandler()} className="group inline-flex items-center gap-1 font-semibold uppercase tracking-[0.05em] transition-colors hover:text-[var(--fg)]">
                            <table.FlexRender header={h} />
                            <span aria-hidden className={cn("transition-opacity", sorted ? "text-[var(--accent)] opacity-100" : "opacity-0 group-hover:opacity-60")}>
                              {sorted === "asc" ? <ArrowUp size={12} /> : sorted === "desc" ? <ArrowDown size={12} /> : <ChevronsUpDown size={12} />}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--line)] transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]">
                    {r.getAllCells().map((c) => (
                      <td key={c.id} className="px-3 py-2.5 align-middle">
                        <table.FlexRender cell={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Phones: one card per document, no horizontal scrolling. */}
          <ul className="flex flex-col gap-2 md:hidden">
            {data.map((d) => (
              <li key={d.id} className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3 shadow-[var(--shadow-sm)]">
                <Link href={`/documents/${d.id}`} className="block font-medium text-[var(--fg)]">
                  {d.displayName}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--muted)]">
                  <Mono>{d.logicalKey}</Mono>
                  <span>v{d.versionNumber}</span>
                  <span>{d.mimeType?.includes("pdf") ? "PDF" : "DOCX"}</span>
                  <span>{fmtAgo(d.updatedAt)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.processingStatus} size="sm" />
                  {d.openReviewCount > 0 ? <StatusBadge status="review" size="sm" title={`${d.openReviewCount} open review items`} /> : null}
                  <ConfidenceBar value={d.averageConfidence} width={56} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-[34px] whitespace-nowrap rounded-[var(--r-md)] border px-2.5 text-[13px] font-medium transition-colors",
        active ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--line-strong)] bg-[var(--surface)] text-[var(--muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)]",
      )}
    >
      {children}
    </button>
  );
}
