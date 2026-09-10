import { canonical, findQuote, normalizeText } from "@/lib/text";
import { LIST_LIMITS, REQUIRED_FIELDS, enumValuesFor, fieldKind, parseFieldPath, type LeafField } from "@/lib/schema/report";
import type { ValidationMessage } from "@/lib/db/schema";

export type BlockLookup = Map<string, { id: string; normalizedText: string }>;

export type FieldValidation = {
  fieldPath: string;
  messages: ValidationMessage[];
  /** 1 = all validators pass, 0.5 = only non-critical warnings, 0 = a validation error. */
  deterministicScore: 1 | 0.5 | 0;
  /** 1 when the normalized evidence quote occurs exactly inside the cited block. */
  evidenceExactMatch: 0 | 1;
  locatorExists: boolean;
  sourceBlockId: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
};

function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Deterministic validation. Runs before any confidence is calculated so that model
 * quality is never the only quality layer.
 */
export function validateFields(leaves: LeafField[], blocks: BlockLookup): FieldValidation[] {
  const seen = new Map<string, number>(); // duplicate detection per list root
  return leaves.map((leaf) => {
    const messages: ValidationMessage[] = [];
    const { root, index } = parseFieldPath(leaf.fieldPath);
    const kind = fieldKind(leaf.fieldPath);
    const value = leaf.value;
    const empty = value === null || value === undefined || (typeof value === "string" && value.trim() === "");

    if (REQUIRED_FIELDS.has(leaf.fieldPath) && empty) {
      messages.push({ level: "error", code: "required_missing", message: "required field is empty" });
    }
    if (!empty) {
      if (kind === "enum") {
        const allowed = enumValuesFor(leaf.fieldPath) ?? [];
        if (!allowed.includes(String(value))) messages.push({ level: "error", code: "enum_invalid", message: `value must be one of ${allowed.join(", ")}` });
      }
      if (kind === "date" && !isIsoDate(value)) {
        messages.push({ level: "error", code: "date_invalid", message: "value is not a valid ISO date" });
      } else if (kind === "date") {
        const year = Number(String(value).slice(0, 4));
        if (year < 1990 || year > 2100) messages.push({ level: "error", code: "date_implausible", message: "date is outside the plausible range" });
      }
      if (kind === "number") {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) messages.push({ level: "error", code: "number_invalid", message: "value is not a number" });
        else if (n <= 0) messages.push({ level: "error", code: "amount_nonpositive", message: "monetary amount must be positive" });
        else if (n > 1e12) messages.push({ level: "error", code: "amount_implausible", message: "monetary amount is implausibly large" });
      }
      if (kind === "string" && typeof value === "string" && value.length > 600) {
        messages.push({ level: "warning", code: "string_long", message: "value is unusually long for this field" });
      }
    }
    if (index !== null) {
      const limit = LIST_LIMITS[root as keyof typeof LIST_LIMITS];
      if (limit !== undefined && index >= limit) messages.push({ level: "warning", code: "list_overflow", message: `list exceeds the maximum of ${limit} items` });
      // duplicate list items: same canonical value for the item's match key
      if (/\.(name|text|label)$/.test(leaf.fieldPath) && !empty) {
        const key = `${root}:${canonical(value)}`;
        const prior = seen.get(key);
        if (prior !== undefined && prior !== index) messages.push({ level: "warning", code: "duplicate_item", message: `duplicate of item #${prior + 1}` });
        else seen.set(key, index);
      }
    }

    const block = blocks.get(leaf.evidence.locator);
    let evidenceExactMatch: 0 | 1 = 0;
    let quoteStart: number | null = null;
    let quoteEnd: number | null = null;
    if (!block) {
      messages.push({ level: "error", code: "evidence_locator_unknown", message: `cited locator ${leaf.evidence.locator} does not exist` });
    } else {
      const found = findQuote(block.normalizedText, leaf.evidence.quote);
      if (found) {
        evidenceExactMatch = 1;
        quoteStart = found.start;
        quoteEnd = found.end;
      } else {
        messages.push({ level: "warning", code: "evidence_quote_missing", message: "cited quote does not appear verbatim in the cited block" });
      }
      if (!normalizeText(leaf.evidence.quote)) messages.push({ level: "error", code: "evidence_quote_empty", message: "evidence quote is empty" });
    }

    const hasError = messages.some((m) => m.level === "error");
    const hasWarning = messages.some((m) => m.level === "warning");
    return {
      fieldPath: leaf.fieldPath,
      messages,
      deterministicScore: hasError ? 0 : hasWarning ? 0.5 : 1,
      evidenceExactMatch,
      locatorExists: Boolean(block),
      sourceBlockId: block?.id ?? null,
      quoteStart,
      quoteEnd,
    };
  });
}
