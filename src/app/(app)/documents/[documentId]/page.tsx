import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/workspace";
import { getDocument, listVersionsForDocument } from "@/lib/queries/documents";
import { PageHeader, SectionHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtBytes, fmtDate, shortId } from "@/components/format";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const { workspace } = await requireWorkspace();
  const doc = await getDocument(workspace.workspaceId, documentId);
  if (!doc) notFound();
  const versions = await listVersionsForDocument(workspace.workspaceId, doc.id);
  const byId = new Map(versions.map((v) => [v.id, v]));
  return (
    <>
      <PageHeader
        title={doc.displayName}
        subtitle={
          <span className="flex flex-wrap items-center gap-3">
            <span>
              Logical key <Mono>{doc.logicalKey}</Mono>
            </span>
            <span>
              Document id <Mono title={doc.id}>{doc.id}</Mono>
            </span>
            <span>Created {fmtDate(doc.createdAt)}</span>
          </span>
        }
        actions={
          <Link href="/documents" className="text-sm text-[var(--accent)] underline">
            All documents
          </Link>
        }
      />
      <SectionHeader title="Versions" count={versions.length} />
      <Table>
        <THead>
          <Th align="right">Version</Th>
          <Th>Filename</Th>
          <Th>SHA-256</Th>
          <Th align="right">Size</Th>
          <Th align="right">Pages</Th>
          <Th>Parse</Th>
          <Th>Processing</Th>
          <Th>Current</Th>
          <Th>Supersedes</Th>
          <Th>Created</Th>
        </THead>
        <tbody>
          {versions.length === 0 ? <TableEmpty colSpan={10}>No versions.</TableEmpty> : null}
          {versions.map((v) => (
            <Tr key={v.id}>
              <Td align="right">
                <Link href={`/documents/${doc.id}/versions/${v.id}`} className="text-[var(--accent)] underline">
                  v{v.versionNumber}
                </Link>
              </Td>
              <Td className="max-w-[360px] truncate" title={v.sourceFilename}>
                <Link href={`/documents/${doc.id}/versions/${v.id}`} className="hover:underline">
                  {v.sourceFilename}
                </Link>
              </Td>
              <Td>
                <Mono title={v.contentHash}>{v.contentHash.slice(0, 12)}</Mono>
              </Td>
              <Td align="right">{fmtBytes(v.byteSize)}</Td>
              <Td align="right">{v.pageCount ?? ""}</Td>
              <Td>
                <StatusBadge status={v.parseStatus} />
              </Td>
              <Td>
                <StatusBadge status={v.processingStatus} />
              </Td>
              <Td>{v.isCurrent ? <StatusBadge status="accepted" title="current version" /> : <span className="text-xs text-[var(--muted)]">superseded</span>}</Td>
              <Td>
                {v.supersedesVersionId ? (
                  <Link href={`/documents/${doc.id}/versions/${v.supersedesVersionId}`} className="text-[var(--accent)] underline">
                    {byId.get(v.supersedesVersionId) ? `v${byId.get(v.supersedesVersionId)!.versionNumber}` : shortId(v.supersedesVersionId)}
                  </Link>
                ) : (
                  ""
                )}
              </Td>
              <Td>
                <Mono>{fmtDate(v.createdAt)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
