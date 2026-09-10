import type { ReactNode } from "react";

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "bad" | "accent" }) {
  const color = tone ? { ok: "text-[var(--ok)]", warn: "text-[var(--warn)]", bad: "text-[var(--bad)]", accent: "text-[var(--accent)]" }[tone] : "text-[var(--fg)]";
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-4">
      <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className={`mt-3 text-2xl font-semibold tabular-nums ${color}`}>{value}</div>
      {hint ? <div className="mt-2 text-xs text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}
