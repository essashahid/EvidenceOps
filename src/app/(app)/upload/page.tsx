import { env, jobsConfigured } from "@/lib/env";
import { mutationAllowed } from "@/lib/access";
import { requireWorkspace } from "@/lib/workspace";
import { PageHeader } from "@/components/PageHeader";
import { UploadForm } from "./UploadForm";

export default async function UploadPage() {
  const context = await requireWorkspace();
  return (
    <>
      <PageHeader
        title="Upload documents"
        subtitle="Files are hashed and versioned by logical key before anything is processed, so re-uploading the same document never costs a second extraction."
      />
      <UploadForm canUpload={mutationAllowed(context) && jobsConfigured()} directUpload={env().STORAGE_DRIVER !== "local"} />
    </>
  );
}
