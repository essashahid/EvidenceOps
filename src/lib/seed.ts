import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { hashPassword } from "@/lib/auth/password";

export type SeedResult = { workspaceId: string; adminId: string; reviewerId: string };

/** Idempotently create the default workspace plus admin and reviewer users. */
export async function seedWorkspace(): Promise<SeedResult> {
  const db = getDb();
  const e = env();
  let [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.slug, "default")).limit(1);
  if (!ws) [ws] = await db.insert(schema.workspaces).values({ slug: "default", name: "EvidenceOps Demo Workspace" }).returning();

  async function ensureUser(email: string, password: string, displayName: string, role: "admin" | "reviewer" | "viewer") {
    let [u] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.email, email)).limit(1);
    if (!u) [u] = await db.insert(schema.appUsers).values({ email, displayName, passwordHash: hashPassword(password) }).returning();
    await db.insert(schema.workspaceMembers).values({ workspaceId: ws!.id, userId: u!.id, role }).onConflictDoNothing();
    return u!.id;
  }
  const adminId = await ensureUser(e.SEED_ADMIN_EMAIL, e.SEED_ADMIN_PASSWORD, "Demo Admin", "admin");
  const reviewerId = await ensureUser(e.SEED_REVIEWER_EMAIL, e.SEED_REVIEWER_PASSWORD, "Demo Reviewer", "reviewer");
  return { workspaceId: ws!.id, adminId, reviewerId };
}
