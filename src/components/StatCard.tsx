import type { ReactNode } from "react";

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "accent" }) {
  const color = tone ? `text-[var(--${tone})]` : "text-[var(--fg)]";
  return (
    <div className="rounded border border-[var(--line)] bg-[var(--card)] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}
