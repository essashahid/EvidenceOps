import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { getAnswer, type ValidatedClaim } from "@/lib/rag/answer";
import { listRecentQuestions, loadChunkTexts, loadVersionRefs, type VersionRef } from "@/lib/queries/ask";
import type { DraftSections } from "@/lib/llm/types";
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

type Retrieved = { chunkId: string; documentVersionId: string; logicalKey: string; versionNumber: number; similarity: number; lexical: number; combined: number; startLocator: string; endLocator: string };
type AnswerJson = { claims?: ValidatedClaim[]; draft?: DraftSections | null; unsupportedClaims?: number };

/** One numbered citation ready to render: [n] linking to the source block anchor. */
type CiteRef = { n: number; valid: boolean; quote: string; href: string | null; locator: string | null; label: string };

const INPUT = "w-full rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-sm text-[var(--fg)]";

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function AskPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const sp = await searchParams;
  const { workspace } = await requireWorkspace();
  const answerId = one(sp.answer);
  const error = one(sp.error);
  const [stored, recent] = await Promise.all([answerId ? getAnswer(answerId) : Promise.resolve(null), listRecentQuestions(workspace.workspaceId, 10)]);
  // Only show answers that belong to this workspace.
  const loaded = stored && stored.query.workspaceId === workspace.workspaceId ? stored : null;

  const retrieved = (loaded ? (loaded.answer.retrievedJson as Retrieved[]) : []) ?? [];
  const json = (loaded?.answer.answerJson ?? {}) as AnswerJson;
  const claims = json.claims ?? [];
  const draft = json.draft ?? null;
  const versionIds = [...retrieved.map((r) => r.documentVersionId), ...(loaded?.citations ?? []).map((c) => c.documentVersionId).filter((v): v is string => Boolean(v))];
  const [versions, chunkText] = await Promise.all([loadVersionRefs(workspace.workspaceId, versionIds), loadChunkTexts(retrieved.map((r) => r.chunkId))]);

  // Number citations in order of first appearance across the claims (answer mode) or draft sections, anchored to the precise block when the stored row resolved one.
  const byText = new Map(claims.map((c) => [c.text.trim(), c]));
  const orderedClaims: { text: string; citations: { chunkIndex: number; quote: string }[] }[] =
    loaded && loaded.answer.mode !== "answer" && draft ? [...draft.key_evidence, ...draft.findings, ...draft.recommendations] : claims;
  const refs = new Map<string, CiteRef>();
  for (const claim of orderedClaims) {
    for (const ci of claim.citations) {
      const key = `${ci.chunkIndex}|${ci.quote}`;
      if (refs.has(key)) continue;
      const validated = byText.get(claim.text.trim());
      const vc = validated?.citations.find((c) => c.chunkIndex === ci.chunkIndex && c.quote === ci.quote);
      const row = loaded?.citations.find((c) => c.supportedClaim === claim.text && c.quoteText === ci.quote);
      const chunk = retrieved[ci.chunkIndex];
      const versionId = row?.documentVersionId ?? chunk?.documentVersionId ?? null;
      const ref = versionId ? versions.get(versionId) : undefined;
      const locator = row?.sourceLocator ?? vc?.sourceLocator ?? chunk?.startLocator ?? null;
      refs.set(key, {
        n: refs.size + 1,
        valid: vc ? vc.valid : Boolean(row),
        quote: ci.quote,
        locator,
        href: ref && locator ? `/documents/${ref.documentId}/versions/${ref.versionId}#${locator}` : null,
        label: ref ? `${ref.logicalKey} v${ref.versionNumber}` : chunk ? `${chunk.logicalKey} v${chunk.versionNumber}` : "unknown source",
      });
    }
  }
  const refFor = (chunkIndex: number, quote: string): CiteRef | undefined => refs.get(`${chunkIndex}|${quote}`);

  const modeLabel = (m: string) => MODES.find((x) => x.value === m)?.label ?? m;

  return (
    <>
      <PageHeader title="Ask" subtitle="Evidence-bound answers over the indexed documents. Every claim must quote a retrieved chunk verbatim or it is marked unsupported." />
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
            <FormButton pendingText="Retrieving and answering...">Ask</FormButton>
          </div>
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
          ) : loaded.answer.mode === "answer" ? (
            <div className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap break-words leading-6">{loaded.answer.answerText}</p>
              <div className="mt-3 border-t border-[var(--line)] pt-2">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Claims {json.unsupportedClaims ? <span className="text-[var(--bad)]">({json.unsupportedClaims} unsupported)</span> : null}</div>
                <ClaimList claims={claims} refFor={refFor} />
              </div>
            </div>
          ) : draft ? (
            <div className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
              <h3 className="text-base font-semibold">{draft.title}</h3>
              <DraftSection title="Key evidence" claims={draft.key_evidence} byText={byText} refFor={refFor} />
              <DraftSection title="Findings" claims={draft.findings} byText={byText} refFor={refFor} />
              <DraftSection title="Recommendations" claims={draft.recommendations} byText={byText} refFor={refFor} />
              <div className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Limitations</div>
                {draft.limitations.length === 0 ? <div className="text-xs text-[var(--muted)]">none stated</div> : null}
                <ul className="list-disc pl-5">
                  {draft.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
              <p className="whitespace-pre-wrap">{loaded.answer.answerText}</p>
              <ClaimList claims={claims} refFor={refFor} />
            </div>
          )}

          {refs.size > 0 ? (
            <div className="mt-2 rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-xs">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">Citations</div>
              <ol className="flex flex-col gap-0.5">
                {Array.from(refs.values()).map((r) => (
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
                const text = chunkText.get(r.chunkId);
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
  const title = `${r.valid ? "verified quote" : "quote not found in cited chunk"}: "${r.quote}"`;
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

function ClaimList({ claims, refFor }: { claims: ValidatedClaim[]; refFor: (chunkIndex: number, quote: string) => CiteRef | undefined }) {
  if (claims.length === 0) return <div className="text-xs text-[var(--muted)]">No claims were produced.</div>;
  return (
    <ol className="flex flex-col gap-1">
      {claims.map((c, i) => (
        <li key={i} className="leading-6 [&>*]:mr-1.5 [&>*]:align-baseline">
          <StatusBadge status={c.kind === "direct" ? "info" : "warn"} title={c.kind === "direct" ? "direct: quoted from one chunk" : "synthesis: combines several chunks"} />
          <span className={c.supported ? "" : "text-[var(--bad)]"}>{c.text}</span>
          {c.citations.map((ci) => (
            <CiteBadge key={`${ci.chunkIndex}|${ci.quote}`} r={refFor(ci.chunkIndex, ci.quote)} />
          ))}
          {!c.supported ? <span className="text-xs text-[var(--bad)]">unsupported</span> : null}
        </li>
      ))}
    </ol>
  );
}

function DraftSection({ title, claims, byText, refFor }: { title: string; claims: DraftSections["key_evidence"]; byText: Map<string, ValidatedClaim>; refFor: (chunkIndex: number, quote: string) => CiteRef | undefined }) {
  return (
    <div className="mt-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-[var(--muted)]">{title}</div>
      {claims.length === 0 ? <div className="text-xs text-[var(--muted)]">none</div> : null}
      <ul className="flex flex-col gap-1">
        {claims.map((c, i) => {
          const validated = byText.get(c.text.trim());
          const supported = validated ? validated.supported : c.citations.length > 0;
          return (
            <li key={i} className="leading-6 [&>*]:mr-1.5 [&>*]:align-baseline">
              <span className={supported ? "" : "text-[var(--bad)]"}>{c.text}</span>
              {c.citations.map((ci) => (
                <CiteBadge key={`${ci.chunkIndex}|${ci.quote}`} r={refFor(ci.chunkIndex, ci.quote)} />
              ))}
              {!supported ? <span className="text-xs text-[var(--bad)]">unsupported</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
