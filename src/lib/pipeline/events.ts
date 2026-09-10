import { getDb, schema } from "@/lib/db/client";

export async function logEvent(
  processingRunId: string,
  documentVersionId: string | null,
  level: "debug" | "info" | "warn" | "error",
  eventType: string,
  message: string,
  payload: Record<string, unknown> = {},
) {
  await getDb().insert(schema.runEvents).values({ processingRunId, documentVersionId, level, eventType, message, payloadJson: payload });
}
