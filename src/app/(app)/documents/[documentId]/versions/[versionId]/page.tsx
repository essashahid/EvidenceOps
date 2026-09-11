import { jobsConfigured } from "@/lib/env";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ExternalLink } from "lucide-react";
import { mutationAllowed } from "@/lib/access";
import { FormButton } from "@/components/FormButton";
import { reprocessVersionAction } from "./actions";
import { requireWorkspace } from "@/lib/workspace";
import { getCurrentRecord, getVersion, listRecordHistory, listSourceBlocks, listStepsForVersion, listOpenReviewForVersion, type FieldRow } from "@/lib/queries/documents";
import { fieldLabel, LIST_FIELDS, SCALAR_FIELDS, parseFieldPath, type ReportRecord } from "@/lib/schema/report";
import { PageHeader } from "@/components/PageHeader";
import { Panel, SectionTitle } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { FieldValue } from "@/components/FieldValue";
import { EmptyState, EmptyLine } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono } from "@/components/ui/table";
import { TimeStamp } from "@/components/ui/time";
import { fmtBytes, fmtDate, fmtDuration, plural, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

const SECTIONS = [
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
  const versionHref = `/documents/${document.id}/versions/${version.id}`;
  const payload = (current?.record.payloadJson ?? null) as ReportRecord | null;
  const title = payload?.report_title || document.displayName;
  const canReprocess = mutationAllowed(context, ["admin"]) && jobsConfigured();

  return (
    <>
      <PageHeader section="documents"
        breadcrumbs={[
          { label: "Documents", href: "/documents" },
          { label: document.logicalKey, href: `/documents/${document.id}` },
          { label: `v${version.versionNumber}` },
        ]}
        title={
          <>
            <span className="min-w-0 break-words">{title}</span>
            <span className="text-[var(--muted)]">v{version.versionNumber}</span>
            <StatusBadge status={version.isCurrent ? "current" : "superseded"} />
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]">
            <span className="max-w-[320px] truncate" title={version.sourceFilename}>
              {version.sourceFilename}
            </span>
            <span>{fmtBytes(version.byteSize)}</span>
            {version.pageCount !== null ? <span>{plural(version.pageCount, "page")}</span> : null}
            <Mono title={version.contentHash}>sha256 {version.contentHash.slice(0, 12)}</Mono>
            <span className="flex items-center gap-1.5">
              Parse <StatusBadge status={version.parseStatus} size="sm" />
            </span>
            <span className="flex items-center gap-1.5">
              Processing <StatusBadge status={version.processingStatus} size="sm" />
            </span>
            <span title={fmtDate(version.createdAt, true)}>Uploaded {fmtDate(version.createdAt)}</span>
          </div>
        }
        actions={
          <>
            {canReprocess ? (
              <form action={reprocessVersionAction}>
                <input type="hidden" name="versionId" value={version.id} />
                <FormButton variant="secondary" size="sm" pendingText="Starting…" title="Run the pipeline again for this version">
                  Reprocess
                </FormButton>
              </form>
            ) : null}
            <Button asChild variant="secondary" size="sm">
              <a href={`${versionHref}/download`}>
                <Download size={14} aria-hidden />
                Source file
              </a>
            </Button>
          </>
        }
      />

      {/* In-page section nav; the header above it is sticky, so this sits just below it. */}
      <nav aria-label="Sections" className="sticky top-[96px] z-20 -mx-4 mb-5 border-y border-[var(--line)] bg-[var(--bg)]/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 no-print">
        <ul className="flex flex-wrap gap-1.5 text-[13px]">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="inline-flex rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent-border)] hover:text-[var(--accent)]">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {/* -------------------------------- Record -------------------------------- */}
      <SectionTitle
        id="record"
        title="Extracted record"
        count={current?.fields.length}
        description="Every value with the evidence it came from, the confidence code assigned it, and where it was routed."
        actions={
          current ? (
            <span className="flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
              Record v{current.record.versionNumber}
              <StatusBadge status={current.record.createdByType === "reviewer" ? "accepted" : "auto_approved"} size="sm" title={`Created by ${current.record.createdByType}`} />
            </span>
          ) : null
        }
      />
      {!current ? (
        <EmptyState title="No record has been extracted for this version">
          Extraction has not produced a record yet. The Processing section below shows where the pipeline stopped.
        </EmptyState>
      ) : (
        <RecordView fields={current.fields} openByField={openByField} versionHref={versionHref} />
      )}

      {/* -------------------------------- History -------------------------------- */}
      <SectionTitle id="history" title="Record history" count={history.length} className="mt-8" description="Model output is never overwritten. Reviewer decisions and reprocessing each create a new version." />
      {history.length === 0 ? (
        <EmptyLine>No record versions exist for this document version.</EmptyLine>
      ) : (
        <Table minWidth={900}>
          <THead>
            <Th align="right" width={70}>
              Version
            </Th>
            <Th width={130}>Origin</Th>
            <Th width={120}>Model config</Th>
            <Th>Changed fields</Th>
            <Th width={150}>Created by</Th>
            <Th width={110}>State</Th>
            <Th align="right" width={160}>
              Created
            </Th>
          </THead>
          <tbody>
            {history.map(({ record, createdByName }) => (
              <Tr key={record.id}>
                <Td align="right" className="font-medium">
                  v{record.versionNumber}
                </Td>
                <Td>
                  <StatusBadge status={record.createdByType === "reviewer" ? "accepted" : record.createdByType === "reprocess" ? "processing" : "auto_approved"} size="sm" title={record.createdByType} />
                  <div className="mt-0.5 text-[12px] capitalize text-[var(--muted)]">{record.createdByType}</div>
                </Td>
                <Td>
                  <Mono title={record.modelConfigHash ?? undefined} className="text-[var(--muted)]">
                    {shortId(record.modelConfigHash) || "—"}
                  </Mono>
                </Td>
                <Td className="max-w-[380px]">
                  {record.changedFields.length === 0 ? (
                    <span className="text-[var(--muted)]">{record.versionNumber === 1 ? "Initial extraction" : "No field changes"}</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {record.changedFields.slice(0, 6).map((f) => (
                        <Mono key={f} className="rounded-[var(--r-sm)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px]">
                          {f}
                        </Mono>
                      ))}
                      {record.changedFields.length > 6 ? <span className="text-[12px] text-[var(--muted)]">+{record.changedFields.length - 6} more</span> : null}
                    </span>
                  )}
                  <details className="mt-1.5 text-[12px]">
                    <summary className="cursor-pointer text-[var(--muted)] transition-colors hover:text-[var(--accent)]">Saved record</summary>
                    <pre className="scroll-thin mt-1 max-h-72 overflow-auto rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-2 font-mono text-[11.5px] leading-5">{JSON.stringify(record.payloadJson, null, 2)}</pre>
                  </details>
                </Td>
                <Td className="truncate">{createdByName ?? (record.createdByType === "model" ? <span className="text-[var(--muted)]">Pipeline</span> : "—")}</Td>
                <Td>{record.isCurrent ? <StatusBadge status="current" size="sm" /> : <span className="text-[12px] text-[var(--muted)]">Superseded</span>}</Td>
                <Td align="right">
                  <TimeStamp value={record.createdAt} withSeconds />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* -------------------------------- Source -------------------------------- */}
      <SectionTitle
        id="source"
        title="Parsed source"
        count={blocks.length}
        className="mt-8"
        description="The document as the pipeline sees it. Every block has a stable locator that evidence and citations link to."
      />
      {blocks.length === 0 ? (
        <EmptyState title="No source blocks">This version has not been parsed, or parsing failed. See the Processing section.</EmptyState>
      ) : (
        <Panel>
          <div className="scroll-thin max-h-[640px] divide-y divide-[var(--line)] overflow-y-auto">
            {blocks.map((b) => (
              <article key={b.id} id={b.locator} className="px-4 py-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--muted)]">
                  <a href={`#${b.locator}`} className="font-mono font-medium text-[var(--accent)] transition-colors hover:underline">
                    {b.locator}
                  </a>
                  <span className="capitalize">{b.blockType}</span>
                  {b.pageNumber !== null ? <span>page {b.pageNumber}</span> : null}
                  {b.paragraphNumber !== null ? <span>paragraph {b.paragraphNumber}</span> : null}
                  <span className="tnum text-[var(--faint)]">
                    chars {b.charStart}–{b.charEnd}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-6">{b.rawText}</p>
              </article>
            ))}
          </div>
        </Panel>
      )}

      {/* ------------------------------ Processing ------------------------------ */}
      <SectionTitle
        id="processing"
        title="Processing steps"
        count={steps.length}
        className="mt-8"
        description="Durable steps for this version, including retries. Successful steps are reused when the version is reprocessed."
        actions={
          runIds.length > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
              Runs:
              {runIds.map((id) => (
                <Link key={id} href={`/runs/${id}`} className="inline-flex items-center gap-1 text-[var(--accent)] transition-colors hover:underline">
                  <Mono>{shortId(id)}</Mono>
                  <ExternalLink size={11} aria-hidden />
                </Link>
              ))}
            </span>
          ) : null
        }
      />
      {steps.length === 0 ? (
        <EmptyLine>No run steps have been recorded for this version.</EmptyLine>
      ) : (
        <Table minWidth={860}>
          <THead>
            <Th width={190}>Step</Th>
            <Th width={130}>Status</Th>
            <Th align="right" width={90}>
              Attempts
            </Th>
            <Th align="right" width={100}>
              Latency
            </Th>
            <Th width={110}>Run</Th>
            <Th>Error</Th>
            <Th align="right" width={160}>
              Started
            </Th>
          </THead>
          <tbody>
            {steps.map(({ step }) => (
              <Tr key={step.id}>
                <Td>
                  <Mono className="font-medium text-[var(--fg)]">{step.stepName}</Mono>
                </Td>
                <Td>
                  <StatusBadge status={step.status} size="sm" />
                </Td>
                <Td align="right" className={step.attemptCount > 1 ? "font-semibold text-[var(--warn)]" : ""}>
                  {step.attemptCount}
                </Td>
                <Td align="right">{fmtDuration(step.latencyMs) || <span className="text-[var(--faint)]">—</span>}</Td>
                <Td>
                  <Link href={`/runs/${step.processingRunId}`} className="text-[var(--accent)] transition-colors hover:underline">
                    <Mono>{shortId(step.processingRunId)}</Mono>
                  </Link>
                </Td>
                <Td className="max-w-[380px] text-[12.5px] text-[var(--bad)]">
                  {step.errorCode ? <Mono className="font-semibold">{step.errorCode}</Mono> : null}
                  {step.errorMessage ? <span className="ml-1.5">{step.errorMessage}</span> : null}
                  {!step.errorCode && !step.errorMessage ? <span className="text-[var(--faint)]">—</span> : null}
                </Td>
                <Td align="right">
                  <TimeStamp value={step.startedAt} withSeconds />
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}

/**
 * Scalar fields share a single group (their row labels already name them); each list
 * field gets its own group so items read as a numbered set.
 */
function RecordView({ fields, openByField, versionHref }: { fields: FieldRow[]; openByField: Map<string, { id: string }>; versionHref: string }) {
  const byRoot = new Map<string, FieldRow[]>();
  for (const f of fields) {
    const { root } = parseFieldPath(f.fieldPath);
    const list = byRoot.get(root) ?? [];
    list.push(f);
    byRoot.set(root, list);
  }
  const scalarRoots = (SCALAR_FIELDS as readonly string[]).filter((r) => byRoot.has(r));
  const listRoots: string[] = [...(LIST_FIELDS as readonly string[]).filter((r) => byRoot.has(r)), ...[...byRoot.keys()].filter((r) => !(SCALAR_FIELDS as readonly string[]).includes(r) && !(LIST_FIELDS as readonly string[]).includes(r))];

  return (
    <Panel>
      {scalarRoots.length > 0 ? (
        <section className="border-b border-[var(--line)] last:border-b-0">
          <h3 className="bg-[var(--surface-sunken)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">Document details</h3>
          {scalarRoots.flatMap((root) => (byRoot.get(root) ?? []).map((f) => <FieldLine key={f.id} field={f} label={fieldLabel(root)} openItemId={openByField.get(f.fieldPath)?.id ?? null} versionHref={versionHref} />))}
        </section>
      ) : null}

      {listRoots.map((root) => {
        const rows = byRoot.get(root) ?? [];
        return (
          <section key={root} className="border-b border-[var(--line)] last:border-b-0">
            <h3 className="flex items-center gap-2 bg-[var(--surface-sunken)] px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">
              {fieldLabel(root)}
              <span className="tnum font-normal normal-case tracking-normal">{plural(countItems(rows), "item")}</span>
            </h3>
            {rows.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-[var(--faint)]">Nothing extracted for this field.</p>
            ) : (
              rows.map((f) => <FieldLine key={f.id} field={f} label={fieldLabel(f.fieldPath).replace(`${fieldLabel(root)} `, "Item ")} openItemId={openByField.get(f.fieldPath)?.id ?? null} versionHref={versionHref} />)
            )}
          </section>
        );
      })}
    </Panel>
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

function FieldLine({ field, label, openItemId, versionHref }: { field: FieldRow; label: string; openItemId: string | null; versionHref: string }) {
  const suggested = field.verifierCorrectedValueJson;
  const differs = suggested !== null && suggested !== undefined && JSON.stringify(suggested) !== JSON.stringify(field.valueJson);
  return (
    <div className="grid grid-cols-1 gap-x-5 gap-y-2 border-t border-[var(--line)] px-4 py-3 first:border-t-0 lg:grid-cols-[168px_minmax(0,1fr)_132px_190px]">
      <div className="text-[12.5px] font-medium text-[var(--muted)]">
        {label}
        {field.isRequired ? (
          <span className="ml-1 text-[var(--bad)]" title="Required field">
            *
          </span>
        ) : null}
      </div>

      <div className="min-w-0 text-[13px]">
        <div className="leading-6">
          <FieldValue fieldPath={field.fieldPath} value={field.valueJson} />
        </div>

        {differs ? (
          <p className="mt-1 text-[12.5px] text-[var(--warn)]">
            Verifier suggests: <FieldValue fieldPath={field.fieldPath} value={suggested} compact />
          </p>
        ) : null}

        {field.validationMessages.map((m, i) => (
          <p key={i} className={`mt-1 text-[12.5px] ${m.level === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"}`}>
            <Mono>{m.code}</Mono> {m.message}
          </p>
        ))}

        {field.evidence.length === 0 ? (
          <p className="mt-1.5 text-[12.5px] text-[var(--bad)]">No evidence recorded</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {field.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px] text-[var(--muted)]">
                <a href={`${versionHref}#${e.sourceLocator}`} className="font-mono text-[var(--accent)] transition-colors hover:underline" title="Open this block in the parsed source">
                  {e.sourceLocator}
                </a>
                <span className={e.exactMatch ? "text-[var(--ok)]" : "text-[var(--warn)]"} title={e.exactMatch ? "The quote occurs verbatim in the source block" : "The quote could not be located verbatim in the source block"}>
                  {e.exactMatch ? "found verbatim" : "not found verbatim"}
                </span>
                <span className="min-w-0 italic">&ldquo;{e.quoteText}&rdquo;</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-start lg:justify-end">
        <ConfidenceBar value={field.confidence} width={70} />
      </div>

      <div className="flex flex-wrap items-start gap-1.5">
        <StatusBadge status={field.routingStatus} size="sm" />
        <StatusBadge status={field.verifierStatus ?? "unverified"} size="sm" title="Verifier verdict" />
        {field.contradiction ? <StatusBadge status="contradicted" size="sm" /> : null}
        {openItemId ? (
          <Link href={`/review/${openItemId}`} className="inline-flex items-center rounded-full border border-[var(--warn-border)] bg-[var(--warn-soft)] px-2 py-0.5 text-[12px] font-medium text-[var(--warn)] transition-colors hover:brightness-98">
            Review →
          </Link>
        ) : null}
      </div>
    </div>
  );
}
