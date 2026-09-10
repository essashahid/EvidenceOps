import { env, jobsConfigured } from "@/lib/env";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/AppNav";
import { requireWorkspace } from "@/lib/workspace";
import { signOutAction } from "./actions";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { user, workspace, isPublic } = await requireWorkspace();
  return (
    <>
      <AppNav isPublic={isPublic} email={user.email} role={workspace.role} workspaceName={workspace.name} signOutAction={signOutAction} />
      <main id="main-content" className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8">
        {env().PUBLIC_DEMO_MODE ? <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#c7dedc] bg-[#edf6f4] px-4 py-3 text-xs text-[#245c54]"><span><strong>Synthetic demo workspace.</strong> Explore source evidence, review decisions and quality results.{env().LLM_PROVIDER === "mock" ? " Results use a deterministic test provider." : ""}</span>{isPublic ? <Link href="/login" className="font-semibold underline">Sign in to manage →</Link> : null}</div> : null}
        {!isPublic && !jobsConfigured() ? <p className="mb-4 rounded border border-[var(--line)] bg-[var(--card)] p-3 text-sm">Background processing is awaiting setup. Uploads, reprocessing and evaluation runs are unavailable until Inngest is connected.</p> : null}
        {children}
      </main>
    </>
  );
}
