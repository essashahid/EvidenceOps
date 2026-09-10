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
