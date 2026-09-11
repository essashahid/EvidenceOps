import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { mutationAllowed } from "@/lib/access";
import { requireWorkspace } from "@/lib/workspace";
import { getReviewItemDetail } from "@/lib/review/queries";
import { openQueueNeighbours } from "@/lib/queries/review";
import { enumValuesFor } from "@/lib/schema/report";
import { CONFIDENCE_WEIGHTS, ROUTING_THRESHOLDS } from "@/lib/config";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelHeader, PanelBody, SectionTitle, Notice } from "@/components/ui/panel";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { FieldValue } from "@/components/FieldValue";
import { KeyValueList } from "@/components/ui/kv";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono } from "@/components/ui/table";
import { TimeStamp } from "@/components/ui/time";
import { EmptyLine } from "@/components/ui/empty";
import { fmtValue, shortId } from "@/components/format";
import { ReviewForm } from "./ReviewForm";

export const dynamic = "force-dynamic";

const COMPONENTS: { key: keyof typeof CONFIDENCE_WEIGHTS; field: "evidenceExactMatch" | "deterministicValidation" | "verifierSupport" | "crossPassAgreement" | "evidenceSpecificity"; label: string; help: string }[] = [
  { key: "evidence_exact_match", field: "evidenceExactMatch", label: "Evidence exact match", help: "The cited quote occurs verbatim in the cited source block" },
  { key: "deterministic_validation", field: "deterministicValidation", label: "Deterministic validation", help: "Type, enum, date, amount and list checks in code" },
  { key: "verifier_support", field: "verifierSupport", label: "Verifier support", help: "An independent model's verdict on the value" },
  { key: "cross_pass_agreement", field: "crossPassAgreement", label: "Cross-pass agreement", help: "Extractor and verifier agree on the value" },
  { key: "evidence_specificity", field: "evidenceSpecificity", label: "Evidence specificity", help: "How directly the evidence states the value" },
];

/** The stored reason repeats the badges; show the verifier's own words where present. */
function explainReason(reason: string): string {
  const verifier = /\(verifier:\s*([^)]+)\)/i.exec(reason);
  if (verifier?.[1]) return verifier[1].trim().replace(/^./, (c) => c.toUpperCase());
  return reason.replace(/^(blocked|review|auto_approved):\s*/i, "").replace(/^./, (c) => c.toUpperCase());
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export default async function ReviewItemPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ flash?: string | string[] }> }) {
  const [{ itemId }, sp] = await Promise.all([params, searchParams]);
  const sessionContext = await requireWorkspace();
  const { workspace } = sessionContext;
  const detail = await getReviewItemDetail(workspace.workspaceId, itemId);
  if (!detail) notFound();
  const { item, field, version, document, record, evidence, context, extraction, currentRecord, actions } = detail;
  const documentTitle = detail.documentTitle || document.displayName;
  const queue = await openQueueNeighbours(workspace.workspaceId, itemId);
  const flash = Array.isArray(sp.flash) ? sp.flash[0] : sp.flash;
  const reviewer = mutationAllowed(sessionContext);
  const versionHref = `/documents/${document.id}/versions/${version.id}`;
  const locator = evidence?.sourceLocator ?? null;
  const confidence = Number(field.confidence);
  const isOpen = ["open", "needs_source"].includes(item.status);
  const leaf = item.fieldPath.replace(/^.*\./, "");
  const enumValues = enumValuesFor(item.fieldPath);
  const isListItem = /\[\d+\]$/.test(item.fieldPath);
  const valueKind: "text" | "number" | "enum" | "json" = isListItem ? "json" : enumValues ? "enum" : leaf === "amount" ? "number" : "text";
  const candidate = field.valueJson;
  const suggested = field.verifierCorrectedValueJson;
  const hasSuggestion = suggested !== null && suggested !== undefined;
  const resolution = actions.find((a) => a.action.resultingRecordVersionId) ?? actions[0] ?? null;
  const staleRecord = currentRecord && currentRecord.id !== record.id;
  const errors = field.validationMessages.filter((m) => m.level === "error");
  const warnings = field.validationMessages.filter((m) => m.level !== "error");

  return (
    <>
      <PageHeader section="review"
        breadcrumbs={[{ label: "Review queue", href: "/review" }, { label: detail.fieldLabel }]}
        title={
          <>
            {detail.fieldLabel}
            <StatusBadge status={item.status} />
            {item.priority === "high" ? <StatusBadge status="high" title="High priority: blocked or a required field" /> : null}
          </>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]">
            <Link href={versionHref} className="max-w-[380px] truncate font-medium text-[var(--fg)] transition-colors hover:text-[var(--accent)]" title={documentTitle}>
              {documentTitle}
            </Link>
            <span>
              <Mono>{document.logicalKey}</Mono> v{version.versionNumber}
            </span>
            <Mono className="text-[var(--muted)]">{item.fieldPath}</Mono>
            <TimeStamp value={item.createdAt} />
          </div>
        }
        actions={
          <div className="flex items-center gap-1.5">
            {queue.index >= 0 ? (
              <span className="tnum mr-1 text-[12.5px] text-[var(--muted)]">
                {queue.index + 1} of {queue.total} open
              </span>
            ) : null}
            <Button asChild variant="secondary" size="sm" className={queue.prevId ? "" : "pointer-events-none opacity-40"}>
              <Link href={queue.prevId ? `/review/${queue.prevId}` : "#"} aria-label="Previous open item">
                <ChevronLeft size={14} aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="sm" className={queue.nextId ? "" : "pointer-events-none opacity-40"}>
              <Link href={queue.nextId ? `/review/${queue.nextId}` : "#"} aria-label="Next open item">
                <ChevronRight size={14} aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link href="/review">Back to queue</Link>
            </Button>
          </div>
        }
      />

      {flash ? (
        <Notice tone="ok" className="mb-4">
          {flash}
        </Notice>
      ) : null}
      {!isOpen ? (
        <Notice tone="info" title={`This item is ${item.status.replaceAll("_", " ")}.`} className="mb-4">
          {resolution ? `${resolution.action.action.replaceAll("_", " ")} by ${resolution.reviewer?.displayName ?? resolution.reviewer?.email ?? "an unknown reviewer"}.` : null}{" "}
          {resolution?.action.resultingRecordVersionId ? (
            <Link href={`${versionHref}#history`} className="underline underline-offset-2">
              View the resulting record version
            </Link>
          ) : null}
        </Notice>
      ) : null}
      {isOpen && staleRecord ? (
        <Notice tone="warn" title="The record moved on since this item was created." className="mb-4">
          This item points at record v{record.versionNumber}; the current record is v{currentRecord.versionNumber}. Your decision applies to the current record.
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]">
        {/* ---------------- Source evidence ---------------- */}
        <div className="flex min-w-0 flex-col gap-4">
          <Panel>
            <PanelHeader
              title="Source evidence"
              actions={
                <Button asChild variant="secondary" size="xs">
                  <a href={locator ? `${versionHref}#${locator}` : `${versionHref}#source`}>
                    Open full document
                    <ExternalLink size={12} aria-hidden />
                  </a>
                </Button>
              }
            />
            <KeyValueList
              items={[
                {
                  label: "Version",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      v{version.versionNumber}
                      <StatusBadge status={version.isCurrent ? "current" : "superseded"} size="sm" />
                      <span className="text-[12px] text-[var(--muted)]">{version.sourceFilename}</span>
                    </span>
                  ),
                },
                {
                  label: "Locator",
                  value: locator ? <Mono>{locator}</Mono> : <span className="text-[var(--bad)]">No evidence was recorded for this field.</span>,
                },
                { label: "Source hash", value: <Mono title={version.contentHash}>sha256 {version.contentHash.slice(0, 16)}…</Mono> },
                ...(evidence
                  ? [
                      {
                        label: "Cited quote",
                        value: (
                          <span className="flex flex-col items-start gap-1.5">
                            <span className="italic leading-6">&ldquo;{evidence.quoteText}&rdquo;</span>
                            <Badge
                              tone={evidence.exactMatch ? "ok" : "warn"}
                              title={evidence.exactMatch ? "The quote occurs verbatim in the cited block" : "The quote could not be located verbatim in the cited block"}
                            >
                              {evidence.exactMatch ? "Found verbatim" : "Not found verbatim"}
                            </Badge>
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <div className="border-t border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]">Surrounding context</div>
            {context ? (
              <div className="scroll-thin max-h-[460px] overflow-y-auto px-4 py-3">
                <p className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-6 text-[var(--muted)]">
                  {context.before}
                  {context.match ? <mark className="font-sans text-[13px] text-[var(--fg)]">{context.match}</mark> : null}
                  {context.after}
                </p>
              </div>
            ) : (
              <PanelBody>
                <EmptyLine>No source block is linked to this evidence, so there is no context to show.</EmptyLine>
              </PanelBody>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Why this was routed here" />
            <PanelBody className="space-y-3">
              <p className="text-[13px] leading-6">{explainReason(item.reason)}</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={field.routingStatus} />
                <StatusBadge status={field.verifierStatus ?? "unverified"} title="Independent verifier verdict" />
                {field.contradiction ? <StatusBadge status="contradicted" /> : null}
                {field.isRequired ? <StatusBadge status="high" title="Required field" /> : null}
              </div>
              {errors.length + warnings.length > 0 ? (
                <ul className="space-y-1 text-[12.5px]">
                  {[...errors, ...warnings].map((m, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-1.5">
                      <StatusBadge status={m.level === "error" ? "error" : "warn"} size="sm" />
                      <Mono className="text-[var(--muted)]">{m.code}</Mono>
                      <span>{m.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-[var(--muted)]">Deterministic validation raised no messages for this field.</p>
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Confidence" description={`Auto-approve at ${ROUTING_THRESHOLDS.autoApprove}, review from ${ROUTING_THRESHOLDS.review}. Calculated in code, never by a model.`} />
            <PanelBody className="p-4 pb-2">
              <ConfidenceBar value={confidence} width={220} className="mb-3" />
            </PanelBody>
            <Table bare minWidth={420}>
              <THead>
                <Th>Component</Th>
                <Th align="right" width={80}>
                  Weight
                </Th>
                <Th align="right" width={80}>
                  Value
                </Th>
                <Th align="right" width={110}>
                  Contribution
                </Th>
              </THead>
              <tbody>
                {COMPONENTS.map((c) => {
                  const v = Number(field[c.field]);
                  return (
                    <Tr key={c.key}>
                      <Td title={c.help}>{c.label}</Td>
                      <Td align="right" className="text-[var(--muted)]">
                        {CONFIDENCE_WEIGHTS[c.key].toFixed(2)}
                      </Td>
                      <Td align="right" className={v === 0 ? "text-[var(--bad)]" : v < 1 ? "text-[var(--warn)]" : ""}>
                        {v.toFixed(2)}
                      </Td>
                      <Td align="right" className="font-medium">
                        {(v * CONFIDENCE_WEIGHTS[c.key]).toFixed(3)}
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-[var(--surface-sunken)] font-semibold">
                  <Td>Total</Td>
                  <Td align="right">1.00</Td>
                  <Td />
                  <Td align="right">{confidence.toFixed(3)}</Td>
                </Tr>
              </tbody>
            </Table>
          </Panel>
        </div>

        {/* ---------------- Decision ---------------- */}
        <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-[112px]">
          <Panel>
            <PanelHeader title="Candidate value" description={extraction ? `Extracted by ${extraction.extractorModel}` : undefined} />
            <PanelBody className="space-y-3">
              <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] px-3 py-2.5 text-[13.5px] leading-6">
                <FieldValue fieldPath={item.fieldPath} value={candidate} />
              </div>
              {hasSuggestion ? (
                <div className="rounded-[var(--r-md)] border border-[var(--warn-border)] bg-[var(--warn-soft)] px-3 py-2.5">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--warn)]">Verifier suggests</div>
                  <div className="text-[13.5px] leading-6">
                    <FieldValue fieldPath={item.fieldPath} value={suggested} />
                  </div>
                </div>
              ) : null}
              {typeof candidate === "object" && candidate !== null ? (
                <details className="text-[12px]">
                  <summary className="cursor-pointer text-[var(--muted)] transition-colors hover:text-[var(--accent)]">Raw stored value</summary>
                  <pre className="scroll-thin mt-1.5 max-h-56 overflow-auto rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--surface-sunken)] p-2.5 font-mono text-[12px] leading-5">{pretty(candidate)}</pre>
                </details>
              ) : null}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Decision" description={isOpen ? "Every decision creates a new immutable record version." : undefined} />
            <PanelBody>
              {!isOpen ? (
                <p className="text-[13px] text-[var(--muted)]">This item is {item.status.replaceAll("_", " ")}; no further action is available.</p>
              ) : !reviewer ? (
                <p className="text-[13px] text-[var(--muted)]">
                  Read-only access: the <StatusBadge status={workspace.role} size="sm" /> role cannot resolve review items.
                </p>
              ) : (
                <ReviewForm
                  reviewItemId={item.id}
                  fieldPath={item.fieldPath}
                  expectedRecordVersionId={currentRecord?.id ?? null}
                  initialValue={candidate === null || candidate === undefined ? "" : typeof candidate === "string" ? candidate : pretty(candidate)}
                  valueKind={valueKind}
                  enumValues={enumValues}
                  suggestedValue={hasSuggestion ? (typeof suggested === "string" ? suggested : pretty(suggested)) : null}
                />
              )}
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader dense title="Provenance" />
            <KeyValueList
              labelWidth={112}
              items={[
                { label: "Extractor", value: extraction ? <span className="flex flex-wrap items-center gap-1.5"><Mono>{extraction.extractorModel}</Mono><Mono className="text-[var(--muted)]">{extraction.extractorPromptVersion}</Mono></span> : <span className="text-[var(--muted)]">Not linked</span> },
                { label: "Verifier", value: extraction ? <span className="flex flex-wrap items-center gap-1.5"><Mono>{extraction.verifierModel}</Mono><Mono className="text-[var(--muted)]">{extraction.verifierPromptVersion}</Mono></span> : <span className="text-[var(--muted)]">Not linked</span> },
                { label: "Model config", value: extraction ? <Mono title={extraction.modelConfigHash}>{shortId(extraction.modelConfigHash)}</Mono> : "—" },
                { label: "Record version", value: <span>v{record.versionNumber}{currentRecord ? <span className="text-[var(--muted)]"> (current v{currentRecord.versionNumber})</span> : null}</span> },
                { label: "Item id", value: <Mono title={item.id}>{shortId(item.id)}</Mono> },
              ]}
            />
          </Panel>
        </div>
      </div>

      <SectionTitle title="Action history" count={actions.length} className="mt-6" />
      {actions.length === 0 ? (
        <EmptyLine>No reviewer has acted on this item yet. Accepting, editing or rejecting it will be recorded here with the old and new values.</EmptyLine>
      ) : (
        <Table minWidth={880}>
          <THead>
            <Th width={160}>When</Th>
            <Th width={130}>Action</Th>
            <Th width={160}>Reviewer</Th>
            <Th>Old value</Th>
            <Th>New value</Th>
            <Th>Comment</Th>
            <Th width={120}>Record</Th>
          </THead>
          <tbody>
            {actions.map(({ action: a, reviewer: r }) => (
              <Tr key={a.id}>
                <Td>
                  <TimeStamp value={a.createdAt} withSeconds />
                </Td>
                <Td>
                  <StatusBadge status={a.action === "edit_accept" ? "accepted" : a.action === "accept" ? "accepted" : a.action} size="sm" title={a.action} />
                </Td>
                <Td className="truncate">{r?.displayName ?? r?.email ?? shortId(a.reviewerUserId)}</Td>
                <Td className="max-w-[220px] break-words text-[12.5px] text-[var(--muted)]">{fmtValue(a.oldValueJson) || <span className="text-[var(--faint)]">null</span>}</Td>
                <Td className="max-w-[220px] break-words text-[12.5px]">{fmtValue(a.newValueJson) || <span className="text-[var(--faint)]">null</span>}</Td>
                <Td className="max-w-[240px] break-words text-[12.5px] text-[var(--muted)]">{a.comment ?? <span className="text-[var(--faint)]">—</span>}</Td>
                <Td>
                  {a.resultingRecordVersionId ? (
                    <Link href={`${versionHref}#history`} className="text-[var(--accent)] transition-colors hover:underline">
                      <Mono title={a.resultingRecordVersionId}>{shortId(a.resultingRecordVersionId)}</Mono>
                    </Link>
                  ) : (
                    <span className="text-[var(--faint)]">—</span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
