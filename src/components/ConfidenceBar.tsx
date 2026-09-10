import { ROUTING_THRESHOLDS } from "@/lib/config";

/** 0..1 confidence bar with markers at the review (0.65) and auto-approve (0.86) thresholds. */
export function ConfidenceBar({ value, width = 120 }: { value: number | string | null | undefined; width?: number }) {
  const n = Math.max(0, Math.min(1, Number(value ?? 0) || 0));
  const color = n >= ROUTING_THRESHOLDS.autoApprove ? "var(--ok)" : n >= ROUTING_THRESHOLDS.review ? "var(--warn)" : "var(--bad)";
  return (
    <span className="inline-flex items-center gap-2" title={`confidence ${n.toFixed(3)} (review >= ${ROUTING_THRESHOLDS.review}, auto-approve >= ${ROUTING_THRESHOLDS.autoApprove})`}>
      <span className="relative inline-block h-2 overflow-hidden rounded-sm bg-[var(--line)]" style={{ width }}>
        <span className="absolute inset-y-0 left-0" style={{ width: `${n * 100}%`, background: color }} />
        <span className="absolute inset-y-0 w-px bg-[var(--fg)] opacity-50" style={{ left: `${ROUTING_THRESHOLDS.review * 100}%` }} />
        <span className="absolute inset-y-0 w-px bg-[var(--fg)] opacity-50" style={{ left: `${ROUTING_THRESHOLDS.autoApprove * 100}%` }} />
      </span>
      <span className="font-mono text-xs tabular-nums">{n.toFixed(2)}</span>
    </span>
  );
}
