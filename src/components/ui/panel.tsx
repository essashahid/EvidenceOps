import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Panel is the one container in the product. Everything that sits on the page
 * background — tables, forms, evidence, metric groups — sits in one of these.
 */
export function Panel({ children, className = "", as: Tag = "section", id }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "aside"; id?: string }) {
  return (
    <Tag id={id} className={cn("panel overflow-hidden rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)]", className)}>
      {children}
    </Tag>
  );
}

/** Panel title bar. `dense` drops it to a quiet label strip for secondary panels. */
export function PanelHeader({ title, description, actions, dense = false, className = "" }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; dense?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-[var(--line)]", dense ? "bg-[var(--surface-sunken)] px-4 py-2" : "px-4 py-3", className)}>
      <div className="min-w-0">
        <h3 className={cn(dense ? "text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]" : "text-[14px] font-semibold text-[var(--fg)]")}>{title}</h3>
        {description ? <p className="mt-0.5 text-[12px] text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={cn(padded && "p-4", className)}>{children}</div>;
}

export function PanelFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-3 border-t border-[var(--line)] bg-[var(--surface-sunken)] px-4 py-2.5 text-[12px] text-[var(--muted)]", className)}>{children}</div>;
}

/**
 * Section heading used between panels. One level below the page title, and the
 * only other heading size on a page.
 */
export function SectionTitle({ title, count, description, actions, id, className = "" }: { title: ReactNode; count?: number; description?: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  return (
    <div id={id} className={cn("mb-2.5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-[var(--fg)]">
          <span>{title}</span>
          {count !== undefined ? <span className="tnum rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[12px] font-medium text-[var(--muted)]">{count}</span> : null}
        </h2>
        {description ? <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Inline notice: info / success / warning / error. Used for flashes and banners. */
export function Notice({ tone = "info", title, children, className = "", actions }: { tone?: "info" | "ok" | "warn" | "bad" | "accent"; title?: ReactNode; children?: ReactNode; className?: string; actions?: ReactNode }) {
  const tones = {
    info: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
    accent: "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]",
    ok: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
    warn: "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]",
    bad: "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]",
  } as const;
  return (
    <div role={tone === "bad" ? "alert" : undefined} className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-[var(--r-md)] border px-3.5 py-2.5 text-[13px]", tones[tone], className)}>
      <div className="min-w-0">
        {title ? <span className="font-semibold">{title}</span> : null}
        {title && children ? " " : null}
        {children ? <span className={cn(title && "text-[var(--fg)]")}>{children}</span> : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
