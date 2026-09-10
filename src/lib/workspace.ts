import { env } from "@/lib/env";
import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db/client";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";

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

export type SessionContext = { user: CurrentUser; workspace: WorkspaceContext; isPublic?: boolean };

/** requireUser + membership; redirects to /login when either is missing. */
export async function requireWorkspace(): Promise<SessionContext> {
  const user = await getCurrentUser();
  if (!user && env().PUBLIC_DEMO_MODE) {
    const [ws] = await getDb().select().from(schema.workspaces).where(eq(schema.workspaces.slug, "default")).limit(1);
    if (ws) return { user: { id: "00000000-0000-0000-0000-000000000000", email: "Public demo", displayName: "Visitor" }, workspace: { workspaceId: ws.id, slug: ws.slug, name: ws.name, role: "viewer" }, isPublic: true };
  }
  if (!user) redirect("/login");
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
