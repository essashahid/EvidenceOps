"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { FileText, UploadCloud, X } from "lucide-react";
import { FormButton } from "@/components/FormButton";
import { PipelineExplainer } from "@/components/PipelineExplainer";
import { RunProgress } from "@/components/RunProgress";
import { StatusBadge } from "@/components/ui/badge";
import { Panel, PanelHeader, PanelBody, PanelFooter, SectionTitle, Notice } from "@/components/ui/panel";
import { Table, THead, Th, Tr, Td, Mono, rowLink } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { fmtBytes, plural, shortId } from "@/components/format";
import { prepareSourceUpload, uploadAction, type UploadState } from "./actions";
import { cn } from "@/lib/utils";

const MAX_MB = 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type Picked = { name: string; size: number };

export function UploadForm({ canUpload, directUpload }: { canUpload: boolean; directUpload: boolean }) {
  async function submit(previous: UploadState, data: FormData): Promise<UploadState> {
    if (!directUpload) return uploadAction(previous, data);
    try {
      const files = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
      if (files.length > 20) throw new Error("Upload at most 20 files at a time.");
      const descriptors = new FormData();
      for (const file of files) {
        const target = await prepareSourceUpload(file.name, file.size);
        if (target.driver === "blob") {
          const { put } = await import("@vercel/blob/client");
          await put(target.path, file, {
            access: "private",
            token: target.token,
            contentType: file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });
        } else {
          const { createClient } = await import("@supabase/supabase-js");
          const sb = createClient(target.url, target.anonKey, { auth: { persistSession: false } });
          const { error } = await sb.storage.from(target.bucket).uploadToSignedUrl(target.path, target.token, file);
          if (error) throw new Error(`Upload failed for ${file.name}. Please retry.`);
        }
        descriptors.append("uploaded", JSON.stringify({ filename: file.name, size: file.size, path: target.path }));
      }
      return uploadAction(previous, descriptors);
    } catch (error) {
      return { rows: [], runId: null, runOutcome: null, error: error instanceof Error ? error.message : "Upload failed." };
    }
  }

  const [state, action] = useActionState<UploadState, FormData>(submit, { rows: [], runId: null, runOutcome: null, error: null });
  const [selected, setSelected] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const oversized = selected.filter((f) => f.size > MAX_BYTES);
  const wrongType = selected.filter((f) => !/\.(pdf|docx)$/i.test(f.name));
  const usable = selected.length - oversized.length - wrongType.length;

  const sync = (files: FileList | null) => setSelected(Array.from(files ?? []).map((f) => ({ name: f.name, size: f.size })));

  return (
    <div className="flex flex-col gap-5">
      <Panel as="div">
        <form action={action}>
          <PanelBody>
            {/* Drop zone doubles as the file picker; the input stays in the DOM for the form post. */}
            <div
              onDragOver={(e) => {
                if (!canUpload) return;
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                if (!canUpload) return;
                e.preventDefault();
                setDragging(false);
                if (inputRef.current && e.dataTransfer.files.length) {
                  inputRef.current.files = e.dataTransfer.files;
                  sync(e.dataTransfer.files);
                }
              }}
              className={cn(
                "flex flex-col items-center justify-center rounded-[var(--r-lg)] border-2 border-dashed px-6 py-9 text-center transition-colors",
                dragging ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line-strong)] bg-[var(--surface-sunken)]",
                !canUpload && "opacity-60",
              )}
            >
              <span className="mb-3 grid size-11 place-items-center rounded-full bg-[var(--surface)] text-[var(--accent)] shadow-[var(--shadow-sm)]">
                <UploadCloud size={20} aria-hidden />
              </span>
              <p className="text-[14px] font-medium">{dragging ? "Drop to add these files" : "Drag PDF or DOCX files here"}</p>
              <p className="mt-1 text-[12.5px] text-[var(--muted)]">Up to {MAX_MB} MB and 50 pages each, 20 files at a time.</p>
              <Button type="button" variant="secondary" size="sm" className="mt-3" disabled={!canUpload} onClick={() => inputRef.current?.click()}>
                Choose files
              </Button>
              <input ref={inputRef} name="files" type="file" multiple accept={ACCEPT} disabled={!canUpload} onChange={(e) => sync(e.target.files)} className="sr-only" aria-label="Choose PDF or DOCX files" />
            </div>

            {selected.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-1.5">
                {selected.map((f) => {
                  const bad = f.size > MAX_BYTES || !/\.(pdf|docx)$/i.test(f.name);
                  return (
                    <li
                      key={f.name}
                      className={cn(
                        "flex items-center gap-2.5 rounded-[var(--r-md)] border px-3 py-2 text-[13px]",
                        bad ? "border-[var(--bad-border)] bg-[var(--bad-soft)]" : "border-[var(--line)] bg-[var(--surface)]",
                      )}
                    >
                      <FileText size={15} aria-hidden className={bad ? "text-[var(--bad)]" : "text-[var(--muted)]"} />
                      <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="tnum shrink-0 text-[12px] text-[var(--muted)]">{fmtBytes(f.size)}</span>
                      {bad ? <span className="shrink-0 text-[12px] font-medium text-[var(--bad)]">{f.size > MAX_BYTES ? `over ${MAX_MB} MB` : "unsupported type"}</span> : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {state.error ? (
              <Notice tone="bad" className="mt-3">
                {state.error}
              </Notice>
            ) : null}
          </PanelBody>

          <PanelFooter>
            <span className="min-w-0">
              {!canUpload
                ? "This workspace is read-only. Sign in with an authorized account to upload."
                : selected.length === 0
                  ? "Each new content hash creates a version; an identical file is recorded as a duplicate and never reprocessed."
                  : `${plural(usable, "file")} ready${oversized.length + wrongType.length > 0 ? `, ${oversized.length + wrongType.length} will be rejected` : ""}.`}
            </span>
            <span className="ml-auto flex items-center gap-2">
              {selected.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (inputRef.current) inputRef.current.value = "";
                    setSelected([]);
                  }}
                >
                  <X size={14} aria-hidden />
                  Clear
                </Button>
              ) : null}
              <FormButton disabled={!canUpload || usable === 0} pendingText="Uploading and processing…">
                Upload and process
              </FormButton>
            </span>
          </PanelFooter>
        </form>
      </Panel>

      {state.runId ? <RunProgress runId={state.runId} /> : null}

      {state.rows.length > 0 ? (
        <section>
          <SectionTitle
            title="Results"
            count={state.rows.length}
            actions={
              state.runId ? (
                <span className="flex items-center gap-2 text-[12.5px] text-[var(--muted)]">
                  {state.runOutcome}
                  <Button asChild variant="secondary" size="xs">
                    <Link href={`/runs/${state.runId}`}>
                      Open run <Mono>{shortId(state.runId)}</Mono>
                    </Link>
                  </Button>
                </span>
              ) : (
                <span className="text-[12.5px] text-[var(--muted)]">No new versions were created, so no processing run started.</span>
              )
            }
          />
          <Table minWidth={900}>
            <THead>
              <Th>File</Th>
              <Th width={80}>Type</Th>
              <Th align="right" width={90}>
                Size
              </Th>
              <Th width={130}>SHA-256</Th>
              <Th width={140}>Logical key</Th>
              <Th align="right" width={80}>
                Version
              </Th>
              <Th>Outcome</Th>
            </THead>
            <tbody>
              {state.rows.map((r, i) => (
                <Tr key={`${r.filename}-${i}`}>
                  <Td className="max-w-[300px]">
                    {r.documentId && r.documentVersionId ? (
                      <Link href={`/documents/${r.documentId}/versions/${r.documentVersionId}`} className={rowLink} title={r.filename}>
                        {r.filename}
                      </Link>
                    ) : (
                      <span className="truncate" title={r.filename}>
                        {r.filename}
                      </span>
                    )}
                  </Td>
                  <Td className="uppercase text-[var(--muted)]">{r.type}</Td>
                  <Td align="right">{fmtBytes(r.size)}</Td>
                  <Td>{r.contentHash ? <Mono title={r.contentHash} className="text-[var(--muted)]">{r.contentHash.slice(0, 12)}</Mono> : <span className="text-[var(--faint)]">—</span>}</Td>
                  <Td>{r.logicalKey ? <Mono>{r.logicalKey}</Mono> : <span className="text-[var(--faint)]">—</span>}</Td>
                  <Td align="right">{r.versionNumber !== null ? `v${r.versionNumber}` : <span className="text-[var(--faint)]">—</span>}</Td>
                  <Td>
                    <Outcome row={r} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      <Panel>
        <PanelHeader dense title="What happens next" />
        <PanelBody>
          <PipelineExplainer />
        </PanelBody>
      </Panel>
    </div>
  );
}

function Outcome({ row }: { row: UploadState["rows"][number] }) {
  const o = row.outcome;
  switch (o.kind) {
    case "created":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="created" size="sm" />
          <span className="text-[12.5px] text-[var(--muted)]">first version of this document</span>
        </span>
      );
    case "new_version":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="new_version" size="sm" />
          <span className="text-[12.5px] text-[var(--muted)]">
            supersedes{" "}
            <Link href={`/documents/${row.documentId}/versions/${o.supersedesVersionId}`} className="text-[var(--accent)] hover:underline">
              v{o.supersedesVersionNumber ?? "?"}
            </Link>
          </span>
        </span>
      );
    case "duplicate":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="duplicate" size="sm" />
          <span className="text-[12.5px] text-[var(--muted)]">
            identical to{" "}
            <Link href={`/documents/${o.documentId}/versions/${o.existingVersionId}`} className="text-[var(--accent)] hover:underline">
              {row.versionNumber !== null ? `v${row.versionNumber}` : shortId(o.existingVersionId)}
            </Link>
            ; not reprocessed
          </span>
        </span>
      );
    case "rejected":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="failed" size="sm" />
          <span className="text-[12.5px] text-[var(--bad)]">{o.message}</span>
        </span>
      );
  }
}
