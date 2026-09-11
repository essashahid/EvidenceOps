import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SectionIcon } from "@/components/SectionIcon";
import type { SectionKey } from "@/lib/sections";

export type Crumb = { label: ReactNode; href?: string };

/**
 * Page title block: optional breadcrumb, title, one line of purpose, and the
 * page-level actions. Every screen opens with exactly this.
 */
export function PageHeader({ title, subtitle, actions, meta, breadcrumbs, section, className = "" }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; meta?: ReactNode; breadcrumbs?: Crumb[]; section?: SectionKey; className?: string }) {
  return (
    <header className={cn("mb-5", className)}>
      {breadcrumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-[12.5px] text-[var(--muted)]">
          {breadcrumbs.map((c, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              {i > 0 ? <ChevronRight size={12} aria-hidden className="text-[var(--faint)]" /> : null}
              {c.href ? (
                <Link href={c.href} className="transition-colors hover:text-[var(--accent)]">
                  {c.label}
                </Link>
              ) : (
                <span className="text-[var(--fg)]">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-[min(100%,17rem)] flex-1 gap-3">
          {section ? <SectionIcon section={section} size="md" className="mt-0.5 hidden sm:grid" /> : null}
          <div className="min-w-0 flex-1">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[24px] font-semibold leading-8 tracking-[-0.02em]">{title}</h1>
            {subtitle ? <p className="mt-1 max-w-3xl text-[13.5px] leading-5 text-[var(--muted)]">{subtitle}</p> : null}
            {meta ? <div className="mt-2">{meta}</div> : null}
          </div>
        </div>
        {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export { SectionTitle as SectionHeader, SectionTitle } from "@/components/ui/panel";
