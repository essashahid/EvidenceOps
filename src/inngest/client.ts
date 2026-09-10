import { Inngest, eventType } from "inngest";
import { z } from "zod";

const documentJob = z.object({ processingRunId: z.string(), documentVersionId: z.string() });

export const documentProcessRequested = eventType("document.process.requested", { schema: documentJob });
export const documentRetryRequested = eventType("document.retry.requested", { schema: documentJob });

export const inngest = new Inngest({ id: "evidenceops" });
