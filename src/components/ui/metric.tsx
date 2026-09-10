import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "ok" | "warn" | "bad" | "accent";

const VALUE_TONE: Record<Tone, string> = {
  default: "text-[var(--fg)]",
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  bad: "text-[var(--bad)]",
  accent: "text-[var(--accent)]",
};

/**
 * A single measurement. `size="lg"` is for the two or three numbers that carry a
 * page; everything else stays compact so a row of metrics does not out-shout the
 * content below it.
 */
export function Metric({
  label,
  value,
  hint,
  tone = "default",
  size = "md",
  href,
  target,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: "md" | "lg";
  href?: string;
  target?: { met: boolean; text: ReactNode };
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">{label}</span>
        {target ? (
          <span
            title={typeof target.text === "string" ? target.text : undefined}
            className={cn("shrink-0 rounded-full border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide", target.met ? "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]" : "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]")}
          >
            {target.met ? "Met" : "Missed"}
          </span>
        ) : null}
      </div>
      <div className={cn("tnum mt-1.5 font-semibold tracking-[-0.02em]", size === "lg" ? "text-[28px] leading-9" : "text-[22px] leading-7", VALUE_TONE[tone])}>{value}</div>
      {hint ? <div className="mt-1 text-[12px] leading-4 text-[var(--muted)]">{hint}</div> : null}
    </>
  );
  const shell = cn(
    "flex min-w-0 flex-col rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-sm)]",
    href && "transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-hover)]",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    );
  }
  return <div className={shell}>{body}</div>;
}

/** Responsive metric row: 2 up on phones, then 3, 4 or more on wider screens. */
export function MetricGroup({ children, columns = 4, className = "" }: { children: ReactNode; columns?: 3 | 4 | 5; className?: string }) {
  const cols = { 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4", 5: "sm:grid-cols-3 lg:grid-cols-5" }[columns];
  return <div className={cn("grid grid-cols-2 gap-3", cols, className)}>{children}</div>;
}

/**
 * Compact metric strip for secondary numbers: a label/value pair per column,
 * separated by hairlines. Used where a full card row would be too loud.
 */
export function MetricStrip({ items, className = "" }: { items: { label: ReactNode; value: ReactNode; tone?: Tone; title?: string }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 divide-[var(--line)] sm:grid-cols-3 sm:divide-x lg:grid-cols-6", className)}>
      {items.map((item, i) => (
        <div key={i} title={item.title} className="min-w-0 px-3.5 py-3 first:pl-4 max-sm:border-b max-sm:border-[var(--line)] max-sm:odd:border-r">
          <dt className="truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--muted)]">{item.label}</dt>
          <dd className={cn("tnum mt-1 text-[16px] font-semibold", VALUE_TONE[item.tone ?? "default"])}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
