import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { env, jobsConfigured } from "@/lib/env";
import type { SessionContext, WorkspaceRole } from "@/lib/workspace";

export function mutationAllowed(context: SessionContext, roles: WorkspaceRole[] = ["admin", "reviewer"]): boolean {
  return !context.isPublic && roles.includes(context.workspace.role) && (!env().PUBLIC_DEMO_MODE || env().DEMO_MUTATIONS_ENABLED || context.workspace.role === "admin");
}

/** Shared database counter, so limits hold across serverless instances. */
export async function assertMutation(context: SessionContext, action: string, roles: WorkspaceRole[] = ["admin", "reviewer"], limit = 20) {
  if (!mutationAllowed(context, roles)) throw new Error("This workspace is read-only. Sign in with an authorized account to make changes.");
  if (["upload", "upload-sign", "reprocess", "run", "eval"].includes(action) && !jobsConfigured()) throw new Error("Background processing is not configured yet. Connect Inngest to enable this action.");
  const key = `${context.workspace.workspaceId}:${context.user.id}:${action}`;
  const rows = await getDb().execute<{ hits: number }>(sql`
    insert into mutation_limits (key, window_start, hits) values (${key}, date_trunc('minute', now()), 1)
    on conflict (key) do update set
      hits = case when mutation_limits.window_start < date_trunc('minute', now()) then 1 else mutation_limits.hits + 1 end,
      window_start = date_trunc('minute', now()) returning hits
  `);
  if (Number(rows[0]?.hits) > limit) throw new Error("Too many requests. Please wait a minute and try again.");
}
