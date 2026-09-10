import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { SESSION_COOKIE, authenticateLocal, loadUserById, readSession, sessionCookieOptions, signSession, type AuthUser } from "@/lib/auth/local";

export type CurrentUser = AuthUser;

export type SignInResult = { ok: true; user: CurrentUser } | { ok: false; error: string };

/** Resolve the signed-in user from the request cookies, or null. Driver-agnostic. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (env().AUTH_DRIVER === "supabase") {
    const { getSupabaseUser } = await import("@/lib/auth/supabase");
    return getSupabaseUser();
  }
  const store = await cookies();
  const session = readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  return loadUserById(session.userId);
}

/** Like getCurrentUser but redirects to /login when there is no session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (!email || !password) return { ok: false, error: "Email and password are required" };
  if (env().AUTH_DRIVER === "supabase") {
    const { signInSupabase } = await import("@/lib/auth/supabase");
    return signInSupabase(email, password);
  }
  if (env().AUTH_DRIVER === "database") {
    const key = `login:${createHash("sha256").update(email.trim().toLowerCase()).digest("hex")}`;
    const rows = await getDb().execute<{ hits: number }>(sql`
      insert into mutation_limits (key, window_start, hits) values (${key}, date_trunc('minute', now()), 1)
      on conflict (key) do update set
        hits = case when mutation_limits.window_start < date_trunc('minute', now()) then 1 else mutation_limits.hits + 1 end,
        window_start = date_trunc('minute', now()) returning hits
    `);
    if (Number(rows[0]?.hits) > 10) return { ok: false, error: "Too many sign-in attempts. Wait a minute and try again." };
  }
  const user = await authenticateLocal(email, password);
  if (!user) return { ok: false, error: "Invalid email or password" };
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(user.id), sessionCookieOptions());
  return { ok: true, user };
}

export async function signOut(): Promise<void> {
  if (env().AUTH_DRIVER === "supabase") {
    const { signOutSupabase } = await import("@/lib/auth/supabase");
    await signOutSupabase();
    return;
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
}
