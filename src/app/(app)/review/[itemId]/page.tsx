import Link from "next/link";
import { notFound } from "next/navigation";
import { mutationAllowed } from "@/lib/access";
import { requireWorkspace } from "@/lib/workspace";
import { getReviewItemDetail } from "@/lib/review/queries";
import { enumValuesFor } from "@/lib/schema/report";
import { CONFIDENCE_WEIGHTS } from "@/lib/config";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfidenceBar } from "@/components/ConfidenceBar";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate, fmtValue, shortId } from "@/components/format";
import { ReviewForm } from "./ReviewForm";

export const dynamic = "force-dynamic";

const COMPONENTS: { key: keyof typeof CONFIDENCE_WEIGHTS; field: "evidenceExactMatch" | "deterministicValidation" | "verifierSupport" | "crossPassAgreement" | "evidenceSpecificity"; label: string }[] = [
  { key: "evidence_exact_match", field: "evidenceExactMatch", label: "Evidence exact match" },
  { key: "deterministic_validation", field: "deterministicValidation", label: "Deterministic validation" },
  { key: "verifier_support", field: "verifierSupport", label: "Verifier support" },
  { key: "cross_pass_agreement", field: "crossPassAgreement", label: "Cross-pass agreement" },
  { key: "evidence_specificity", field: "evidenceSpecificity", label: "Evidence specificity" },
];

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded border border-[var(--line)] bg-[var(--card)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-[11px] uppercase tracking-wide text-[var(--muted)]">
        <span>{title}</span>
        {actions}
      </div>
      <div className="px-3 py-2 text-sm">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 border-b border-[var(--line)] py-1.5 last:border-b-0">
      <div className="text-xs text-[var(--muted)]">{label}</div>
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

export default async function ReviewItemPage({ params, searchParams }: { params: Promise<{ itemId: string }>; searchParams: Promise<{ flash?: string | string[] }> }) {
  const [{ itemId }, sp] = await Promise.all([params, searchParams]);
  const sessionContext = await requireWorkspace();
  const { workspace } = sessionContext;
  const detail = await getReviewItemDetail(workspace.workspaceId, itemId);
  if (!detail) notFound();
  const { item, field, version, document, record, evidence, context, extraction, currentRecord, actions } = detail;
  const flash = Array.isArray(sp.flash) ? sp.flash[0] : sp.flash;
  const reviewer = mutationAllowed(sessionContext);
  const versionHref = `/documents/${document.id}/versions/${version.id}`;
  const locator = evidence?.sourceLocator ?? null;
  const confidence = Number(field.confidence);
  const isOpen = ["open", "needs_source"].includes(item.status);
  const leaf = item.fieldPath.replace(/^.*\./, "");
  const enumValues = enumValuesFor(item.fieldPath);
  const valueKind: "text" | "number" | "enum" = enumValues ? "enum" : leaf === "amount" ? "number" : "text";
  const candidate = field.valueJson;
  const suggested = field.verifierCorrectedValueJson;
  const hasSuggestion = suggested !== null && suggested !== undefined;
  const resolution = actions.find((a) => a.action.resultingRecordVersionId) ?? actions[0] ?? null;
  const staleRecord = currentRecord && currentRecord.id !== record.id;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Review: {detail.fieldLabel} <StatusBadge status={item.status} />
            {item.priority === "high" ? <StatusBadge status="blocked" title="high priority" /> : null}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={versionHref} className="text-[var(--accent)] underline">
              {document.displayName}
            </Link>
            <Mono>{document.logicalKey}</Mono>
            <span>v{version.versionNumber}</span>
            <span>created {fmtDate(item.createdAt, true)}</span>
            <Mono title={item.id}>item {shortId(item.id)}</Mono>
          </span>
        }
        actions={
          <Link href="/review" className="text-sm text-[var(--accent)] underline">
            Back to queue
          </Link>
        }
      />
      {flash ? <div className="mb-3 rounded border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_8%,white)] px-3 py-1.5 text-sm text-[var(--ok)]">{flash}</div> : null}
      {!isOpen ? (
        <div className="mb-3 rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2 text-sm">
          <span className="font-medium">This item is {item.status}</span>
          {item.resolvedAt ? <span className="text-[var(--muted)]"> on {fmtDate(item.resolvedAt, true)}</span> : null}
          {resolution ? (
            <span className="text-[var(--muted)]">
              {" "}
              by {resolution.reviewer?.displayName ?? resolution.reviewer?.email ?? "unknown"} ({resolution.action.action})
            </span>
          ) : null}
          {resolution?.action.resultingRecordVersionId ? (
            <span>
              {" "}
              <Link href={`${versionHref}#history`} className="text-[var(--accent)] underline">
                resulting record version <Mono>{shortId(resolution.action.resultingRecordVersionId)}</Mono>
              </Link>
            </span>
          ) : null}
        </div>
      ) : null}
      {isOpen && staleRecord ? (
        <div className="mb-3 rounded border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_8%,white)] px-3 py-1.5 text-sm text-[var(--warn)]">
          The record has moved on since this item was created (item record v{record.versionNumber}, current v{currentRecord.versionNumber}). Actions apply to the current record.
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel
          title="Source"
          actions={
            locator ? (
              <a href={`${versionHref}#${locator}`} className="normal-case tracking-normal text-[var(--accent)] underline">
                Open full document
              </a>
            ) : (
              <Link href={`${versionHref}#source`} className="normal-case tracking-normal text-[var(--accent)] underline">
                Open full document
              </Link>
            )
          }
        >
          <Row label="Document">
            <Link href={versionHref} className="text-[var(--accent)] underline">
              {document.displayName}
            </Link>
            <div className="text-xs text-[var(--muted)]">
              <Mono>{document.logicalKey}</Mono> {version.sourceFilename}
            </div>
          </Row>
          <Row label="Version">
            v{version.versionNumber} {version.isCurrent ? <StatusBadge status="accepted" title="current version" /> : <span className="text-xs text-[var(--muted)]">superseded</span>}
          </Row>
          <Row label="Locator">{locator ? <Mono>{locator}</Mono> : <span className="text-[var(--bad)]">no evidence recorded for this field</span>}</Row>
          <Row label="Source hash">
            <Mono title={version.contentHash}>sha256 {version.contentHash.slice(0, 12)}</Mono>
          </Row>
          {evidence ? (
            <Row label="Quote">
              <span className="italic">&ldquo;{evidence.quoteText}&rdquo;</span>{" "}
              <span className={`text-xs ${evidence.exactMatch ? "text-[var(--ok)]" : "text-[var(--warn)]"}`}>{evidence.exactMatch ? "exact match" : "not found verbatim"}</span>
            </Row>
          ) : null}
          <div className="mt-2 text-[11px] uppercase tracking-wide text-[var(--muted)]">Context</div>
          {context ? (
            <pre className="mt-1 max-h-[420px] overflow-y-auto whitespace-pre-wrap break-words rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-1.5 font-mono text-xs leading-5">
              {context.before}
              {context.match ? <mark className="rounded bg-[color-mix(in_srgb,var(--warn)_35%,white)] px-0.5">{context.match}</mark> : null}
              {context.after}
            </pre>
          ) : (
            <div className="mt-1 text-xs text-[var(--muted)]">No source block is linked to this evidence.</div>
          )}
        </Panel>

        <Panel title="Candidate">
          <Row label="Field">
            {detail.fieldLabel}
            <div>
              <Mono className="text-[var(--muted)]">{item.fieldPath}</Mono>
              {field.isRequired ? <span className="ml-1 text-xs text-[var(--bad)]">required</span> : null}
            </div>
          </Row>
          <Row label="Candidate value">
            {candidate === null || candidate === undefined ? (
              <span className="text-[var(--muted)]">null</span>
            ) : typeof candidate === "string" ? (
              <span className="break-words">{candidate}</span>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">{pretty(candidate)}</pre>
            )}
          </Row>
          <Row label="Confidence">
            <ConfidenceBar value={confidence} width={160} />
            <table className="mt-1 w-full text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
                <tr>
                  <th className="py-0.5 text-left font-medium">Component</th>
                  <th className="py-0.5 text-right font-medium">Weight</th>
                  <th className="py-0.5 text-right font-medium">Value</th>
                  <th className="py-0.5 text-right font-medium">Contribution</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {COMPONENTS.map((c) => {
                  const v = Number(field[c.field]);
                  return (
                    <tr key={c.key} className="border-t border-[var(--line)]">
                      <td className="py-0.5 font-sans">{c.label}</td>
                      <td className="py-0.5 text-right">{CONFIDENCE_WEIGHTS[c.key].toFixed(2)}</td>
                      <td className="py-0.5 text-right">{v.toFixed(2)}</td>
                      <td className="py-0.5 text-right">{(v * CONFIDENCE_WEIGHTS[c.key]).toFixed(3)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t border-[var(--line)] font-semibold">
                  <td className="py-0.5 font-sans">Total</td>
                  <td className="py-0.5 text-right">1.00</td>
                  <td></td>
                  <td className="py-0.5 text-right">{confidence.toFixed(3)}</td>
                </tr>
              </tbody>
            </table>
          </Row>
          <Row label="Routing">
            <span className="flex flex-wrap items-center gap-1">
              <StatusBadge status={field.routingStatus} />
              {field.contradiction ? <StatusBadge status="contradicted" /> : null}
            </span>
          </Row>
          <Row label="Verifier">
            <span className="flex flex-wrap items-center gap-1">
              <StatusBadge status={field.verifierStatus ?? "unverified"} />
            </span>
            <div className="mt-0.5 text-xs">{item.reason}</div>
          </Row>
          <Row label="Models">
            {extraction ? (
              <div className="text-xs">
                <div>
                  extractor <Mono>{extraction.extractorModel}</Mono> <Mono className="text-[var(--muted)]">{extraction.extractorPromptVersion}</Mono>
                </div>
                <div>
                  verifier <Mono>{extraction.verifierModel}</Mono> <Mono className="text-[var(--muted)]">{extraction.verifierPromptVersion}</Mono>
                </div>
                <div>
                  config <Mono title={extraction.modelConfigHash}>{shortId(extraction.modelConfigHash)}</Mono> record v{record.versionNumber}
                </div>
              </div>
            ) : (
              <span className="text-xs text-[var(--muted)]">no extraction run linked</span>
            )}
          </Row>
          <Row label="Validation">
            {field.validationMessages.length === 0 ? (
              <span className="text-xs text-[var(--muted)]">no validation messages</span>
            ) : (
              <ul className="text-xs">
                {field.validationMessages.map((m, i) => (
                  <li key={i} className={m.level === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"}>
                    <Mono>{m.code}</Mono> {m.message}
                  </li>
                ))}
              </ul>
            )}
          </Row>
          {hasSuggestion ? (
            <Row label="Verifier corrected">
              <span className="text-[var(--warn)]">{typeof suggested === "string" ? suggested : pretty(suggested)}</span>
            </Row>
          ) : null}

          <div className="mt-3 border-t border-[var(--line)] pt-3">
            {!isOpen ? (
              <div className="text-xs text-[var(--muted)]">No actions are available: this item is {item.status}.</div>
            ) : !reviewer ? (
              <div className="text-xs text-[var(--muted)]">Read-only: your role ({workspace.role}) cannot resolve review items. Ask a reviewer or admin.</div>
            ) : (
              <ReviewForm
                reviewItemId={item.id}
                fieldPath={item.fieldPath}
                expectedRecordVersionId={currentRecord?.id ?? null}
                initialValue={candidate === null || candidate === undefined ? "" : typeof candidate === "string" ? candidate : fmtValue(candidate)}
                valueKind={valueKind}
                enumValues={enumValues}
                suggestedValue={hasSuggestion ? (typeof suggested === "string" ? suggested : fmtValue(suggested)) : null}
              />
            )}
          </div>
        </Panel>
      </div>

      <SectionHeader title="Action history" count={actions.length} />
      <Table>
        <THead>
          <Th>When</Th>
          <Th>Action</Th>
          <Th>Reviewer</Th>
          <Th>Old value</Th>
          <Th>New value</Th>
          <Th>Comment</Th>
          <Th>Resulting record</Th>
        </THead>
        <tbody>
          {actions.length === 0 ? <TableEmpty colSpan={7}>No actions yet.</TableEmpty> : null}
          {actions.map(({ action: a, reviewer: r }) => (
            <Tr key={a.id}>
              <Td>
                <Mono>{fmtDate(a.createdAt, true)}</Mono>
              </Td>
              <Td>
                <StatusBadge status={a.action} />
              </Td>
              <Td>{r?.displayName ?? r?.email ?? shortId(a.reviewerUserId)}</Td>
              <Td className="max-w-[240px] break-words text-xs">{fmtValue(a.oldValueJson) || <span className="text-[var(--muted)]">null</span>}</Td>
              <Td className="max-w-[240px] break-words text-xs">{fmtValue(a.newValueJson) || <span className="text-[var(--muted)]">null</span>}</Td>
              <Td className="max-w-[280px] break-words text-xs">{a.comment ?? ""}</Td>
              <Td>
                {a.resultingRecordVersionId ? (
                  <Link href={`${versionHref}#history`} className="text-[var(--accent)] underline">
                    <Mono title={a.resultingRecordVersionId}>{shortId(a.resultingRecordVersionId)}</Mono>
                  </Link>
                ) : (
                  ""
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
