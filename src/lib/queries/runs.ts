import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";

export async function listRuns(workspaceId: string, limit = 200) {
  return getDb().select().from(schema.processingRuns).where(eq(schema.processingRuns.workspaceId, workspaceId)).orderBy(desc(schema.processingRuns.createdAt)).limit(limit);
}

export async function getRun(workspaceId: string, runId: string) {
  const [run] = await getDb()
    .select()
    .from(schema.processingRuns)
    .where(and(eq(schema.processingRuns.workspaceId, workspaceId), eq(schema.processingRuns.id, runId)))
    .limit(1);
  return run ?? null;
}

export async function listRunDocuments(workspaceId: string, versionIds: string[]) {
  if (versionIds.length === 0) return [];
  const rows = await getDb()
    .select({ version: schema.documentVersions, document: schema.documents })
    .from(schema.documentVersions)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
    .where(and(eq(schema.documentVersions.workspaceId, workspaceId), inArray(schema.documentVersions.id, versionIds)));
  const order = new Map(versionIds.map((id, i) => [id, i]));
  return rows.sort((a, b) => (order.get(a.version.id) ?? 0) - (order.get(b.version.id) ?? 0));
}

export async function listRunSteps(runId: string) {
  return getDb().select().from(schema.runSteps).where(eq(schema.runSteps.processingRunId, runId)).orderBy(asc(schema.runSteps.createdAt));
}

export async function listDeadLetters(runId: string) {
  return getDb().select().from(schema.deadLetters).where(eq(schema.deadLetters.processingRunId, runId)).orderBy(desc(schema.deadLetters.createdAt));
}

export async function listRunEvents(runId: string, limit = 200, filters: { level?: string; document?: string; step?: string } = {}) {
  const conditions = [eq(schema.runEvents.processingRunId, runId)];
  if (filters.level && ["debug", "info", "warn", "error"].includes(filters.level)) conditions.push(eq(schema.runEvents.level, filters.level as "debug" | "info" | "warn" | "error"));
  if (filters.document) conditions.push(sql`${schema.runEvents.documentVersionId}::text = ${filters.document}`);
  if (filters.step) conditions.push(sql`${schema.runEvents.payloadJson}->>'stepName' = ${filters.step}`);
  return getDb().select().from(schema.runEvents).where(and(...conditions)).orderBy(desc(schema.runEvents.id)).limit(limit);
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? null;
}
