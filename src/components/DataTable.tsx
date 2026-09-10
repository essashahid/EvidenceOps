import type { ReactNode } from "react";

/**
 * Small table primitives. Usage:
 *   <Table><THead><Th>..</Th></THead><tbody><Tr><Td>..</Td></Tr></tbody></Table>
 */
export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--card)] ${className}`}>
      <table className="w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-[var(--bg)] text-[11px] uppercase tracking-wide text-[var(--muted)]">
      <tr>{children}</tr>
    </thead>
  );
}

export function Th({ children, className = "", align = "left" }: { children?: ReactNode; className?: string; align?: "left" | "right" }) {
  return <th className={`border-b border-[var(--line)] px-3 py-3 font-medium ${align === "right" ? "text-right" : ""} ${className}`}>{children}</th>;
}

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--bg)] ${className}`}>{children}</tr>;
}

export function Td({ children, className = "", align = "left", title, colSpan }: { children?: ReactNode; className?: string; align?: "left" | "right"; title?: string; colSpan?: number }) {
  return (
    <td title={title} colSpan={colSpan} className={`px-3 py-3 align-top ${align === "right" ? "text-right tabular-nums" : ""} ${className}`}>
      {children}
    </td>
  );
}

export function Mono({ children, title, className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={`font-mono text-xs ${className}`}>
      {children}
    </span>
  );
}

export function TableEmpty({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-2.5 py-4 text-center text-[var(--muted)]">
        {children}
      </td>
    </tr>
  );
}
