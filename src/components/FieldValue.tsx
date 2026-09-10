import { fmtMoney, summarizeFieldValue, truncate } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const SEVERITY_TONE = { info: "neutral", low: "neutral", medium: "warn", high: "bad" } as const;

/**
 * Renders an extracted field value the way a reviewer reads it rather than the
 * way it is stored. List items in the record schema are objects; each shape gets
 * a headline plus its qualifiers, so no queue or record view shows raw JSON.
 */
export function FieldValue({ fieldPath, value, compact = false, limit }: { fieldPath: string; value: unknown; compact?: boolean; limit?: number }) {
  if (value === null || value === undefined || value === "") return <span className="text-[var(--faint)]">Not stated</span>;
  const root = fieldPath.replace(/\[\d+\]$/, "");

  if (typeof value !== "object") {
    // Enum values are stored snake_case; show them as words without losing the exact value on hover.
    const text = root === "document_type" ? String(value).replaceAll("_", " ") : String(value);
    return (
      <span title={root === "document_type" ? String(value) : undefined} className={cn(root === "publication_date" && "tnum", root === "document_type" && "capitalize")}>
        {limit ? truncate(text, limit) : text}
      </span>
    );
  }
  const v = value as Record<string, unknown>;

  if (root === "monetary_amounts") {
    return (
      <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tnum font-semibold">{fmtMoney(v.amount as number, v.currency as string)}</span>
        {v.context ? <span className="min-w-0 text-[var(--muted)]">{limit ? truncate(String(v.context), limit) : String(v.context)}</span> : null}
      </span>
    );
  }

  if (root === "key_findings") {
    const severity = String(v.severity ?? "");
    return (
      <span className={cn("flex min-w-0 gap-2", compact ? "items-center" : "flex-col items-start")}>
        <span className="min-w-0">{limit ? truncate(String(v.finding ?? ""), limit) : String(v.finding ?? "")}</span>
        {severity ? (
          <Badge tone={SEVERITY_TONE[severity as keyof typeof SEVERITY_TONE] ?? "neutral"} className="shrink-0" title={`Severity stated in the document: ${severity}`}>
            {`${severity.charAt(0).toUpperCase()}${severity.slice(1)} severity`}
          </Badge>
        ) : null}
      </span>
    );
  }

  if (root === "recommendations") {
    const meta = [v.target_entity ? `Target: ${String(v.target_entity)}` : null, v.status_if_stated ? `Status: ${String(v.status_if_stated)}` : null].filter(Boolean).join(" · ");
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="min-w-0">{limit ? truncate(String(v.recommendation ?? ""), limit) : String(v.recommendation ?? "")}</span>
        {meta ? <span className="text-[12px] text-[var(--muted)]">{meta}</span> : <span className="text-[12px] text-[var(--faint)]">No target stated</span>}
      </span>
    );
  }

  if (root === "subject_entities") return <span>{String(v.name ?? "")}</span>;

  const summary = summarizeFieldValue(fieldPath, value);
  return <span>{limit ? truncate(summary, limit) : summary}</span>;
}
