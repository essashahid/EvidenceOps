import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitives.
 *
 * Wide operational tables scroll horizontally as a unit instead of squeezing
 * their columns: the scroll container clips, and `minWidth` keeps the table at a
 * readable width on narrow viewports.
 */
export function Table({ children, className = "", minWidth = 720, bare = false }: { children: ReactNode; className?: string; minWidth?: number; bare?: boolean }) {
  return (
    <div className={cn("scroll-thin overflow-x-auto", !bare && "rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] shadow-[var(--shadow-sm)]", className)}>
      <table className="w-full border-collapse text-left text-[13px]" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <thead className={cn("bg-[var(--surface-sunken)] text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]", sticky && "sticky top-0 z-10")}>
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className = "", align = "left", width }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center"; width?: number | string }) {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn("whitespace-nowrap border-b border-[var(--line)] px-3 py-2 font-semibold", align === "right" && "text-right", align === "center" && "text-center", className)}
    >
      {children}
    </th>
  );
}

export function Tr({ children, className = "", muted = false }: { children: ReactNode; className?: string; muted?: boolean }) {
  return <tr className={cn("border-b border-[var(--line)] transition-colors last:border-b-0 hover:bg-[var(--surface-hover)]", muted && "text-[var(--muted)]", className)}>{children}</tr>;
}

export function Td({ children, className = "", align = "left", title, colSpan, nowrap = false }: { children?: ReactNode; className?: string; align?: "left" | "right" | "center"; title?: string; colSpan?: number; nowrap?: boolean }) {
  return (
    <td
      title={title}
      colSpan={colSpan}
      className={cn("px-3 py-2.5 align-middle", align === "right" && "tnum text-right", align === "center" && "text-center", nowrap && "whitespace-nowrap", className)}
    >
      {children}
    </td>
  );
}

/** Monospaced inline value: ids, hashes, locators, field paths. */
export function Mono({ children, title, className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("font-mono text-[12px]", className)}>
      {children}
    </span>
  );
}

/** Two-line cell: a primary label with a quiet secondary line underneath. */
export function CellStack({ primary, secondary, className = "" }: { primary: ReactNode; secondary?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="truncate font-medium text-[var(--fg)]">{primary}</div>
      {secondary ? <div className="mt-0.5 truncate text-[12px] text-[var(--muted)]">{secondary}</div> : null}
    </div>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-[13px] text-[var(--muted)]">
        {children}
      </td>
    </tr>
  );
}

/** Row link styling used inside tables so links read as content, not decoration. */
export const rowLink = "font-medium text-[var(--fg)] underline decoration-[var(--line-strong)] decoration-1 underline-offset-2 transition-colors hover:text-[var(--accent)] hover:decoration-[var(--accent)]";

/** Standalone inline link (outside tables). */
export const inlineLink = "text-[var(--accent)] underline decoration-[var(--accent-border)] underline-offset-2 transition-colors hover:decoration-[var(--accent)]";
