import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 request proxy (the successor of middleware.ts). Redirects unauthenticated
 * app requests to /login. The local driver verifies the HMAC cookie with Web Crypto
 * (no node:crypto so this also works on the edge runtime); the supabase driver only
 * checks that an auth cookie is present and lets server components do the real check.
 */

const SESSION_COOKIE = "eo_session";
const PUBLIC_PREFIXES = ["/login", "/api/inngest", "/_next"];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  // Static files: anything with an extension at the root (favicon.ico, robots.txt, images).
  return /\.[a-zA-Z0-9]+$/.test(pathname);
}

function b64urlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function verifyLocalSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = bytesToB64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return false;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as { userId?: unknown; exp?: unknown };
    return typeof parsed.userId === "string" && typeof parsed.exp === "number" && parsed.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

function hasSupabaseCookie(req: NextRequest): boolean {
  return req.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const driver = process.env.AUTH_DRIVER === "supabase" ? "supabase" : "local";
  const authed =
    driver === "supabase"
      ? hasSupabaseCookie(req)
      : await verifyLocalSession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "evidenceops-dev-secret-change-me");
  if (authed) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
