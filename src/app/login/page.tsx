import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { LoginForm } from "./LoginForm";

const ERRORS: Record<string, string> = {
  no_workspace: "Your account is not a member of any workspace.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const params = await searchParams;
  const user = await getCurrentUser();
  if (user && !params.error) redirect("/");
  const e = env();
  const showHints = e.NODE_ENV !== "production";
  const next = params.next && params.next.startsWith("/") ? params.next : "/";
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-12">
      <div className="rounded border border-[var(--line)] bg-[var(--card)] p-5">
        <div className="mb-4">
          <div className="text-base font-semibold text-[var(--accent)]">EvidenceOps</div>
          <div className="text-sm text-[var(--muted)]">Sign in to your workspace</div>
        </div>
        <LoginForm next={next} initialError={params.error ? (ERRORS[params.error] ?? "Sign-in required") : null} />
        {showHints ? (
          <div className="mt-4 border-t border-[var(--line)] pt-3 text-xs text-[var(--muted)]">
            <div className="mb-1 font-medium">Demo accounts</div>
            <div className="font-mono">
              {e.SEED_ADMIN_EMAIL} / {e.SEED_ADMIN_PASSWORD} (admin)
            </div>
            <div className="font-mono">
              {e.SEED_REVIEWER_EMAIL} / {e.SEED_REVIEWER_PASSWORD} (reviewer)
            </div>
            <div className="mt-1">Auth driver: {e.AUTH_DRIVER}</div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
