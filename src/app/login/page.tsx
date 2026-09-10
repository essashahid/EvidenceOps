import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid size-11 place-items-center rounded-[var(--r-lg)] bg-[var(--accent)] text-white shadow-[var(--shadow-md)]">
            <ShieldCheck size={22} aria-hidden strokeWidth={2.2} />
          </span>
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">EvidenceOps</h1>
          <p className="mt-1 text-[13px] text-[var(--muted)]">Document intelligence with evidence you can check.</p>
        </div>

        <div className="rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[var(--shadow-md)]">
          <LoginForm next={next} initialError={params.error ? (ERRORS[params.error] ?? "Sign-in required") : null} />
        </div>

        {showHints ? (
          <div className="mt-4 rounded-[var(--r-lg)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-4 py-3 text-[12.5px]">
            <div className="mb-1.5 font-semibold text-[var(--muted)]">Demo accounts</div>
            <dl className="space-y-1">
              {[
                ["Admin", e.DEMO_ADMIN_EMAIL, e.DEMO_ADMIN_PASSWORD],
                ["Reviewer", e.DEMO_REVIEWER_EMAIL, e.DEMO_REVIEWER_PASSWORD],
                ["Viewer", e.DEMO_VIEWER_EMAIL, e.DEMO_VIEWER_PASSWORD],
              ].map(([role, email, password]) => (
                <div key={role} className="flex flex-wrap items-baseline gap-x-2">
                  <dt className="w-16 shrink-0 text-[var(--muted)]">{role}</dt>
                  <dd className="min-w-0 font-mono text-[11.5px]">
                    {email} / {password}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[var(--faint)]">Auth driver: {e.AUTH_DRIVER}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
