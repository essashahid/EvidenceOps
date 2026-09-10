import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { env } from "@/lib/env";
import { verifyPassword } from "@/lib/auth/password";

export const SESSION_COOKIE = "eo_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = { userId: string; exp: number };

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

/** Produce `payload.signature` where payload is base64url JSON `{userId, exp}`. */
export function signSession(userId: string, opts: { secret?: string; now?: number; ttlSeconds?: number } = {}): string {
  const secret = opts.secret ?? env().AUTH_SECRET;
  const now = opts.now ?? Date.now();
  const exp = Math.floor(now / 1000) + (opts.ttlSeconds ?? SESSION_TTL_SECONDS);
  const payload = b64url(JSON.stringify({ userId, exp } satisfies SessionPayload));
  return `${payload}.${hmac(payload, secret)}`;
}

/** Verify the signature and expiry of a session token; returns the payload or null. */
export function readSession(token: string | undefined | null, opts: { secret?: string; now?: number } = {}): SessionPayload | null {
  if (!token) return null;
  const secret = opts.secret ?? env().AUTH_SECRET;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    if (typeof parsed.userId !== "string" || typeof parsed.exp !== "number") return null;
    const now = opts.now ?? Date.now();
    if (parsed.exp * 1000 <= now) return null;
    return { userId: parsed.userId, exp: parsed.exp };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  };
}

export type AuthUser = { id: string; email: string; displayName: string };

/** Check email + password against app_users; returns the user or null. */
export async function authenticateLocal(email: string, password: string): Promise<AuthUser | null> {
  const normalized = email.trim().toLowerCase();
  const [user] = await getDb()
    .select({ id: schema.appUsers.id, email: schema.appUsers.email, displayName: schema.appUsers.displayName, passwordHash: schema.appUsers.passwordHash })
    .from(schema.appUsers)
    .where(eq(schema.appUsers.email, normalized))
    .limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, displayName: user.displayName };
}

export async function loadUserById(userId: string): Promise<AuthUser | null> {
  const [user] = await getDb()
    .select({ id: schema.appUsers.id, email: schema.appUsers.email, displayName: schema.appUsers.displayName })
    .from(schema.appUsers)
    .where(and(eq(schema.appUsers.id, userId)))
    .limit(1);
  return user ?? null;
}
