import { ROUTING_THRESHOLDS } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * Confidence on the 0..1 scale with the two routing thresholds marked, so a
 * reader sees not just the number but which side of the decision it falls on.
 */
export function ConfidenceBar({ value, width = 104, showValue = true, className = "" }: { value: number | string | null | undefined; width?: number; showValue?: boolean; className?: string }) {
  const n = Math.max(0, Math.min(1, Number(value ?? 0) || 0));
  const tone = n >= ROUTING_THRESHOLDS.autoApprove ? "var(--ok)" : n >= ROUTING_THRESHOLDS.review ? "var(--warn)" : "var(--bad)";
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      title={`Confidence ${n.toFixed(3)} — review at ${ROUTING_THRESHOLDS.review}, auto-approve at ${ROUTING_THRESHOLDS.autoApprove}`}
      role="img"
      aria-label={`Confidence ${n.toFixed(2)} of 1`}
    >
      <span className="relative inline-block h-1.5 shrink-0 overflow-hidden rounded-full bg-[var(--line)]" style={{ width }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${n * 100}%`, background: tone }} />
        <span aria-hidden className="absolute inset-y-0 w-px bg-[var(--surface)] opacity-80" style={{ left: `${ROUTING_THRESHOLDS.review * 100}%` }} />
        <span aria-hidden className="absolute inset-y-0 w-px bg-[var(--surface)] opacity-80" style={{ left: `${ROUTING_THRESHOLDS.autoApprove * 100}%` }} />
      </span>
      {showValue ? <span className="tnum text-[12px] font-medium" style={{ color: tone }}>{n.toFixed(2)}</span> : null}
    </span>
  );
}
