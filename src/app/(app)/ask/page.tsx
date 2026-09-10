import { mutationAllowed } from "@/lib/access";
import Link from "next/link";
import { Quote, Sparkles } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { getAnswer } from "@/lib/rag/answer";
import { listRecentQuestions, loadChunkTexts, loadVersionRefs, type VersionRef } from "@/lib/queries/ask";
import type { AnswerMode } from "@/lib/db/schema";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelHeader, PanelBody, PanelFooter, SectionTitle, Notice } from "@/components/ui/panel";
import { StatusBadge } from "@/components/ui/badge";
import { FormButton } from "@/components/FormButton";
import { Field, Textarea, CheckboxField } from "@/components/ui/field";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { fmtDate, fmtDuration, fmtNumber, fmtUsd } from "@/components/format";
import { askAction } from "./actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MODES: { value: AnswerMode; label: string; hint: string }[] = [
  { value: "answer", label: "Answer", hint: "A direct answer with inline citations" },
  { value: "executive_brief", label: "Executive brief", hint: "Summary, findings, recommendations, limitations" },
  { value: "findings", label: "Findings", hint: "Findings with their supporting evidence" },
  { value: "recommendations", label: "Recommendations", hint: "Recommendations and the entity each targets" },
];

const EXAMPLES = [
  "What is the revised program cost in the Northstar operational review?",
  "Which reports mention Cardinal Fleet Services?",
  "What did the corrected edition change?",
];

type Retrieved = { text?: string; chunkId: string; documentVersionId: string; logicalKey: string; versionNumber: number; similarity: number; lexical: number; combined: number; startLocator: string; endLocator: string };
type AnswerJson = { invalidCitations?: number; citations?: { raw: string; valid: boolean }[] };
type CiteRef = { n: number; valid: boolean; quote: string; href: string | null; locator: string | null; label: string };

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
  const [stored, recent] = await Promise.all([answerId ? getAnswer(answerId) : Promise.resolve(null), listRecentQuestions(workspace.workspaceId, 12)]);
  const loaded = stored && stored.query.workspaceId === workspace.workspaceId ? stored : null;

  const retrieved = (loaded ? (loaded.answer.retrievedJson as Retrieved[]) : []) ?? [];
  const json = (loaded?.answer.answerJson ?? {}) as AnswerJson;
  const versionIds = [...retrieved.map((r) => r.documentVersionId), ...(loaded?.citations ?? []).map((c) => c.documentVersionId).filter((v): v is string => Boolean(v))];
  const [versions, chunkText] = await Promise.all([loadVersionRefs(workspace.workspaceId, versionIds), loadChunkTexts(retrieved.map((r) => r.chunkId))]);

  const refs: CiteRef[] = (loaded?.citations ?? []).map((row, i) => {
    const ref = row.documentVersionId ? versions.get(row.documentVersionId) : undefined;
    return {
      n: i + 1,
      valid: Boolean(ref),
      quote: row.quoteText ?? "",
      locator: row.sourceLocator,
      href: ref && row.sourceLocator ? `/documents/${ref.documentId}/versions/${ref.versionId}#${row.sourceLocator}` : null,
      label: ref ? `${ref.logicalKey} v${ref.versionNumber}` : "Source unavailable",
    };
  });
  const citationLinks = new Map((loaded?.citations ?? []).map((row, i) => [json.citations?.filter((c) => c.valid)[i]?.raw ?? row.quoteText, refs[i]!]));
  const modeLabel = (m: string) => MODES.find((x) => x.value === m)?.label ?? m;
  const currentMode = loaded?.answer.mode ?? "answer";

  return (
    <>
      <PageHeader
        title="Ask & draft"
        subtitle="Answers built only from retrieved source blocks. Every claim carries a citation that is re-checked against the source in code, and questions the corpus cannot answer are refused."
      />

      {error ? (
        <Notice tone="bad" className="mb-4">
          {error}
        </Notice>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {/* ------------------------------ Composer ------------------------------ */}
          <Panel as="div">
            <form action={askAction}>
              <PanelBody className="space-y-3">
                <Field label="Question or drafting request" htmlFor="ask-question">
                  <Textarea
                    id="ask-question"
                    name="question"
                    rows={3}
                    required
                    maxLength={2000}
                    defaultValue={loaded?.query.queryText ?? one(sp.q)}
                    placeholder="What is the revised program cost in the Northstar operational review?"
                    className="text-[14px]"
                  />
                </Field>

                <fieldset>
                  <legend className="mb-1.5 text-[12px] font-medium text-[var(--muted)]">Mode</legend>
                  <div className="inline-flex flex-wrap gap-1 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-1">
                    {MODES.map((m) => (
                      <label
                        key={m.value}
                        title={m.hint}
                        className="cursor-pointer rounded-[var(--r-sm)] px-2.5 py-1 text-[13px] font-medium text-[var(--muted)] transition-colors hover:text-[var(--fg)] has-[:checked]:bg-[var(--surface)] has-[:checked]:text-[var(--accent)] has-[:checked]:shadow-[var(--shadow-sm)]"
                      >
                        <input type="radio" name="mode" value={m.value} defaultChecked={currentMode === m.value} className="sr-only" />
                        {m.label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </PanelBody>
              <PanelFooter className="justify-between">
                <CheckboxField name="includeSuperseded" defaultChecked={loaded?.query.includeSuperseded ?? false} label="Include superseded versions" title="By default only current document versions are retrieved" />
                <span className="ml-auto flex items-center gap-3">
                  {!canAsk ? <span className="text-[12px]">Sign in to run a new request.</span> : null}
                  <FormButton disabled={!canAsk} pendingText="Retrieving and answering…">
                    <Sparkles size={14} aria-hidden />
                    Ask
                  </FormButton>
                </span>
              </PanelFooter>
            </form>
          </Panel>

          {answerId && !loaded ? <Notice tone="warn">That answer does not belong to this workspace.</Notice> : null}

          {/* ------------------------------- Answer ------------------------------- */}
          {!loaded ? (
            <Panel>
              <PanelHeader title="How answering works" />
              <PanelBody className="space-y-3 text-[13px] leading-6 text-[var(--muted)]">
                <ol className="space-y-2">
                  {[
                    "Hybrid retrieval pulls the closest chunks: 75% vector similarity, 25% full-text rank, current versions only unless you include superseded ones.",
                    "The model may use only those chunks, and must cite each claim as [KEY vN locator].",
                    "Every citation is re-checked in code against the retrieved text. An answer with no valid citation is downgraded to a refusal.",
                  ].map((step, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent)]">{i + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
                {canAsk ? (
                  <div className="border-t border-[var(--line)] pt-3">
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">Try asking</div>
                    <ul className="flex flex-col items-start gap-1.5">
                      {EXAMPLES.map((q) => (
                        <li key={q}>
                          <Link
                            href={`/rag?q=${encodeURIComponent(q)}`}
                            className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[var(--fg)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)]"
                          >
                            {q}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </PanelBody>
            </Panel>
          ) : (
            <>
              <Panel>
                <PanelHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {modeLabel(loaded.answer.mode)}
                      <StatusBadge status={loaded.answer.sufficientEvidence ? "supported" : "needs_source"} title={loaded.answer.sufficientEvidence ? "Every claim is supported by a validated citation" : "Refused: insufficient evidence"} />
                      {loaded.query.includeSuperseded ? <span className="text-[12px] font-normal text-[var(--muted)]">superseded versions included</span> : null}
                    </span>
                  }
                  actions={<TimeAgo value={loaded.answer.createdAt} prefix="asked" className="text-[12px]" />}
                />

                {!loaded.answer.sufficientEvidence ? (
                  <PanelBody>
                    <div className="rounded-[var(--r-md)] border border-[var(--bad-border)] bg-[var(--bad-soft)] px-3.5 py-3">
                      <div className="text-[13px] font-semibold text-[var(--bad)]">Refused: insufficient evidence</div>
                      <p className="mt-1 text-[13px] leading-6">{loaded.answer.refusalReason ?? "The retrieved evidence could not support an answer."}</p>
                      <p className="mt-2 font-mono text-[12px] text-[var(--muted)]">{loaded.answer.answerText}</p>
                    </div>
                  </PanelBody>
                ) : (
                  <PanelBody className="p-5">
                    <div className="whitespace-pre-wrap break-words text-[14px] leading-7">
                      {loaded.answer.answerText.split(/(\[[A-Z0-9][A-Z0-9-]*\s+v\d+\s+[^\]]+\])/g).map((part, i) => {
                        const ref = citationLinks.get(part);
                        return ref?.href ? (
                          <Link
                            key={i}
                            href={ref.href}
                            title={`Open the cited source: “${ref.quote}”`}
                            className="mx-0.5 inline-flex rounded-[var(--r-sm)] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-1 align-baseline font-mono text-[11.5px] text-[var(--accent)] transition-colors hover:bg-[var(--accent)] hover:text-white"
                          >
                            {part}
                          </Link>
                        ) : (
                          <span key={i}>{part}</span>
                        );
                      })}
                    </div>
                    {json.invalidCitations ? <p className="mt-3 text-[13px] text-[var(--bad)]">{json.invalidCitations} citation(s) could not be validated against the retrieved evidence.</p> : null}
                  </PanelBody>
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

              {refs.length > 0 ? (
                <Panel>
                  <PanelHeader dense title={`Citations (${refs.length})`} />
                  <ol className="divide-y divide-[var(--line)]">
                    {refs.map((r) => (
                      <li key={r.n} className="flex gap-3 px-4 py-2.5 text-[13px]">
                        <CiteBadge r={r} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium">{r.label}</span>
                            {r.locator ? <Mono className="text-[var(--muted)]">{r.locator}</Mono> : null}
                          </div>
                          <p className="mt-0.5 flex gap-1.5 text-[var(--muted)]">
                            <Quote size={12} aria-hidden className="mt-1 shrink-0 text-[var(--faint)]" />
                            <span className="italic">{r.quote}</span>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Panel>
              ) : null}

              <div>
                <SectionTitle title="Retrieved evidence" count={retrieved.length} description="Hybrid retrieval: 75% vector similarity, 25% full-text rank, normalized across the candidate pool." />
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
                      return (
                        <Tr key={r.chunkId}>
                          <Td align="right" className="text-[var(--muted)]">
                            {i + 1}
                          </Td>
                          <Td className="max-w-[260px]">
                            {ref ? (
                              <Link href={`/documents/${ref.documentId}/versions/${ref.versionId}#${r.startLocator}`} className="block truncate text-[var(--fg)] transition-colors hover:text-[var(--accent)]" title={ref.displayName}>
                                {ref.displayName}
                              </Link>
                            ) : (
                              <span className="text-[var(--faint)]">Not in this workspace</span>
                            )}
                            <Mono className="text-[var(--muted)]">{r.logicalKey}</Mono>
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
                                <summary className="cursor-pointer text-[12px] text-[var(--accent)]">{fmtNumber(text.length)} chars</summary>
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
            <PanelBody className="text-[13px] text-[var(--muted)]">Nothing has been asked in this workspace yet.</PanelBody>
          ) : (
            <ul className="scroll-thin max-h-[520px] divide-y divide-[var(--line)] overflow-y-auto">
              {recent.map((q) => (
                <li key={q.answerId}>
                  <Link
                    href={`/ask?answer=${q.answerId}`}
                    className={cn("block px-3.5 py-2.5 transition-colors hover:bg-[var(--surface-hover)]", q.answerId === answerId && "bg-[var(--accent-soft)]")}
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

function CiteBadge({ r }: { r: CiteRef | undefined }) {
  if (!r) return null;
  const cls = r.valid ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)] line-through";
  const title = `${r.valid ? "Validated citation" : "Source not found"}: “${r.quote}”`;
  const inner = `[${r.n}]`;
  if (r.href && r.valid) {
    return (
      <Link href={r.href} title={title} className={cn("h-fit shrink-0 rounded-[var(--r-sm)] border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:brightness-97", cls)}>
        {inner}
      </Link>
    );
  }
  return (
    <span title={title} className={cn("h-fit shrink-0 rounded-[var(--r-sm)] border px-1.5 py-0.5 font-mono text-[11px]", cls)}>
      {inner}
    </span>
  );
}
