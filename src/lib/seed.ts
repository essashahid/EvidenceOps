import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";

export type SeedResult = { workspaceId: string; adminId: string; reviewerId: string; viewerId: string };

/** Idempotently create the default workspace and the demo admin, reviewer and viewer users. */
export async function seedWorkspace(): Promise<SeedResult> {
  const db = getDb();
  const e = env();
  let [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.slug, "default")).limit(1);
  if (!ws) [ws] = await db.insert(schema.workspaces).values({ slug: "default", name: "EvidenceOps Demo Workspace" }).returning();

  async function ensureUser(email: string, password: string, displayName: string, role: "admin" | "reviewer" | "viewer") {
    let [u] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, email)).limit(1);
    if (e.AUTH_DRIVER === "supabase") {
      if (password.length < 16 || password.startsWith("evidenceops-")) throw new Error(`Set a unique password of at least 16 characters for ${role} before seeding Supabase Auth`);
      const { createClient } = await import("@supabase/supabase-js");
      const sb = createClient(e.NEXT_PUBLIC_SUPABASE_URL!, e.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
      const { data: existing } = await sb.auth.admin.listUsers({ perPage: 1000 });
      let authUser = existing.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
      if (!authUser) {
        const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } });
        if (error || !data.user) throw new Error(error?.message ?? "Failed to seed auth user");
        authUser = data.user;
      }
      if (u && u.id !== authUser.id) throw new Error(`Local user ${email} has a different identity; use a fresh Supabase database.`);
      if (!u) [u] = await db.insert(schema.appUsers).values({ id: authUser.id, email, displayName }).returning();
    } else if (!u) [u] = await db.insert(schema.appUsers).values({ email, displayName, passwordHash: hashPassword(password) }).returning();
    await db.insert(schema.workspaceMembers).values({ workspaceId: ws!.id, userId: u!.id, role }).onConflictDoNothing();
    return u!.id;
  }
  const adminId = await ensureUser(e.DEMO_ADMIN_EMAIL, e.DEMO_ADMIN_PASSWORD, "Demo Admin", "admin");
  const reviewerId = await ensureUser(e.DEMO_REVIEWER_EMAIL, e.DEMO_REVIEWER_PASSWORD, "Demo Reviewer", "reviewer");
  const viewerId = await ensureUser(e.DEMO_VIEWER_EMAIL, e.DEMO_VIEWER_PASSWORD, "Demo Viewer", "viewer");
  return { workspaceId: ws!.id, adminId, reviewerId, viewerId };
}
