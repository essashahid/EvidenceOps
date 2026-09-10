import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Next 16 request proxy (the successor of middleware.ts). Redirects unauthenticated
 * app requests to /login. The local driver verifies the HMAC cookie with Web Crypto
 * (no node:crypto so this also works on the edge runtime); the Supabase driver validates the session and refreshes its cookies.
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

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname) && pathname !== "/login") return NextResponse.next();
  let response = NextResponse.next({ request: req });
  let authed = false;
  if (process.env.AUTH_DRIVER === "supabase") {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll(cookies, headers) {
          for (const { name, value } of cookies) req.cookies.set(name, value);
          response = NextResponse.next({ request: req });
          for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
          if (headers) for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
        },
      },
    });
    const { data } = await sb.auth.getUser();
    authed = Boolean(data.user);
  } else {
    authed = await verifyLocalSession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "evidenceops-dev-secret-change-me");
  }
  if (authed || pathname === "/login" || process.env.PUBLIC_DEMO_MODE === "true") return response;
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
  const redirect = NextResponse.redirect(url);
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
