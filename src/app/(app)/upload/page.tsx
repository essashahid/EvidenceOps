import { env } from "@/lib/env";
import { mutationAllowed } from "@/lib/access";
import { requireWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/PageHeader";
import { UploadForm } from "./UploadForm";

export default async function UploadPage() {
  const context = await requireWorkspace();
  return (
    <>
      <PageHeader title="Upload documents" subtitle="Files are hashed, versioned by logical key, stored, then processed through parse, chunk, extract, validate, verify, score and route, embed." />
      <UploadForm canUpload={mutationAllowed(context)} directUpload={env().STORAGE_DRIVER === "supabase"} />
    </>
  );
}
