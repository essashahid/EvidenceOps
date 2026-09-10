import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db/client";
import { requireUser, type CurrentUser } from "@/lib/auth/session";

export type WorkspaceRole = "admin" | "reviewer" | "viewer";

export type WorkspaceContext = { workspaceId: string; slug: string; name: string; role: WorkspaceRole };

/** First workspace membership for the user (this demo has a single "default" workspace). */
export async function getWorkspaceForUser(userId: string): Promise<WorkspaceContext | null> {
  const [row] = await getDb()
    .select({
      workspaceId: schema.workspaces.id,
      slug: schema.workspaces.slug,
      name: schema.workspaces.name,
      role: schema.workspaceMembers.role,
    })
    .from(schema.workspaceMembers)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .orderBy(asc(schema.workspaceMembers.createdAt))
    .limit(1);
  return row ?? null;
}

export type SessionContext = { user: CurrentUser; workspace: WorkspaceContext };

/** requireUser + membership; redirects to /login when either is missing. */
export async function requireWorkspace(): Promise<SessionContext> {
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(user.id);
  if (!workspace) redirect("/login?error=no_workspace");
  return { user, workspace };
}

export function canReview(role: WorkspaceRole): boolean {
  return role === "admin" || role === "reviewer";
}

export function isAdmin(role: WorkspaceRole): boolean {
  return role === "admin";
}
