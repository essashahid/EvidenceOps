"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { FormButton } from "@/components/FormButton";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, THead, Th, Tr, Td, Mono } from "@/components/DataTable";
import { fmtBytes, shortId } from "@/components/format";
import { uploadAction, type UploadState } from "./actions";

const MAX_MB = 10;

export function UploadForm({ canUpload }: { canUpload: boolean }) {
  const [state, action] = useActionState<UploadState, FormData>(uploadAction, { rows: [], runId: null, runOutcome: null, error: null });
  const [selected, setSelected] = useState<{ name: string; size: number }[]>([]);
  const oversized = selected.filter((f) => f.size > MAX_MB * 1024 * 1024);

  return (
    <div className="space-y-4">
      <form action={action} className="rounded border border-[var(--line)] bg-[var(--card)] p-4">
        <label className="block text-sm">
          <span className="mb-1 block text-[var(--muted)]">Files (.pdf, .docx; max {MAX_MB} MB each)</span>
          <input
            name="files"
            type="file"
            multiple
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={!canUpload}
            onChange={(e) => setSelected(Array.from(e.target.files ?? []).map((f) => ({ name: f.name, size: f.size })))}
            className="block w-full text-sm file:mr-3 file:rounded file:border file:border-[var(--line)] file:bg-[var(--bg)] file:px-2.5 file:py-1 file:text-sm"
          />
        </label>
        {selected.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
            {selected.map((f) => (
              <li key={f.name} className={f.size > MAX_MB * 1024 * 1024 ? "text-[var(--bad)]" : ""}>
                {f.name} ({fmtBytes(f.size)}){f.size > MAX_MB * 1024 * 1024 ? " exceeds the size limit and will be rejected" : ""}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-3 flex items-center gap-3">
          <FormButton disabled={!canUpload || selected.length === 0 || oversized.length === selected.length} pendingText="Uploading and processing...">
            Upload and process
          </FormButton>
          <span className="text-xs text-[var(--muted)]">
            {canUpload ? "Each new content hash creates a version; identical files are recorded as duplicates. Processing runs synchronously with the inline job driver." : "Viewers cannot upload."}
          </span>
        </div>
        {state.error ? <div className="mt-3 text-sm text-[var(--bad)]">{state.error}</div> : null}
      </form>

      {state.rows.length > 0 ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">Results</span>
            {state.runId ? (
              <>
                <Link href={`/runs/${state.runId}`} className="text-[var(--accent)] underline">
                  Run <Mono>{shortId(state.runId)}</Mono>
                </Link>
                <span className="text-xs text-[var(--muted)]">{state.runOutcome}</span>
              </>
            ) : (
              <span className="text-xs text-[var(--muted)]">No new versions were created, so no processing run was started.</span>
            )}
          </div>
          <Table>
            <THead>
              <Th>File</Th>
              <Th>Type</Th>
              <Th align="right">Size</Th>
              <Th>SHA-256</Th>
              <Th>Logical key</Th>
              <Th align="right">Version</Th>
              <Th>Outcome</Th>
              <Th>Run</Th>
            </THead>
            <tbody>
              {state.rows.map((r, i) => (
                <Tr key={`${r.filename}-${i}`}>
                  <Td>
                    {r.documentId && r.documentVersionId ? (
                      <Link href={`/documents/${r.documentId}/versions/${r.documentVersionId}`} className="text-[var(--accent)] underline">
                        {r.filename}
                      </Link>
                    ) : (
                      r.filename
                    )}
                  </Td>
                  <Td>{r.type}</Td>
                  <Td align="right">{fmtBytes(r.size)}</Td>
                  <Td>{r.contentHash ? <Mono title={r.contentHash}>{r.contentHash.slice(0, 12)}</Mono> : ""}</Td>
                  <Td>{r.logicalKey ? <Mono>{r.logicalKey}</Mono> : ""}</Td>
                  <Td align="right">{r.versionNumber !== null ? `v${r.versionNumber}` : ""}</Td>
                  <Td>
                    <Outcome row={r} />
                  </Td>
                  <Td>
                    {r.outcome.kind === "duplicate" ? (
                      <Link href={`/runs/${r.outcome.duplicateRunId}`} className="text-[var(--accent)] underline">
                        <Mono>{shortId(r.outcome.duplicateRunId)}</Mono>
                      </Link>
                    ) : r.outcome.kind === "rejected" || !state.runId ? (
                      ""
                    ) : (
                      <Link href={`/runs/${state.runId}`} className="text-[var(--accent)] underline">
                        <Mono>{shortId(state.runId)}</Mono>
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}
    </div>
  );
}

function Outcome({ row }: { row: UploadState["rows"][number] }) {
  const o = row.outcome;
  switch (o.kind) {
    case "created":
      return (
        <span className="flex items-center gap-1.5">
          <StatusBadge status="completed" /> created
        </span>
      );
    case "new_version":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="review" /> new version superseding{" "}
          <Link href={`/documents/${row.documentId}/versions/${o.supersedesVersionId}`} className="text-[var(--accent)] underline">
            v{o.supersedesVersionNumber ?? "?"}
          </Link>
        </span>
      );
    case "duplicate":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="skipped" /> duplicate of{" "}
          <Link href={`/documents/${o.documentId}/versions/${o.existingVersionId}`} className="text-[var(--accent)] underline">
            existing version {row.versionNumber !== null ? `v${row.versionNumber}` : shortId(o.existingVersionId)}
          </Link>
        </span>
      );
    case "rejected":
      return (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status="failed" /> <span className="text-[var(--bad)]">{o.message}</span>
        </span>
      );
  }
}
