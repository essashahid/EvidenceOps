/**
 * Supabase Auth driver. Only imported dynamically (see session.ts) when AUTH_DRIVER=supabase,
 * so the local driver has no Supabase runtime requirement.
 */
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { AuthUser } from "@/lib/auth/local";

async function client() {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("AUTH_DRIVER=supabase requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const store = await cookies();
  return createServerClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: cookies are read-only there. The proxy refreshes sessions.
        }
      },
    },
  });
}

/** Mirror authenticated identity. Workspace membership must be granted explicitly. */
async function ensureAppUser(authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }): Promise<AuthUser> {
  const db = getDb();
  const email = (authUser.email ?? `${authUser.id}@supabase.local`).toLowerCase();
  const meta = authUser.user_metadata ?? {};
  const displayName = String(meta.display_name ?? meta.full_name ?? meta.name ?? email);
  const [existing] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.id, authUser.id)).limit(1);
  if (!existing) {
    await db.insert(schema.appUsers).values({ id: authUser.id, email, displayName }).onConflictDoNothing();
  }
  const [row] = await db.select().from(schema.appUsers).where(eq(schema.appUsers.id, authUser.id)).limit(1);
  return { id: authUser.id, email: row?.email ?? email, displayName: row?.displayName ?? displayName };
}

export async function getSupabaseUser(): Promise<AuthUser | null> {
  const sb = await client();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return ensureAppUser(data.user);
}

export async function signInSupabase(email: string, password: string): Promise<{ ok: true; user: AuthUser } | { ok: false; error: string }> {
  const sb = await client();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { ok: false, error: error?.message ?? "Sign-in failed" };
  return { ok: true, user: await ensureAppUser(data.user) };
}

export async function signOutSupabase(): Promise<void> {
  const sb = await client();
  await sb.auth.signOut();
}
