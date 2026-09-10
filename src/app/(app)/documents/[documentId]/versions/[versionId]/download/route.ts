import { requireWorkspace } from "@/lib/workspace";
import { getVersion } from "@/lib/queries/documents";
import { getStorage } from "@/lib/storage";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string; versionId: string }> }) {
  const { workspace } = await requireWorkspace();
  const { documentId, versionId } = await params;
  const row = await getVersion(workspace.workspaceId, versionId);
  if (!row || row.document.id !== documentId) return new Response("Not found", { status: 404 });
  const bytes = await getStorage().get(row.version.storagePath);
  return new Response(new Uint8Array(bytes), { headers: {
    "Content-Type": row.version.mimeType,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.version.sourceFilename)}`,
    "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store",
  } });
}
