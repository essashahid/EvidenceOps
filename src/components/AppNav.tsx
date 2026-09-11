"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/badge";
import { FormButton } from "@/components/FormButton";
import { HUE, NAV_ORDER, SECTIONS, sectionForPath } from "@/lib/sections";
import { cn } from "@/lib/utils";

export function AppNav({ email, role, workspaceName, isPublic, signOutAction }: { email: string; role: string; workspaceName: string; isPublic?: boolean; signOutAction: () => Promise<void> }) {
  const pathname = usePathname();
  const current = sectionForPath(pathname);
  const help = SECTIONS.help;

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[var(--surface)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--surface)]/80">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-[var(--r-md)] focus:bg-[var(--accent)] focus:px-3 focus:py-2 focus:text-white">
        Skip to content
      </a>

      <div className="mx-auto flex h-14 max-w-[1520px] items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 rounded-[var(--r-md)] text-[15px] font-semibold tracking-[-0.015em]">
          <span className="grid size-7 place-items-center rounded-[var(--r-md)] bg-[var(--accent)] text-white shadow-[var(--shadow-sm)]">
            <ShieldCheck size={16} aria-hidden strokeWidth={2.2} />
          </span>
          EvidenceOps
        </Link>

        <div className="flex min-w-0 items-center gap-2.5">
          <span className="hidden max-w-[220px] truncate text-[12.5px] text-[var(--muted)] xl:block" title={workspaceName}>
            {workspaceName}
          </span>
          <span aria-hidden className="hidden h-4 w-px bg-[var(--line)] xl:block" />
          <StatusBadge status={role} size="sm" />
          <span className="hidden max-w-[190px] truncate text-[12.5px] text-[var(--muted)] sm:block" title={email}>
            {email}
          </span>
          <Link
            href={help.href}
            aria-current={current === "help" ? "page" : undefined}
            title={help.blurb}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] border px-2.5 text-[13px] font-medium transition-colors",
              current === "help" ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-transparent text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--fg)]",
            )}
          >
            <help.icon size={15} aria-hidden strokeWidth={2} />
            <span className="hidden sm:inline">{help.label}</span>
          </Link>
          {isPublic ? (
            <Link href="/login" className="inline-flex h-8 items-center rounded-[var(--r-md)] border border-[var(--line-strong)] bg-[var(--surface)] px-2.5 text-[13px] font-medium shadow-[var(--shadow-sm)] transition-colors hover:bg-[var(--surface-hover)]">
              Sign in
            </Link>
          ) : (
            <form action={signOutAction}>
              <FormButton variant="ghost" size="sm" pendingText="Signing out…" title="Sign out of this workspace">
                <LogOut size={14} aria-hidden />
                <span className="sr-only sm:not-sr-only">Sign out</span>
              </FormButton>
            </form>
          )}
        </div>
      </div>

      {/* Tabs follow the order work flows: overview, upload, documents, review, ask, evaluate, runs. */}
      <nav aria-label="Main" className="scroll-thin scroll-x-fade mx-auto max-w-[1520px] overflow-x-auto px-4 sm:px-6 lg:[mask-image:none]">
        <ul className="flex min-w-max gap-0.5">
          {NAV_ORDER.map((key) => {
            const s = SECTIONS[key];
            const active = current === key;
            const h = HUE[s.hue];
            return (
              <li key={key}>
                <Link
                  href={s.href}
                  aria-current={active ? "page" : undefined}
                  title={s.blurb}
                  className={cn(
                    "group -mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2.5 text-[13px] font-medium transition-colors",
                    active ? "border-current text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:border-[var(--line-strong)] hover:text-[var(--fg)]",
                  )}
                  style={active ? { borderBottomColor: `var(--${s.hue === "accent" ? "accent" : `sec-${s.hue}`})` } : undefined}
                >
                  <s.icon size={15} aria-hidden strokeWidth={active ? 2.2 : 1.9} className={cn("transition-colors", active && h.fg)} />
                  {s.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
