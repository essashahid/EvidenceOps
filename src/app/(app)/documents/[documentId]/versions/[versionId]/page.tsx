import { jobsConfigured } from "@/lib/env";
import Link from "next/link";
import { mutationAllowed } from "@/lib/access";
import { FormButton } from "@/components/FormButton";
import { reprocessVersionAction } from "./actions";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { getCurrentRecord, getVersion, listRecordHistory, listSourceBlocks, listStepsForVersion, listOpenReviewForVersion, type FieldRow } from "@/lib/queries/documents";
import { fieldLabel, LIST_FIELDS, SCALAR_FIELDS, parseFieldPath } from "@/lib/schema/report";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { EmptyState } from "@/components/EmptyState";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtBytes, fmtDate, fmtDuration, fmtValue, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "record", label: "Record" },
  { id: "history", label: "History" },
  { id: "source", label: "Source" },
  { id: "processing", label: "Processing" },
];

export default async function VersionPage({ params }: { params: Promise<{ documentId: string; versionId: string }> }) {
  const { documentId, versionId } = await params;
  const context = await requireWorkspace();
  const { workspace } = context;
  const row = await getVersion(workspace.workspaceId, versionId);
  if (!row || row.document.id !== documentId) notFound();
  const { version, document } = row;
  const [current, history, blocks, steps, openReview] = await Promise.all([
    getCurrentRecord(version.id),
    listRecordHistory(version.id),
    listSourceBlocks(version.id),
    listStepsForVersion(version.id),
    listOpenReviewForVersion(version.id),
  ]);
  const runIds = Array.from(new Set(steps.map((s) => s.step.processingRunId)));
  const openByField = new Map(openReview.map((r) => [r.fieldPath, r]));

  return (
    <>
      <PageHeader
        title={
          <span>
            {document.displayName} <span className="text-[var(--muted)]">v{version.versionNumber}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/documents/${document.id}`} className="text-[var(--accent)] underline">
              <Mono>{document.logicalKey}</Mono>
            </Link>
            <span>{version.sourceFilename}</span>
            <span>{fmtBytes(version.byteSize)}</span>
            <span>{version.pageCount !== null ? `${version.pageCount} page(s)` : ""}</span>
            <Mono title={version.contentHash}>sha256 {version.contentHash.slice(0, 12)}</Mono>
            <span>
              parse <StatusBadge status={version.parseStatus} />
            </span>
            <span>
              processing <StatusBadge status={version.processingStatus} />
            </span>
            {version.isCurrent ? <StatusBadge status="accepted" title="current version" /> : <span className="text-xs">superseded</span>}
            <span>uploaded {fmtDate(version.createdAt)}</span>
          </span>
        }
        actions={
          <nav className="flex flex-wrap gap-1 text-sm">
            {mutationAllowed(context, ["admin"]) && jobsConfigured() ? <form action={reprocessVersionAction}><input type="hidden" name="versionId" value={version.id}/><FormButton variant="secondary" pendingText="Starting…">Reprocess</FormButton></form> : null}
            <a href={`/documents/${document.id}/versions/${version.id}/download`} className="rounded border border-[var(--line)] px-2 py-0.5 text-[var(--accent)]">Download source</a>
            {TABS.map((t) => (
              <a key={t.id} href={`#${t.id}`} className="rounded border border-[var(--line)] bg-[var(--card)] px-2 py-0.5 hover:bg-[var(--bg)]">
                {t.label}
              </a>
            ))}
          </nav>
        }
      />

      {/* (a) Record */}
      <SectionHeader id="record" title="Record" count={current?.fields.length} actions={current ? <span className="text-xs text-[var(--muted)]">record version {current.record.versionNumber}, {current.record.createdByType}</span> : null} />
      {!current ? (
        <EmptyState title="No record version yet">The extraction has not produced a record for this version. Check the Processing section.</EmptyState>
      ) : (
        <RecordView fields={current.fields} openByField={openByField} versionHref={`/documents/${document.id}/versions/${version.id}`} />
      )}

      {/* (b) History */}
      <SectionHeader id="history" title="History" count={history.length} />
      <Table>
        <THead>
          <Th align="right">Version</Th>
          <Th>Origin</Th>
          <Th>Model config</Th>
          <Th>Changed fields</Th>
          <Th>Created by</Th>
          <Th>Parent</Th>
          <Th>Current</Th>
          <Th>Created</Th>
        </THead>
        <tbody>
          {history.length === 0 ? <TableEmpty colSpan={8}>No record versions.</TableEmpty> : null}
          {history.map(({ record, createdByName }) => (
            <Tr key={record.id}>
              <Td align="right">{record.versionNumber}</Td>
              <Td>
                <StatusBadge status={record.createdByType} />
                <details className="mt-2"><summary className="cursor-pointer text-[var(--accent)]">View saved record</summary><pre className="mt-2 max-h-80 max-w-xl overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(record.payloadJson, null, 2)}</pre></details>
              </Td>
              <Td>
                <Mono title={record.modelConfigHash ?? undefined}>{shortId(record.modelConfigHash)}</Mono>
              </Td>
              <Td className="max-w-[420px]">
                {record.changedFields.length === 0 ? (
                  <span className="text-[var(--muted)]">{record.versionNumber === 1 ? "initial extraction" : "none"}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {record.changedFields.map((f) => (
                      <Mono key={f} className="rounded bg-[var(--bg)] px-1">
                        {f}
                      </Mono>
                    ))}
                  </span>
                )}
              </Td>
              <Td>{createdByName ?? (record.createdByType === "model" ? "pipeline" : "")}</Td>
              <Td>
                <Mono title={record.parentRecordVersionId ?? undefined}>{shortId(record.parentRecordVersionId)}</Mono>
              </Td>
              <Td>{record.isCurrent ? <StatusBadge status="accepted" /> : ""}</Td>
              <Td>
                <Mono>{fmtDate(record.createdAt, true)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      {/* (c) Source */}
      <SectionHeader id="source" title="Source" count={blocks.length} actions={<span className="text-xs text-[var(--muted)]">Full document text by block. Each block is addressable as #{"{locator}"}.</span>} />
      {blocks.length === 0 ? (
        <EmptyState title="No source blocks">The document has not been parsed, or parsing failed.</EmptyState>
      ) : (
        <div className="max-h-[640px] overflow-y-auto rounded border border-[var(--line)] bg-[var(--card)]">
          {blocks.map((b) => (
            <div key={b.id} id={b.locator} className="scroll-mt-4 border-b border-[var(--line)] px-3 py-2 last:border-b-0 target:bg-[color-mix(in_srgb,var(--accent)_8%,white)]">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                <a href={`#${b.locator}`} className="font-mono text-[var(--accent)]">
                  {b.locator}
                </a>
                <span>{b.blockType}</span>
                {b.pageNumber !== null ? <span>page {b.pageNumber}</span> : null}
                {b.paragraphNumber !== null ? <span>paragraph {b.paragraphNumber}</span> : null}
                <span>
                  chars {b.charStart}..{b.charEnd}
                </span>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{b.rawText}</pre>
            </div>
          ))}
        </div>
      )}

      {/* (d) Processing */}
      <SectionHeader
        id="processing"
        title="Processing"
        count={steps.length}
        actions={
          runIds.length > 0 ? (
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[var(--muted)]">Runs:</span>
              {runIds.map((id) => (
                <Link key={id} href={`/runs/${id}`} className="text-[var(--accent)] underline">
                  <Mono>{shortId(id)}</Mono>
                </Link>
              ))}
            </span>
          ) : null
        }
      />
      <Table>
        <THead>
          <Th>Step</Th>
          <Th>Status</Th>
          <Th align="right">Attempts</Th>
          <Th align="right">Latency</Th>
          <Th>Run</Th>
          <Th>Error</Th>
          <Th>Started</Th>
        </THead>
        <tbody>
          {steps.length === 0 ? <TableEmpty colSpan={7}>No run steps recorded for this version.</TableEmpty> : null}
          {steps.map(({ step }) => (
            <Tr key={step.id}>
              <Td>
                <Mono>{step.stepName}</Mono>
              </Td>
              <Td>
                <StatusBadge status={step.status} />
              </Td>
              <Td align="right">{step.attemptCount}</Td>
              <Td align="right">{fmtDuration(step.latencyMs)}</Td>
              <Td>
                <Link href={`/runs/${step.processingRunId}`} className="text-[var(--accent)] underline">
                  <Mono>{shortId(step.processingRunId)}</Mono>
                </Link>
              </Td>
              <Td className="max-w-[420px] text-xs text-[var(--bad)]">
                {step.errorCode ? <Mono>{step.errorCode}</Mono> : null}
                {step.errorMessage ? <span className="ml-1">{step.errorMessage}</span> : null}
              </Td>
              <Td>
                <Mono>{fmtDate(step.startedAt, true)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

/** Group leaf field values by their root field so lists render as item groups. */
function RecordView({ fields, openByField, versionHref }: { fields: FieldRow[]; openByField: Map<string, { id: string }>; versionHref: string }) {
  const byRoot = new Map<string, FieldRow[]>();
  for (const f of fields) {
    const { root } = parseFieldPath(f.fieldPath);
    const list = byRoot.get(root) ?? [];
    list.push(f);
    byRoot.set(root, list);
  }
  const roots: string[] = [...SCALAR_FIELDS, ...LIST_FIELDS];
  for (const r of byRoot.keys()) if (!roots.includes(r)) roots.push(r);

  return (
    <div className="rounded border border-[var(--line)] bg-[var(--card)]">
      {roots.map((root) => {
        const rows = byRoot.get(root) ?? [];
        const isList = (LIST_FIELDS as readonly string[]).includes(root);
        return (
          <div key={root} className="border-b border-[var(--line)] last:border-b-0">
            <div className="flex items-center gap-2 bg-[var(--bg)] px-3 py-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">
              <span>{fieldLabel(root)}</span>
              {isList ? <span>{countItems(rows)} item(s)</span> : null}
            </div>
            {rows.length === 0 ? <div className="px-3 py-1.5 text-sm text-[var(--muted)]">empty</div> : null}
            {rows.map((f) => (
              <FieldLine key={f.id} field={f} label={isList ? fieldLabel(f.fieldPath).replace(`${fieldLabel(root)} `, "") : fieldLabel(root)} open={openByField.has(f.fieldPath)} versionHref={versionHref} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function countItems(rows: FieldRow[]): number {
  const idx = new Set<number>();
  for (const r of rows) {
    const { index } = parseFieldPath(r.fieldPath);
    if (index !== null) idx.add(index);
  }
  return idx.size;
}

function FieldLine({ field, label, open, versionHref }: { field: FieldRow; label: string; open: boolean; versionHref: string }) {
  const value = fmtValue(field.valueJson);
  return (
    <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-[var(--line)] px-3 py-2 text-sm first:border-t-0 md:grid-cols-[200px_minmax(0,1fr)_170px_120px_100px]">
      <div className="text-[var(--muted)]">
        {label}
        {field.isRequired ? <span className="ml-1 text-[var(--bad)]" title="required">*</span> : null}
      </div>
      <div className="min-w-0">
        <div className="break-words">{value === "" ? <span className="text-[var(--muted)]">null</span> : value}</div>
        {field.verifierCorrectedValueJson !== null && field.verifierCorrectedValueJson !== undefined ? (
          <div className="text-xs text-[var(--warn)]">verifier suggests: {fmtValue(field.verifierCorrectedValueJson)}</div>
        ) : null}
        {field.validationMessages.map((m, i) => (
          <div key={i} className={`text-xs ${m.level === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"}`}>
            {m.code}: {m.message}
          </div>
        ))}
        {field.evidence.length === 0 ? (
          <div className="mt-0.5 text-xs text-[var(--bad)]">no evidence</div>
        ) : (
          field.evidence.map((e, i) => (
            <div key={i} className="mt-0.5 text-xs text-[var(--muted)]">
              <a href={`${versionHref}#${e.sourceLocator}`} className="font-mono text-[var(--accent)]" title="open in source">
                {e.sourceLocator}
              </a>
              <span className={`ml-1 ${e.exactMatch ? "" : "text-[var(--warn)]"}`} title={e.exactMatch ? "quote matches the source verbatim" : "quote not found verbatim in the source block"}>
                {e.exactMatch ? "exact" : "fuzzy"}
              </span>
              <span className="ml-1 italic">&ldquo;{e.quoteText}&rdquo;</span>
            </div>
          ))
        )}
      </div>
      <div>
        <ConfidenceBar value={field.confidence} />
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={field.routingStatus} />
        {open ? <StatusBadge status="open" title="open review item" /> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge status={field.verifierStatus ?? "unverified"} title="verifier status" />
        {field.contradiction ? <StatusBadge status="contradicted" /> : null}
      </div>
    </div>
  );
}
