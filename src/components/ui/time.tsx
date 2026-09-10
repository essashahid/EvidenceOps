import { fmtAgo, fmtDate } from "@/components/format";
import { cn } from "@/lib/utils";

/**
 * Elapsed time for lists ("4 min ago"), with the exact UTC timestamp on hover.
 * Rendered on the server only, so there is no hydration drift.
 */
export function TimeAgo({ value, className = "", prefix }: { value: Date | string | null | undefined; className?: string; prefix?: string }) {
  if (!value) return <span className="text-[var(--faint)]">&mdash;</span>;
  return (
    <span title={fmtDate(value, true)} className={cn("whitespace-nowrap text-[var(--muted)]", className)}>
      {prefix ? `${prefix} ` : ""}
      {fmtAgo(value)}
    </span>
  );
}

/** Absolute timestamp for audit contexts where the exact moment is the point. */
export function TimeStamp({ value, withSeconds = false, className = "" }: { value: Date | string | null | undefined; withSeconds?: boolean; className?: string }) {
  if (!value) return <span className="text-[var(--faint)]">&mdash;</span>;
  return (
    <span title={fmtDate(value, true)} className={cn("tnum whitespace-nowrap text-[12px] text-[var(--muted)]", className)}>
      {fmtDate(value, withSeconds)}
    </span>
  );
}
