import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Layers } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { getCurrentRecord, getDocument, listVersionsForDocument } from "@/lib/queries/documents";
import { PageHeader } from "@/components/PageHeader";
import { Panel, PanelHeader, SectionTitle } from "@/components/ui/panel";
import { MetricStrip } from "@/components/ui/metric";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty, rowLink } from "@/components/ui/table";
import { TimeAgo } from "@/components/ui/time";
import { KeyValueList } from "@/components/ui/kv";
import { fmtBytes, fmtDate, plural, shortId } from "@/components/format";
import type { ReportRecord } from "@/lib/schema/report";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const { workspace } = await requireWorkspace();
  const doc = await getDocument(workspace.workspaceId, documentId);
  if (!doc) notFound();
  const versions = await listVersionsForDocument(workspace.workspaceId, doc.id);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const currentVersion = versions.find((v) => v.isCurrent) ?? versions[0];
  const currentRecord = currentVersion ? await getCurrentRecord(currentVersion.id) : null;
  const payload = (currentRecord?.record.payloadJson ?? null) as ReportRecord | null;
  const title = payload?.report_title || doc.displayName;
  const currentHref = currentVersion ? `/documents/${doc.id}/versions/${currentVersion.id}` : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Documents", href: "/documents" }, { label: doc.logicalKey }]}
        title={title}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]">
            <span>
              Logical key <Mono className="text-[var(--fg)]">{doc.logicalKey}</Mono>
            </span>
            <span>{plural(versions.length, "source version")}</span>
            <span title={fmtDate(doc.createdAt, true)}>Added {fmtDate(doc.createdAt)}</span>
          </div>
        }
        actions={
          currentHref ? (
            <Button asChild size="sm">
              <Link href={currentHref}>
                Open current version
                <ArrowRight size={14} aria-hidden />
              </Link>
            </Button>
          ) : null
        }
      />

      {currentVersion ? (
        <Panel className="mb-5">
          <MetricStrip
            items={[
              { label: "Current version", value: `v${currentVersion.versionNumber}` },
              { label: "Processing", value: <StatusBadge status={currentVersion.processingStatus} /> },
              { label: "Classification", value: <span className="text-[14px] capitalize">{payload?.document_type ? payload.document_type.replaceAll("_", " ") : "—"}</span> },
              { label: "Published", value: <span className="text-[15px]">{payload?.publication_date ?? "Not stated"}</span> },
              { label: "Format", value: currentVersion.mimeType.includes("pdf") ? "PDF" : "DOCX" },
              { label: "Pages", value: currentVersion.pageCount ?? "—" },
            ]}
          />
        </Panel>
      ) : null}

      {payload ? (
        <div className="mb-5 grid min-w-0 gap-4 lg:grid-cols-2">
          <Panel>
            <PanelHeader title="Extracted summary" description="From the current record version." actions={currentHref ? <Button asChild variant="secondary" size="xs"><Link href={`${currentHref}#record`}>Full record</Link></Button> : null} />
            <KeyValueList
              items={[
                { label: "Issuing organization", value: payload.issuing_organization ?? <span className="text-[var(--faint)]">Not stated</span> },
                { label: "Report number", value: payload.report_number ? <Mono>{payload.report_number}</Mono> : <span className="text-[var(--faint)]">Not stated</span> },
                { label: "Subject entities", value: payload.subject_entities.length ? payload.subject_entities.filter(Boolean).map((e) => e!.name).join(", ") : <span className="text-[var(--faint)]">None extracted</span> },
                { label: "Findings", value: plural(payload.key_findings.filter(Boolean).length, "finding") },
                { label: "Recommendations", value: plural(payload.recommendations.filter(Boolean).length, "recommendation") },
                { label: "Monetary amounts", value: plural(payload.monetary_amounts.filter(Boolean).length, "amount") },
              ]}
            />
          </Panel>
          <Panel>
            <PanelHeader title="Key findings" description={`${payload.key_findings.filter(Boolean).length} extracted from the current version.`} />
            {payload.key_findings.filter(Boolean).length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-[var(--muted)]">No findings were extracted from this document.</div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {payload.key_findings.filter(Boolean).slice(0, 5).map((f, i) => (
                  <li key={i} className="flex items-start gap-3 px-4 py-2.5 text-[13px] leading-5">
                    <span className="mt-0.5 w-[78px] shrink-0">
                      <Badge tone={f!.severity === "high" ? "bad" : f!.severity === "medium" ? "warn" : "neutral"} title={`Severity stated in the document: ${f!.severity}`}>
                        {`${f!.severity.charAt(0).toUpperCase()}${f!.severity.slice(1)}`}
                      </Badge>
                    </span>
                    <span className="min-w-0">{f!.finding}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      ) : null}

      <SectionTitle title="Version history" count={versions.length} description="Every uploaded edition is kept. A new content hash for the same logical key creates the next version." />
      <Table minWidth={960}>
        <THead>
          <Th align="right" width={80}>
            Version
          </Th>
          <Th>Filename</Th>
          <Th width={130}>SHA-256</Th>
          <Th align="right" width={90}>
            Size
          </Th>
          <Th align="right" width={70}>
            Pages
          </Th>
          <Th width={110}>Parse</Th>
          <Th width={140}>Processing</Th>
          <Th width={120}>State</Th>
          <Th align="right" width={110}>
            Uploaded
          </Th>
        </THead>
        <tbody>
          {versions.length === 0 ? <TableEmpty colSpan={9}>No versions have been uploaded for this document.</TableEmpty> : null}
          {versions.map((v) => (
            <Tr key={v.id}>
              <Td align="right">
                <Link href={`/documents/${doc.id}/versions/${v.id}`} className={rowLink}>
                  v{v.versionNumber}
                </Link>
              </Td>
              <Td className="max-w-[320px]">
                <Link href={`/documents/${doc.id}/versions/${v.id}`} className="block truncate text-[var(--fg)] transition-colors hover:text-[var(--accent)]" title={v.sourceFilename}>
                  {v.sourceFilename}
                </Link>
              </Td>
              <Td>
                <Mono title={v.contentHash} className="text-[var(--muted)]">
                  {v.contentHash.slice(0, 12)}
                </Mono>
              </Td>
              <Td align="right">{fmtBytes(v.byteSize)}</Td>
              <Td align="right">{v.pageCount ?? <span className="text-[var(--faint)]">—</span>}</Td>
              <Td>
                <StatusBadge status={v.parseStatus} size="sm" />
              </Td>
              <Td>
                <StatusBadge status={v.processingStatus} size="sm" />
              </Td>
              <Td>
                {v.isCurrent ? (
                  <StatusBadge status="current" size="sm" />
                ) : (
                  <span className="flex items-center gap-1 text-[12px] text-[var(--muted)]">
                    <Layers size={12} aria-hidden />
                    superseded
                    {v.supersedesVersionId && byId.get(v.supersedesVersionId) ? null : null}
                  </span>
                )}
                {v.supersedesVersionId ? (
                  <div className="mt-0.5 text-[12px] text-[var(--muted)]">
                    replaced{" "}
                    <Link href={`/documents/${doc.id}/versions/${v.supersedesVersionId}`} className="text-[var(--accent)] hover:underline">
                      {byId.get(v.supersedesVersionId) ? `v${byId.get(v.supersedesVersionId)!.versionNumber}` : shortId(v.supersedesVersionId)}
                    </Link>
                  </div>
                ) : null}
              </Td>
              <Td align="right">
                <TimeAgo value={v.createdAt} />
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
