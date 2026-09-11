import { mutationAllowed } from "@/lib/access";
import Link from "next/link";
import { FileSearch, RefreshCcw, Search, ShieldCheck, Sparkles, Upload } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { getAnswer } from "@/lib/rag/answer";
import { listRecentQuestions, loadChunkTexts, loadVersionRefs, type VersionRef } from "@/lib/queries/ask";
import type { AnswerMode } from "@/lib/db/schema";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelHeader, PanelBody, PanelFooter, SectionTitle, Notice } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { fmtDate, fmtDuration, fmtNumber, fmtUsd } from "@/components/format";
import { askAction } from "./actions";
import { AskComposer, type ModeOption, type Suggestion } from "./AskComposer";
import { AnswerView, type AnswerPart, type CiteRef } from "./AnswerView";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MODES: ModeOption[] = [
  { value: "answer", label: "Answer", hint: "A direct answer with inline citations" },
  { value: "executive_brief", label: "Executive brief", hint: "Summary, findings, recommendations, limitations" },
  { value: "findings", label: "Findings", hint: "Findings with their supporting evidence" },
  { value: "recommendations", label: "Recommendations", hint: "Recommendations and the entity each targets" },
];

const SUGGESTIONS: Suggestion[] = [
  { text: "What is the revised program cost in the Northstar operational review?", mode: "answer" },
  { text: "Which reports mention Cardinal Fleet Services?", mode: "answer" },
  { text: "What did the corrected edition of the Northstar review change?", mode: "answer" },
  { text: "Brief the fuel card misuse investigation for a board member.", mode: "executive_brief" },
  { text: "List every high-severity finding across the audits.", mode: "findings" },
];

type Retrieved = { text?: string; chunkId: string; documentVersionId: string; logicalKey: string; versionNumber: number; similarity: number; lexical: number; combined: number; startLocator: string; endLocator: string };
type AnswerJson = { invalidCitations?: number; citations?: { raw: string; valid: boolean }[] };

const CITE_RE = /(\[[A-Z0-9][A-Z0-9-]*\s+v\d+\s+[^\]]+\])/g;

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
  const modeParam = one(sp.mode);
  const [stored, recent] = await Promise.all([answerId ? getAnswer(answerId) : Promise.resolve(null), listRecentQuestions(workspace.workspaceId, 12)]);
  const loaded = stored && stored.query.workspaceId === workspace.workspaceId ? stored : null;

  const retrieved = (loaded ? (loaded.answer.retrievedJson as Retrieved[]) : []) ?? [];
  const json = (loaded?.answer.answerJson ?? {}) as AnswerJson;
  const versionIds = [...retrieved.map((r) => r.documentVersionId), ...(loaded?.citations ?? []).map((c) => c.documentVersionId).filter((v): v is string => Boolean(v))];
  const [versions, chunkText] = await Promise.all([loadVersionRefs(workspace.workspaceId, versionIds), loadChunkTexts(retrieved.map((r) => r.chunkId))]);

  // Citations in display order, each resolved to a link into the source view.
  const refs: CiteRef[] = (loaded?.citations ?? []).map((row, i) => {
    const ref = row.documentVersionId ? versions.get(row.documentVersionId) : undefined;
    return {
      n: i + 1,
      valid: Boolean(ref),
      quote: row.quoteText ?? "",
      claim: row.supportedClaim,
      locator: row.sourceLocator,
      href: ref && row.sourceLocator ? `/documents/${ref.documentId}/versions/${ref.versionId}#${row.sourceLocator}` : null,
      label: ref ? `${ref.logicalKey} v${ref.versionNumber}` : "Source unavailable",
    };
  });
  // The model writes [KEY vN locator]; map each raw marker to its numbered reference.
  const rawToN = new Map<string, number>();
  (json.citations ?? []).filter((c) => c.valid).forEach((c, i) => rawToN.set(c.raw, i + 1));
  const parts: AnswerPart[] = loaded
    ? loaded.answer.answerText.split(CITE_RE).flatMap((piece): AnswerPart[] => {
        if (!piece) return [];
        const n = rawToN.get(piece);
        return n ? [{ kind: "cite" as const, value: piece, n }] : [{ kind: "text" as const, value: piece }];
      })
    : [];
  const plainText = loaded ? loaded.answer.answerText.replace(CITE_RE, (m) => (rawToN.get(m) ? ` [${rawToN.get(m)}]` : m)) : "";
  const citedChunks = new Set((loaded?.citations ?? []).map((c) => c.chunkId).filter(Boolean));

  const modeLabel = (m: string) => MODES.find((x) => x.value === m)?.label ?? m;
  const initialMode: AnswerMode = (loaded?.answer.mode ?? (MODES.some((m) => m.value === modeParam) ? (modeParam as AnswerMode) : "answer")) as AnswerMode;
  const supported = loaded?.answer.sufficientEvidence ?? false;

  return (
    <>
      <PageHeader
        section="ask"
        title="Ask & draft"
        subtitle="Answers are built only from retrieved source blocks. Every claim carries a citation that is re-checked against the source in code, and questions the corpus cannot answer are refused."
      />

      {error ? (
        <Notice tone="bad" className="mb-4">
          {error}
        </Notice>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          <AskComposer action={askAction} modes={MODES} suggestions={SUGGESTIONS} initialQuestion={loaded?.query.queryText ?? one(sp.q)} initialMode={initialMode} includeSuperseded={loaded?.query.includeSuperseded ?? false} canAsk={canAsk} />

          {answerId && !loaded ? <Notice tone="warn">That answer does not belong to this workspace.</Notice> : null}

          {!loaded ? (
            /* Before the first question: what makes an answer here trustworthy, in three beats. */
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { icon: Search, title: "Retrieve", body: "Hybrid search pulls the closest chunks: 75% vector similarity, 25% full-text rank. Current versions only unless you say otherwise." },
                { icon: Sparkles, title: "Draft from evidence", body: "The model may use only those chunks and must cite every claim as [KEY vN locator]." },
                { icon: ShieldCheck, title: "Check in code", body: "Each citation is re-checked against the retrieved text. No valid citation, no answer: the question is refused instead." },
              ].map((s, i) => (
                <div key={s.title} className={cn("rise rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)]", i === 1 && "rise-2", i === 2 && "rise-3")}>
                  <span className="mb-2.5 grid size-8 place-items-center rounded-[var(--r-md)] border border-[var(--sec-ask-border)] bg-[var(--sec-ask-soft)] text-[var(--sec-ask)]">
                    <s.icon size={15} aria-hidden strokeWidth={2.1} />
                  </span>
                  <div className="text-[13.5px] font-semibold">{s.title}</div>
                  <p className="mt-1 text-[12.5px] leading-5 text-[var(--muted)]">{s.body}</p>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* ------------------------------- Answer ------------------------------- */}
              <Panel className="rise">
                <PanelHeader
                  className={supported ? "border-l-[3px] border-l-[var(--sec-ask)]" : "border-l-[3px] border-l-[var(--bad)]"}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {modeLabel(loaded.answer.mode)}
                      <StatusBadge status={supported ? "supported" : "needs_source"} title={supported ? "Every claim is supported by a validated citation" : "Refused: insufficient evidence"} />
                      {supported && refs.length > 0 ? (
                        <span className="text-[12px] font-normal text-[var(--muted)]">
                          {refs.filter((r) => r.valid).length} of {refs.length} citations checked
                        </span>
                      ) : null}
                      {loaded.query.includeSuperseded ? <span className="text-[12px] font-normal text-[var(--muted)]">superseded versions included</span> : null}
                    </span>
                  }
                  description={<span className="line-clamp-2">“{loaded.query.queryText}”</span>}
                  actions={<TimeAgo value={loaded.answer.createdAt} prefix="asked" className="text-[12px]" />}
                />

                {!supported ? (
                  <PanelBody className="p-5">
                    <div className="flex gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--r-lg)] border border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]">
                        <FileSearch size={17} aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold">Refused: the documents cannot answer this</div>
                        <p className="mt-1 text-[13.5px] leading-6 text-[var(--muted)]">{loaded.answer.refusalReason ?? "The retrieved evidence could not support an answer, so nothing was invented."}</p>
                        {loaded.answer.answerText ? <p className="mt-2 font-mono text-[12px] text-[var(--faint)]">{loaded.answer.answerText}</p> : null}
                        <div className="mt-4 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-3 text-[12.5px] leading-5">
                          <div className="mb-1 font-semibold">What usually helps</div>
                          <ul className="list-disc space-y-0.5 pl-4 text-[var(--muted)]">
                            <li>Name the report or the entity the way the document does.</li>
                            <li>Tick “Include superseded versions” if the answer might be in an earlier edition.</li>
                            <li>
                              If the document is not in the workspace yet,{" "}
                              <Link href="/upload" className="text-[var(--accent)] underline-offset-2 hover:underline">
                                upload it
                              </Link>{" "}
                              and ask again.
                            </li>
                          </ul>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button asChild variant="secondary" size="xs">
                            <Link href={`/ask?q=${encodeURIComponent(loaded.query.queryText)}`}>
                              <RefreshCcw size={12} aria-hidden />
                              Rephrase and retry
                            </Link>
                          </Button>
                          <Button asChild variant="ghost" size="xs">
                            <Link href="/upload">
                              <Upload size={12} aria-hidden />
                              Upload a document
                            </Link>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </PanelBody>
                ) : (
                  <>
                    <AnswerView parts={parts} refs={refs} plainText={plainText} />
                    {json.invalidCitations ? <p className="border-t border-[var(--line)] px-5 py-2.5 text-[12.5px] text-[var(--bad)]">{json.invalidCitations} citation(s) could not be validated against the retrieved evidence and are struck through.</p> : null}
                  </>
                )}

                <PanelFooter>
                  <span>
                    model <Mono>{loaded.answer.model}</Mono>
                  </span>
                  <span>
                    prompt <Mono>{loaded.answer.promptVersion}</Mono>
                  </span>
                  <span>
                    {fmtNumber(loaded.answer.inputTokens)} in / {fmtNumber(loaded.answer.outputTokens)} out
                  </span>
                  <span>{fmtDuration(loaded.answer.latencyMs)}</span>
                  <span className="ml-auto">{fmtUsd(loaded.answer.estimatedCostUsd)}</span>
                </PanelFooter>
              </Panel>

              <div>
                <SectionTitle title="Retrieved evidence" count={retrieved.length} description="Hybrid retrieval: 75% vector similarity, 25% full-text rank, normalized across the candidate pool. Rows the answer cites are marked." />
                <Table minWidth={980}>
                  <THead>
                    <Th align="right" width={44}>
                      #
                    </Th>
                    <Th>Document</Th>
                    <Th width={100}>Version</Th>
                    <Th width={260}>Locators</Th>
                    <Th align="right" width={90}>
                      Vector
                    </Th>
                    <Th align="right" width={90}>
                      Lexical
                    </Th>
                    <Th align="right" width={100}>
                      Combined
                    </Th>
                    <Th width={110}>Chunk</Th>
                  </THead>
                  <tbody>
                    {retrieved.length === 0 ? <TableEmpty colSpan={8}>No chunks were retrieved for this question.</TableEmpty> : null}
                    {retrieved.map((r, i) => {
                      const ref: VersionRef | undefined = versions.get(r.documentVersionId);
                      const text = r.text ?? chunkText.get(r.chunkId);
                      const cited = citedChunks.has(r.chunkId);
                      return (
                        <Tr key={r.chunkId} className={cited ? "bg-[var(--sec-ask-soft)]/40" : undefined}>
                          <Td align="right" className="text-[var(--muted)]">
                            <span className={cn("inline-block border-l-2 pl-2", cited ? "border-[var(--sec-ask)]" : "border-transparent")}>{i + 1}</span>
                          </Td>
                          <Td className="max-w-[260px]">
                            {ref ? (
                              <Link href={`/documents/${ref.documentId}/versions/${ref.versionId}#${r.startLocator}`} className="block truncate text-[var(--fg)] transition-colors hover:text-[var(--sec-ask)]" title={ref.displayName}>
                                {ref.displayName}
                              </Link>
                            ) : (
                              <span className="text-[var(--faint)]">Not in this workspace</span>
                            )}
                            <span className="flex items-center gap-1.5">
                              <Mono className="text-[var(--muted)]">{r.logicalKey}</Mono>
                              {cited ? <span className="rounded-full border border-[var(--sec-ask-border)] bg-[var(--sec-ask-soft)] px-1.5 text-[10.5px] font-semibold text-[var(--sec-ask)]">Cited</span> : null}
                            </span>
                          </Td>
                          <Td>
                            <span className="flex items-center gap-1.5">
                              v{r.versionNumber}
                              {ref ? <StatusBadge status={ref.isCurrent ? "current" : "superseded"} size="sm" /> : null}
                            </span>
                          </Td>
                          <Td>
                            <Mono className="text-[var(--muted)]">
                              {r.startLocator}
                              {r.endLocator !== r.startLocator ? ` … ${r.endLocator}` : ""}
                            </Mono>
                          </Td>
                          <Td align="right">{Number(r.similarity).toFixed(3)}</Td>
                          <Td align="right" className={Number(r.lexical) === 0 ? "text-[var(--faint)]" : ""}>
                            {Number(r.lexical).toFixed(3)}
                          </Td>
                          <Td align="right" className="font-semibold">
                            {Number(r.combined).toFixed(3)}
                          </Td>
                          <Td>
                            {text === undefined ? (
                              <span className="text-[12px] text-[var(--faint)]">no longer indexed</span>
                            ) : (
                              <details>
                                <summary className="cursor-pointer text-[12px] text-[var(--sec-ask)]">{fmtNumber(text.length)} chars</summary>
                                <pre className="scroll-thin mt-1.5 max-h-[280px] w-[min(560px,60vw)] overflow-auto whitespace-pre-wrap break-words rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-2 font-mono text-[11.5px] leading-5">{text}</pre>
                              </details>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            </>
          )}
        </div>

        {/* ----------------------------- Recent rail ----------------------------- */}
        <Panel as="aside" className="xl:sticky xl:top-[112px]">
          <PanelHeader dense title="Recent questions" />
          {recent.length === 0 ? (
            <PanelBody className="text-[13px] text-[var(--muted)]">Nothing has been asked in this workspace yet. Your questions and their outcomes will collect here.</PanelBody>
          ) : (
            <ul className="scroll-thin max-h-[520px] divide-y divide-[var(--line)] overflow-y-auto">
              {recent.map((q) => (
                <li key={q.answerId}>
                  <Link
                    href={`/ask?answer=${q.answerId}`}
                    className={cn("block border-l-2 px-3.5 py-2.5 transition-colors hover:bg-[var(--surface-hover)]", q.answerId === answerId ? "border-[var(--sec-ask)] bg-[var(--sec-ask-soft)]/50" : "border-transparent")}
                    title={q.question}
                  >
                    <span className="line-clamp-2 text-[13px] leading-5 text-[var(--fg)]">{q.question}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--muted)]">
                      <span>{modeLabel(q.mode)}</span>
                      <StatusBadge status={q.sufficient ? "supported" : "needs_source"} size="sm" title={q.sufficient ? "Answered with validated citations" : "Refused: insufficient evidence"} />
                      <span title={fmtDate(q.createdAt, true)} className="ml-auto">
                        <TimeAgo value={q.createdAt} className="text-[11.5px]" />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
