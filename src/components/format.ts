export function shortId(id: string | null | undefined): string {
  return id ? id.slice(0, 8) : "";
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** ISO-like UTC time: 2026-09-10 14:02 UTC */
export function fmtDate(value: Date | string | null | undefined, withSeconds = false): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return (withSeconds ? `${base}:${pad(d.getUTCSeconds())}` : base) + " UTC";
}

/** Calendar date only: 2026-09-10 */
export function fmtDay(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Short elapsed form for operational lists ("4 min ago", "3 d ago"), falling back
 * to a calendar date beyond a week. The exact timestamp always stays in `title`.
 */
export function fmtAgo(value: Date | string | null | undefined, now: Date = new Date()): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const seconds = Math.round((now.getTime() - d.getTime()) / 1000);
  if (seconds < 0) return fmtDay(d);
  if (seconds < 45) return "just now";
  if (seconds < 90) return "1 min ago";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days <= 7) return `${days} d ago`;
  return fmtDay(d);
}

export function fmtUsd(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "$0.0000";
  if (n === 0) return "$0.00";
  return Math.abs(n) < 0.01 ? `$${n.toFixed(6)}` : `$${n.toFixed(4)}`;
}

export function fmtNumber(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("en-US").format(n);
}

/** Compact token/row counts for dense columns: 12.4k, 1.2M. */
export function fmtCompact(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "0";
  if (Math.abs(n) < 1000) return String(n);
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  if (m < 60) return `${m}m ${pad(s)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad(m % 60)}m`;
}

export function fmtPct(value: number | string | null | undefined, digits = 0): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  if (!Number.isFinite(n)) return "0%";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtConfidence(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

/** Currency amount in its own currency, without cents for whole values. */
export function fmtMoney(amount: number | string | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : (amount ?? 0);
  if (!Number.isFinite(n)) return "";
  const code = (currency ?? "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n);
  } catch {
    return `${fmtNumber(n)} ${code}`;
  }
}

/** Render an arbitrary JSON leaf for display. */
export function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/**
 * Human summary of an extracted field value. List items in the record schema are
 * objects; showing raw JSON in a queue is unreadable, so each shape gets a
 * sentence-shaped summary and the JSON stays available on the detail view.
 */
export function summarizeFieldValue(fieldPath: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  const root = fieldPath.replace(/\[\d+\]$/, "");
  if (typeof value !== "object") return String(value);
  const v = value as Record<string, unknown>;
  switch (root) {
    case "monetary_amounts": {
      const money = fmtMoney(v.amount as number, v.currency as string);
      return v.context ? `${money} — ${String(v.context)}` : money;
    }
    case "key_findings":
      return String(v.finding ?? "");
    case "recommendations":
      return String(v.recommendation ?? "");
    case "subject_entities":
      return String(v.name ?? "");
    default:
      return JSON.stringify(value);
  }
}

/** Secondary qualifier for a list item (severity, priority, target entity). */
export function qualifyFieldValue(fieldPath: string, value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const root = fieldPath.replace(/\[\d+\]$/, "");
  const v = value as Record<string, unknown>;
  if (root === "key_findings" && v.severity) return `Severity ${String(v.severity)}`;
  if (root === "recommendations") {
    const parts = [v.target_entity ? `Target: ${String(v.target_entity)}` : null, v.status_if_stated ? `Status: ${String(v.status_if_stated)}` : null].filter(Boolean);
    return parts.length ? parts.join(" · ") : null;
  }
  return null;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** "1 item" / "3 items" without the "(s)" shorthand. */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${fmtNumber(n)} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
