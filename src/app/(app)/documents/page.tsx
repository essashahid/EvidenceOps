import Link from "next/link";
import { Upload } from "lucide-react";
import { requireWorkspace } from "@/lib/workspace";
import { listDocuments } from "@/lib/queries/documents";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { DocumentTable } from "./DocumentTable";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { workspace } = await requireWorkspace();
  const docs = await listDocuments(workspace.workspaceId);
  return (
    <>
      <PageHeader section="documents"
        title="Document library"
        subtitle="Every edition is preserved and every extracted value stays linked to the page or paragraph it came from."
        actions={
          <Button asChild size="sm">
            <Link href="/upload">
              <Upload size={14} aria-hidden />
              Upload documents
            </Link>
          </Button>
        }
      />
      {docs.length === 0 ? (
        <EmptyState hue="docs"
          icon={<Upload size={18} aria-hidden />}
          title="No documents yet"
          action={
            <Button asChild>
              <Link href="/upload">Upload documents</Link>
            </Button>
          }
        >
          Upload a PDF or DOCX file. It is hashed, versioned by logical key, parsed into addressable blocks, and then extracted.
        </EmptyState>
      ) : (
        <DocumentTable documents={docs} />
      )}
    </>
  );
}
