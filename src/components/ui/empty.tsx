import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Full empty state for a page or a primary panel: says what is missing, why the
 * area is empty, and what to do next.
 */
export function EmptyState({ icon, title, children, action, className = "", compact = false }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-[var(--r-lg)] border border-dashed border-[var(--line-strong)] bg-[var(--surface)] text-center", compact ? "px-4 py-6" : "px-6 py-12", className)}>
      {icon ? <div className="mb-3 grid size-10 place-items-center rounded-full bg-[var(--surface-sunken)] text-[var(--muted)]">{icon}</div> : null}
      <div className="text-[14px] font-semibold text-[var(--fg)]">{title}</div>
      {children ? <div className="mt-1 max-w-md text-[13px] leading-5 text-[var(--muted)]">{children}</div> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * One-line replacement for a section that has nothing to show. Used instead of
 * rendering an empty table with a full header row.
 */
export function EmptyLine({ children, className = "", tone = "muted" }: { children: ReactNode; className?: string; tone?: "muted" | "ok" }) {
  return (
    <div className={cn("rounded-[var(--r-lg)] border border-dashed border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-[13px]", tone === "ok" ? "text-[var(--muted)]" : "text-[var(--muted)]", className)}>
      {children}
    </div>
  );
}
