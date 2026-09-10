import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "bad" | "info";

/**
 * Status vocabulary. Database enums are rendered as sentence-case labels so the
 * interface reads like a product rather than a table dump; the raw value is kept
 * in the tooltip for operators who need it.
 */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  // processing runs and document versions
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  retrying: { label: "Retrying", tone: "warn" },
  completed: { label: "Completed", tone: "ok" },
  completed_with_review: { label: "Review needed", tone: "warn" },
  failed: { label: "Failed", tone: "bad" },
  unsupported: { label: "Unsupported", tone: "warn" },
  // parsing
  pending: { label: "Pending", tone: "neutral" },
  parsed: { label: "Parsed", tone: "ok" },
  // review items
  open: { label: "Open", tone: "warn" },
  resolved: { label: "Resolved", tone: "ok" },
  needs_source: { label: "Needs source", tone: "bad" },
  superseded: { label: "Superseded", tone: "neutral" },
  // field routing
  auto_approved: { label: "Auto-approved", tone: "ok" },
  review: { label: "Review", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  // verifier verdicts
  supported: { label: "Supported", tone: "ok" },
  partially_supported: { label: "Partial support", tone: "warn" },
  unverified: { label: "Unverified", tone: "neutral" },
  contradicted: { label: "Contradiction", tone: "bad" },
  // run steps
  succeeded: { label: "Succeeded", tone: "ok" },
  dead_letter: { label: "Dead letter", tone: "bad" },
  skipped: { label: "Skipped", tone: "neutral" },
  // event levels
  debug: { label: "Debug", tone: "neutral" },
  info: { label: "Info", tone: "neutral" },
  warn: { label: "Warning", tone: "warn" },
  error: { label: "Error", tone: "bad" },
  // roles
  admin: { label: "Admin", tone: "accent" },
  reviewer: { label: "Reviewer", tone: "info" },
  viewer: { label: "Viewer", tone: "neutral" },
  // reports and evaluation
  generated: { label: "Generated", tone: "ok" },
  pass: { label: "Pass", tone: "ok" },
  fail: { label: "Fail", tone: "bad" },
  baseline: { label: "Baseline", tone: "info" },
  // versioning and ingestion outcomes
  current: { label: "Current", tone: "ok" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  new_version: { label: "New version", tone: "info" },
  created: { label: "Created", tone: "ok" },
  // priority
  high: { label: "High", tone: "bad" },
  normal: { label: "Normal", tone: "neutral" },
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "border-[var(--line-strong)] bg-[var(--surface-sunken)] text-[var(--muted)]",
  accent: "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]",
  ok: "border-[var(--ok-border)] bg-[var(--ok-soft)] text-[var(--ok)]",
  warn: "border-[var(--warn-border)] bg-[var(--warn-soft)] text-[var(--warn)]",
  bad: "border-[var(--bad-border)] bg-[var(--bad-soft)] text-[var(--bad)]",
  info: "border-[var(--info-border)] bg-[var(--info-soft)] text-[var(--info)]",
};

const LIVE = new Set(["running", "processing", "retrying"]);

export function toneFor(status: string | null | undefined): Tone {
  return (status && STATUS[status]?.tone) || "neutral";
}

export function labelFor(status: string | null | undefined): string {
  if (!status) return "";
  return STATUS[status]?.label ?? status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/** Small, quiet status pill. Pass `title` to add context beyond the label. */
export function StatusBadge({ status, title, className = "", size = "md" }: { status: string | null | undefined; title?: string; className?: string; size?: "sm" | "md" }) {
  if (!status) return <span className="text-[var(--faint)]">&mdash;</span>;
  const tone = toneFor(status);
  const label = labelFor(status);
  return (
    <span
      title={title ?? (label.toLowerCase() !== status.replaceAll("_", " ") ? status : undefined)}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-medium",
        size === "sm" ? "px-1.5 py-px text-[11px]" : "px-2 py-0.5 text-[12px]",
        TONE_CLASS[tone],
        className,
      )}
    >
      {LIVE.has(status) ? <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {label}
    </span>
  );
}

/** Free-form badge when the content is not a known status value. */
export function Badge({ children, tone = "neutral", title, mono = false, className = "" }: { children: ReactNode; tone?: Tone; title?: string; mono?: boolean; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-medium", mono && "font-mono text-[11px]", TONE_CLASS[tone], className)}>
      {children}
    </span>
  );
}
