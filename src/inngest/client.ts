import { Inngest, eventType } from "inngest";
import { z } from "zod";

const documentJob = z.object({ processingRunId: z.string(), documentVersionId: z.string() });

export const documentProcessRequested = eventType("document.process.requested", { schema: documentJob });
export const documentRetryRequested = eventType("document.retry.requested", { schema: documentJob });

export const evaluationRequested = eventType("evaluation.requested", { schema: z.object({ evalRunId: z.string().uuid(), workspaceId: z.string().uuid(), userId: z.string().uuid(), processingRunId: z.string().uuid().nullable() }) });

export const inngest = new Inngest({ id: "evidenceops" });
