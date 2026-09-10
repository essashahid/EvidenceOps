type Tone = "neutral" | "accent" | "ok" | "warn" | "bad";

const TONES: Record<string, Tone> = {
  queued: "neutral",
  pending: "neutral",
  processing: "accent",
  running: "accent",
  retrying: "accent",
  completed: "ok",
  completed_with_review: "warn",
  failed: "bad",
  unsupported: "warn",
  parsed: "ok",
  open: "warn",
  resolved: "ok",
  auto_approved: "ok",
  review: "warn",
  blocked: "bad",
  accepted: "ok",
  rejected: "bad",
  needs_source: "bad",
  succeeded: "ok",
  dead_letter: "bad",
  skipped: "neutral",
  supported: "ok",
  contradicted: "bad",
  unverified: "neutral",
  info: "neutral",
  debug: "neutral",
  warn: "warn",
  error: "bad",
  admin: "accent",
  reviewer: "ok",
  viewer: "neutral",
  generated: "ok",
  pass: "ok",
  fail: "bad",
};

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--line)] text-[var(--fg)]",
  accent: "bg-[color-mix(in_srgb,var(--accent)_14%,white)] text-[var(--accent)]",
  ok: "bg-[color-mix(in_srgb,var(--ok)_14%,white)] text-[var(--ok)]",
  warn: "bg-[color-mix(in_srgb,var(--warn)_14%,white)] text-[var(--warn)]",
  bad: "bg-[color-mix(in_srgb,var(--bad)_14%,white)] text-[var(--bad)]",
};

export function toneFor(status: string | null | undefined): Tone {
  return (status && TONES[status]) || "neutral";
}

export function StatusBadge({ status, title }: { status: string | null | undefined; title?: string }) {
  if (!status) return <span className="text-[var(--muted)]">-</span>;
  return (
    <span
      title={title}
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] leading-4 ${TONE_CLASS[toneFor(status)]}`}
    >
      {status}
    </span>
  );
}
