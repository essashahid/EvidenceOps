import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { listDocuments } from "@/lib/queries/documents";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Table, THead, Th, Tr, Td, Mono, TableEmpty } from "@/components/DataTable";
import { fmtDate } from "@/components/format";

export const dynamic = "force-dynamic";

function typeLabel(mime: string | null): string {
  if (!mime) return "";
  return mime === "application/pdf" ? "pdf" : mime.includes("wordprocessingml") ? "docx" : mime;
}

export default async function DocumentsPage() {
  const { workspace } = await requireWorkspace();
  const docs = await listDocuments(workspace.workspaceId);
  return (
    <>
      <PageHeader
        title="Documents"
        subtitle={`${docs.length} logical document(s); each row shows the current version`}
        actions={
          <Link href="/upload" className="rounded border border-[var(--line)] bg-[var(--card)] px-2.5 py-1 text-sm hover:bg-[var(--bg)]">
            Upload
          </Link>
        }
      />
      <Table>
        <THead>
          <Th>Document</Th>
          <Th>Logical key</Th>
          <Th align="right">Version</Th>
          <Th>Filename</Th>
          <Th>Type</Th>
          <Th align="right">Pages</Th>
          <Th>Parse</Th>
          <Th>Processing</Th>
          <Th align="right">Open review</Th>
          <Th>Updated</Th>
        </THead>
        <tbody>
          {docs.length === 0 ? (
            <TableEmpty colSpan={10}>
              No documents in this workspace.{" "}
              <Link href="/upload" className="text-[var(--accent)] underline">
                Upload one
              </Link>
              .
            </TableEmpty>
          ) : null}
          {docs.map((d) => (
            <Tr key={d.id}>
              <Td>
                <Link href={`/documents/${d.id}`} className="text-[var(--accent)] underline">
                  {d.displayName}
                </Link>
              </Td>
              <Td>
                <Mono>{d.logicalKey}</Mono>
              </Td>
              <Td align="right">
                {d.currentVersionId ? (
                  <Link href={`/documents/${d.id}/versions/${d.currentVersionId}`} className="text-[var(--accent)] underline">
                    v{d.versionNumber}
                  </Link>
                ) : (
                  ""
                )}
              </Td>
              <Td className="max-w-[320px] truncate" title={d.sourceFilename ?? undefined}>
                {d.sourceFilename}
              </Td>
              <Td>{typeLabel(d.mimeType)}</Td>
              <Td align="right">{d.pageCount ?? ""}</Td>
              <Td>
                <StatusBadge status={d.parseStatus} />
              </Td>
              <Td>
                <StatusBadge status={d.processingStatus} />
              </Td>
              <Td align="right">{d.openReviewCount > 0 ? <span className="text-[var(--warn)]">{d.openReviewCount}</span> : 0}</Td>
              <Td>
                <Mono>{fmtDate(d.updatedAt)}</Mono>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
