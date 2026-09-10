"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import type { DocumentListRow } from "@/lib/queries/documents";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { fmtDate } from "@/components/format";
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() });
const helper = createColumnHelper<typeof features, DocumentListRow>();
const columns = helper.columns([
  helper.accessor("displayName", { header:"Document", cell: c => <div className="min-w-56 max-w-80"><Link className="font-medium text-[var(--accent)] hover:underline" href={`/documents/${c.row.original.id}`}>{c.getValue()}</Link><div className="mt-1 font-mono text-[11px] text-[var(--muted)]">{c.row.original.logicalKey}</div></div> }),
  helper.accessor("versionNumber", { header:"Version", cell:c=><span className="whitespace-nowrap">v{c.getValue()} <span className="text-xs text-[var(--muted)]">/ {c.row.original.versionCount}</span></span> }),
  helper.accessor("mimeType", { header:"Format", cell:c=><span className="font-mono text-xs uppercase">{c.getValue()?.includes("pdf")?"PDF":"DOCX"}</span> }),
  helper.accessor("publicationDate",{header:"Published",cell:c=>c.getValue()??"Not stated"}),
  helper.accessor("documentType", {header:"Classification",cell:c=><span className="text-xs">{c.getValue()?.replaceAll("_"," ")??"Pending"}</span>}),
  helper.accessor("processingStatus",{header:"Status",cell:c=><StatusBadge status={c.getValue()}/>}),
  helper.accessor("openReviewCount",{header:"Review",cell:c=><span className={c.getValue()?"font-semibold text-[var(--warn)]":"text-[var(--muted)]"}>{c.getValue()}</span>}),
  helper.accessor("averageConfidence",{header:"Confidence",cell:c=><ConfidenceBar value={c.getValue()}/>}),
  helper.accessor("updatedAt",{header:"Last processed",cell:c=><span className="whitespace-nowrap text-xs text-[var(--muted)]">{fmtDate(c.getValue())}</span>}),
]);
export function DocumentTable({ documents }: { documents: DocumentListRow[] }) {
  const [query,setQuery]=useState(""); const [status,setStatus]=useState(""); const [type,setType]=useState(""); const [review,setReview]=useState(false);const [versions,setVersions]=useState(false);
  const data=useMemo(()=>documents.filter(d=>(!query || `${d.displayName} ${d.logicalKey}`.toLowerCase().includes(query.toLowerCase()))&&(!status||d.processingStatus===status)&&(!type||d.documentType===type)&&(!review||d.openReviewCount>0)&&(!versions||d.versionCount>1)),[documents,query,status,type,review,versions]);
  const table=useTable({features,columns,data});
  return <><div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] bg-white p-3"><input aria-label="Search documents" placeholder="Search by title or key…" value={query} onChange={e=>setQuery(e.target.value)} className="min-w-48 flex-1 border border-[var(--line)] px-3 text-sm"/><select aria-label="Filter by status" value={status} onChange={e=>setStatus(e.target.value)} className="border border-[var(--line)] px-2 text-sm"><option value="">All statuses</option>{Array.from(new Set(documents.map(d=>d.processingStatus).filter(Boolean))).map(s=><option key={s} value={s!}>{s!.replaceAll("_"," ")}</option>)}</select><select aria-label="Filter by document type" value={type} onChange={e=>setType(e.target.value)} className="border border-[var(--line)] px-2 text-sm"><option value="">All types</option>{Array.from(new Set(documents.map(d=>d.documentType).filter(Boolean))).map(t=><option key={t} value={t!}>{t!.replaceAll("_"," ")}</option>)}</select><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={review} onChange={e=>setReview(e.target.checked)}/>Needs review</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={versions} onChange={e=>setVersions(e.target.checked)}/>Multiple versions</label></div>
  <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-white"><table className="w-full text-left text-[13px]"><thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--muted)]">{table.getHeaderGroups().map(g=><tr key={g.id}>{g.headers.map(h=><th key={h.id} className="whitespace-nowrap px-3 py-3" aria-sort={h.column.getIsSorted()==="asc"?"ascending":h.column.getIsSorted()==="desc"?"descending":"none"}><button onClick={h.column.getToggleSortingHandler()} className="flex items-center gap-1"><table.FlexRender header={h}/><span aria-hidden>{h.column.getIsSorted()==="asc"?"↑":h.column.getIsSorted()==="desc"?"↓":"↕"}</span></button></th>)}</tr>)}</thead><tbody>{table.getRowModel().rows.map(r=><tr key={r.id} className="border-t border-[var(--line)] hover:bg-[var(--bg)]">{r.getAllCells().map(c=><td key={c.id} className="px-3 py-4"><table.FlexRender cell={c}/></td>)}</tr>)}{!data.length?<tr><td colSpan={columns.length} className="p-12 text-center text-[var(--muted)]">No documents match these filters.</td></tr>:null}</tbody></table></div><p className="mt-3 text-xs text-[var(--muted)]">{data.length} of {documents.length} documents · Select a column heading to sort.</p></>;
}
