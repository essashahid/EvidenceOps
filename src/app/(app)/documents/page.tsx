import Link from "next/link";
import { requireWorkspace } from "@/lib/workspace";
import { listDocuments } from "@/lib/queries/documents";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { DocumentTable } from "./DocumentTable";
export const dynamic = "force-dynamic";
export default async function DocumentsPage() {
  const { workspace } = await requireWorkspace();
  const docs = await listDocuments(workspace.workspaceId);
  return <><PageHeader title="Document library" subtitle="Every edition preserved. Every extracted value linked to its source." actions={<Button asChild><Link href="/upload">Upload documents</Link></Button>}/><DocumentTable documents={docs}/></>;
}
