import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KV = { label: ReactNode; value: ReactNode; title?: string; full?: boolean };

/**
 * Label/value list for record metadata. Rows stack on phones and align to a
 * fixed label column from `sm` up, so long values keep a single left edge.
 */
export function KeyValueList({ items, className = "", labelWidth = 132, dividers = true }: { items: KV[]; className?: string; labelWidth?: number; dividers?: boolean }) {
  return (
    <dl className={cn("text-[13px]", className)}>
      {items.map((item, i) => (
        <div
          key={i}
          title={item.title}
          className={cn("gap-x-4 gap-y-0.5 px-4 py-2.5 sm:flex", dividers && "border-b border-[var(--line)] last:border-b-0")}
        >
          <dt className="shrink-0 text-[12px] font-medium text-[var(--muted)] sm:pt-px" style={{ width: labelWidth }}>
            {item.label}
          </dt>
          <dd className="mt-0.5 min-w-0 flex-1 break-words text-[var(--fg)] sm:mt-0">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Dense inline metadata under a page title: pairs separated by hairline dots.
 * Replaces run-on sentences of "provider mock pipeline 1.0.0 model config ...".
 */
export function MetaRow({ items, className = "" }: { items: { label: ReactNode; value: ReactNode; title?: string }[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-[var(--muted)]", className)}>
      {items.map((item, i) => (
        <span key={i} title={item.title} className="inline-flex items-center gap-1.5">
          <span className="text-[var(--faint)]">{item.label}</span>
          <span className="text-[var(--fg)]">{item.value}</span>
        </span>
      ))}
    </div>
  );
}
