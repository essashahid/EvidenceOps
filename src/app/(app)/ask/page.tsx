import { mutationAllowed } from "@/lib/access";
import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getAnswer } from "@/lib/rag/answer";
import { listRecentQuestions, loadChunkTexts, loadVersionRefs, type VersionRef } from "@/lib/queries/ask";
import type { AnswerMode } from "@/lib/db/schema";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { FormButton } from "@/components/FormButton";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtDuration, fmtNumber, fmtUsd } from "@/components/format";
import { askAction } from "./actions";

export const dynamic = "force-dynamic";

const MODES: { value: AnswerMode; label: string }[] = [
  { value: "answer", label: "Answer" },
  { value: "executive_brief", label: "Executive Brief" },
  { value: "findings", label: "Findings Summary" },
  { value: "recommendations", label: "Recommendation Summary" },
];

type Retrieved = { text?: string; chunkId: string; documentVersionId: string; logicalKey: string; versionNumber: number; similarity: number; lexical: number; combined: number; startLocator: string; endLocator: string };
type AnswerJson = { invalidCitations?: number; citations?: {raw: string; valid: boolean}[] };

/** One numbered citation ready to render: [n] linking to the source block anchor. */
type CiteRef = { n: number; valid: boolean; quote: string; href: string | null; locator: string | null; label: string };

const INPUT = "w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--fg)]";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const context = await requireWorkspace();
  const { workspace } = context;
  const canAsk = mutationAllowed(context);
  const answerId = one(sp.answer);
  const error = one(sp.error);
  const [stored, recent] = await Promise.all([answerId ? getAnswer(answerId) : Promise.resolve(null), listRecentQuestions(workspace.workspaceId, 10)]);
  // Only show answers that belong to this workspace.
  const loaded = stored && stored.query.workspaceId === workspace.workspaceId ? stored : null;

  const retrieved = (loaded ? (loaded.answer.retrievedJson as Retrieved[]) : []) ?? [];
  const json = (loaded?.answer.answerJson ?? {}) as AnswerJson;
  const versionIds = [...retrieved.map((r) => r.documentVersionId), ...(loaded?.citations ?? []).map((c) => c.documentVersionId).filter((v): v is string => Boolean(v))];
  const [versions, chunkText] = await Promise.all([loadVersionRefs(workspace.workspaceId, versionIds), loadChunkTexts(retrieved.map((r) => r.chunkId))]);

  const refs: CiteRef[] = (loaded?.citations ?? []).map((row, i) => {
    const ref = row.documentVersionId ? versions.get(row.documentVersionId) : undefined;
    return {
      n: i + 1, valid: Boolean(ref), quote: row.quoteText ?? "", locator: row.sourceLocator,
      href: ref && row.sourceLocator ? `/documents/${ref.documentId}/versions/${ref.versionId}#${row.sourceLocator}` : null,
      label: ref ? `${ref.logicalKey} v${ref.versionNumber}` : "Source unavailable",
    };
  });
  const citationLinks = new Map((loaded?.citations ?? []).map((row, i) => [json.citations?.filter(c => c.valid)[i]?.raw ?? row.quoteText, refs[i]!]));

  const modeLabel = (m: string) => MODES.find((x) => x.value === m)?.label ?? m;

  return (
    <>
      <PageHeader title="Ask & draft" subtitle="Evidence-bound answers over the indexed documents. Inspect the sources behind answers and first drafts." />
      {error ? <div className="mb-3 rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-1.5 text-sm text-[var(--bad)]">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <form action={askAction} className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
            Question
            <textarea name="question" rows={3} required maxLength={2000} defaultValue={loaded?.query.queryText ?? ""} placeholder="What is the revised program cost in the Northstar operational review?" className={INPUT} />
          </label>
          <div className="mt-2 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
              Mode
              <select name="mode" defaultValue={loaded?.answer.mode ?? "answer"} className="rounded border border-[var(--line)] bg-[var(--card)] px-1.5 py-1 text-sm text-[var(--fg)]">
                {MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 pb-1 text-sm">
              <input type="checkbox" name="includeSuperseded" defaultChecked={loaded?.query.includeSuperseded ?? false} />
              Include superseded versions
            </label>
            <FormButton disabled={!canAsk} pendingText="Retrieving and answering...">Ask</FormButton>
          </div>
          {!canAsk ? <p className="mt-3 text-xs text-[var(--muted)]">Select a saved question to inspect its answer and evidence. Sign in to run a new request.</p> : null}
        </form>

        <div className="rounded border border-[var(--line)] bg-[var(--card)]">
          <div className="border-b border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">Recent questions</div>
          {recent.length === 0 ? <div className="px-3 py-2 text-xs text-[var(--muted)]">Nothing asked yet.</div> : null}
          <ul className="max-h-[260px] overflow-y-auto text-sm">
            {recent.map((q) => (
              <li key={q.answerId} className={`border-b border-[var(--line)] px-3 py-1.5 last:border-b-0 ${q.answerId === answerId ? "bg-[var(--bg)]" : ""}`}>
                <Link href={`/ask?answer=${q.answerId}`} className="line-clamp-2 text-[var(--accent)] underline" title={q.question}>
                  {q.question}
                </Link>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                  <span>{modeLabel(q.mode)}</span>
                  <StatusBadge status={q.sufficient ? "supported" : "needs_source"} title={q.sufficient ? "sufficient evidence" : "refused: insufficient evidence"} />
                  {q.includeSuperseded ? <span title="included superseded versions">+superseded</span> : null}
                  <Mono>{fmtDate(q.createdAt)}</Mono>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {answerId && !loaded ? <div className="mt-4 rounded border border-dashed border-[var(--line)] bg-[var(--card)] px-3 py-4 text-center text-sm text-[var(--muted)]">Answer not found in this workspace.</div> : null}

      {loaded ? (
        <>
          <SectionHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {modeLabel(loaded.answer.mode)}
                <StatusBadge status={loaded.answer.sufficientEvidence ? "supported" : "needs_source"} title={loaded.answer.sufficientEvidence ? "sufficient evidence" : "insufficient evidence"} />
              </span>
            }
            actions={
              <span className="text-xs text-[var(--muted)]">
                asked {fmtDate(loaded.answer.createdAt, true)}
                {loaded.query.includeSuperseded ? ", superseded versions included" : ""}
              </span>
            }
          />
          {!loaded.answer.sufficientEvidence ? (
            <div className="rounded border border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_8%,white)] px-3 py-2 text-sm">
              <div className="font-semibold text-[var(--bad)]">Refused: insufficient evidence</div>
              <div className="mt-0.5">{loaded.answer.refusalReason ?? "The retrieved evidence could not support an answer."}</div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">{loaded.answer.answerText}</div>
            </div>
          ) : (
            <div className="rounded border border-[var(--line)] bg-[var(--card)] p-5 text-sm">
              <div className="whitespace-pre-wrap break-words leading-7">
                {loaded.answer.answerText.split(/(\[[A-Z0-9][A-Z0-9-]*\s+v\d+\s+[^\]]+\])/g).map((part, i) => {
                  const ref = citationLinks.get(part);
                  return ref?.href ? <Link key={i} href={ref.href} className="text-[var(--accent)] underline" title="Inspect cited source">{part}</Link> : <span key={i}>{part}</span>;
                })}
              </div>
              {json.invalidCitations ? <p className="mt-2 text-[var(--bad)]">{json.invalidCitations} citation(s) could not be validated.</p> : null}
            </div>
          )}

          {refs.length > 0 ? (
            <div className="mt-2 rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Citations</div>
              <ol className="flex flex-col gap-0.5">
                {refs.map((r) => (
                  <li key={r.n} className="grid grid-cols-[36px_minmax(0,1fr)] gap-x-1.5 leading-5">
                    <span>
                      <CiteBadge r={r} />
                    </span>
                    <span className="min-w-0 break-words">
                      <span>{r.label}</span>
                      {r.locator ? <Mono className="ml-1.5 text-[var(--muted)]">{r.locator}</Mono> : null}
                      <span className="ml-1.5 italic text-[var(--muted)]">&ldquo;{r.quote}&rdquo;</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="mt-2 text-xs text-[var(--muted)]">
            model <Mono>{loaded.answer.model}</Mono>, prompt <Mono>{loaded.answer.promptVersion}</Mono>, tokens {fmtNumber(loaded.answer.inputTokens)} in / {fmtNumber(loaded.answer.outputTokens)} out, latency {fmtDuration(loaded.answer.latencyMs)}, est. cost {fmtUsd(loaded.answer.estimatedCostUsd)}
          </div>

          <SectionHeader title="Retrieved evidence" count={retrieved.length} actions={<span className="text-xs text-[var(--muted)]">hybrid: 0.75 vector + 0.25 lexical</span>} />
          <Table>
            <THead>
              <Th align="right">#</Th>
              <Th>Document</Th>
              <Th align="right">Version</Th>
              <Th>Current</Th>
              <Th>Locators</Th>
              <Th align="right">Similarity</Th>
              <Th align="right">Lexical</Th>
              <Th align="right">Combined</Th>
              <Th>Text</Th>
            </THead>
            <tbody>
              {retrieved.length === 0 ? <TableEmpty colSpan={9}>No chunks were retrieved.</TableEmpty> : null}
              {retrieved.map((r, i) => {
                const ref: VersionRef | undefined = versions.get(r.documentVersionId);
                const text = r.text ?? chunkText.get(r.chunkId);
                return (
                  <Tr key={r.chunkId}>
                    <Td align="right">{i + 1}</Td>
                    <Td>
                      {ref ? (
                        <Link href={`/documents/${ref.documentId}/versions/${ref.versionId}#${r.startLocator}`} className="text-[var(--accent)] underline">
                          {ref.displayName}
                        </Link>
                      ) : (
                        <span className="text-[var(--muted)]">not in workspace</span>
                      )}
                      <div className="text-xs text-[var(--muted)]">
                        <Mono>{r.logicalKey}</Mono>
                      </div>
                    </Td>
                    <Td align="right">v{r.versionNumber}</Td>
                    <Td>{ref ? ref.isCurrent ? <StatusBadge status="accepted" title="current version" /> : <span className="text-xs text-[var(--muted)]">superseded</span> : ""}</Td>
                    <Td>
                      <Mono>
                        {r.startLocator}
                        {r.endLocator !== r.startLocator ? ` .. ${r.endLocator}` : ""}
                      </Mono>
                    </Td>
                    <Td align="right">{Number(r.similarity).toFixed(3)}</Td>
                    <Td align="right">{Number(r.lexical).toFixed(3)}</Td>
                    <Td align="right">{Number(r.combined).toFixed(3)}</Td>
                    <Td className="max-w-[420px]">
                      {text === undefined ? (
                        <span className="text-xs text-[var(--muted)]">chunk no longer indexed</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-xs text-[var(--accent)]">{text.length} chars</summary>
                          <pre className="mt-1 max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words font-mono text-xs leading-5">{text}</pre>
                        </details>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </>
      ) : null}
    </>
  );
}

function CiteBadge({ r }: { r: CiteRef | undefined }) {
  if (!r) return null;
  const cls = r.valid ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--bad)] text-[var(--bad)] line-through";
  const title = `${r.valid ? "source citation" : "source not found"}: "${r.quote}"`;
  if (r.href && r.valid) {
    return (
      <Link href={r.href} title={title} className={`inline-block rounded border px-1 font-mono text-[11px] leading-4 no-underline hover:bg-[var(--bg)] ${cls}`}>
        [{r.n}]
      </Link>
    );
  }
  return (
    <span title={title} className={`inline-block rounded border px-1 font-mono text-[11px] leading-4 ${cls}`}>
      [{r.n}]
    </span>
  );
}
