import { canonical, findQuote, normalizeText } from "@/lib/text";
import { DOCUMENT_TYPES, LIST_LIMITS, SEVERITIES, fieldKind, parseFieldPath, type LeafField } from "@/lib/schema/report";
import type { ValidationMessage } from "@/lib/db/schema";

export type BlockLookup = Map<string, { id: string; normalizedText: string }>;

export type EvidenceCheck = { quote: string; sourceBlockId: string | null; locator: string; exactMatch: boolean; quoteStart: number | null; quoteEnd: number | null };

export type FieldValidation = {
  fieldPath: string;
  messages: ValidationMessage[];
  /** 1 all validators pass, 0.5 non-critical warnings only, 0 material failure. */
  deterministicScore: 1 | 0.5 | 0;
  /** 1 when every cited quote occurs verbatim (normalized) in one of the cited blocks. */
  evidenceExactMatch: 0 | 1;
  /** All cited source_block_ids resolve to real blocks of this version. */
  locatorsExist: boolean;
  evidence: EvidenceCheck[];
};

function isIsoDate(v: unknown): boolean {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

/** Deterministic validation (spec section 17). Runs before confidence and before any routing. */
export function validateFields(leaves: LeafField[], blocks: BlockLookup): FieldValidation[] {
  const seen = new Map<string, number>();
  return leaves.map((leaf) => {
    const messages: ValidationMessage[] = [];
    const err = (code: string, message: string) => messages.push({ level: "error", code, message });
    const warn = (code: string, message: string) => messages.push({ level: "warning", code, message });
    const { root, index } = parseFieldPath(leaf.fieldPath);
    const kind = fieldKind(leaf.fieldPath);
    const value = leaf.value;
    const isNull = value === null || value === undefined || (typeof value === "string" && value.trim() === "");

    if (leaf.provenance.ambiguity) warn("ambiguous_value", leaf.provenance.ambiguity);

    // structure and type checks
    if (kind === "date" && !isNull) {
      if (!isIsoDate(value)) err("date_invalid", "publication_date must be YYYY-MM-DD");
      else {
        const year = Number(String(value).slice(0, 4));
        if (year < 1990 || year > 2100) err("date_implausible", "date is outside the plausible range");
      }
    }
    if (kind === "enum" && !isNull && !DOCUMENT_TYPES.includes(String(value) as (typeof DOCUMENT_TYPES)[number])) err("enum_invalid", `document_type must be one of ${DOCUMENT_TYPES.join(", ")}`);
    if (kind === "string" && !isNull && typeof value !== "string") err("type_invalid", "expected a string");
    if (kind === "string" && typeof value === "string" && value.length > 600) warn("string_long", "value is unusually long");
    if (kind === "item") {
      const item = (value ?? {}) as Record<string, unknown>;
      const limit = LIST_LIMITS[root as keyof typeof LIST_LIMITS];
      if (limit !== undefined && index !== null && index >= limit) warn("list_overflow", `list exceeds the maximum of ${limit} items`);
      switch (root) {
        case "subject_entities":
          if (typeof item.name !== "string" || !item.name.trim()) err("entity_name_missing", "entity name is required");
          break;
        case "key_findings":
          if (typeof item.finding !== "string" || !item.finding.trim()) err("finding_missing", "finding text is required");
          if (!SEVERITIES.includes(item.severity as (typeof SEVERITIES)[number])) err("severity_invalid", `severity must be one of ${SEVERITIES.join(", ")}`);
          break;
        case "recommendations":
          if (typeof item.recommendation !== "string" || !item.recommendation.trim()) err("recommendation_missing", "recommendation text is required");
          break;
        case "monetary_amounts": {
          const n = typeof item.amount === "number" ? item.amount : Number(item.amount);
          if (!Number.isFinite(n)) err("amount_invalid", "amount must be a number");
          else if (n <= 0) err("amount_nonpositive", "amount must be positive");
          else if (n > 1e12) err("amount_implausible", "amount is implausibly large");
          if (typeof item.currency !== "string" || !CURRENCY_RE.test(item.currency)) err("currency_invalid", "currency must be a three-letter ISO code");
          if (typeof item.context !== "string" || !item.context.trim()) warn("context_missing", "amount has no context");
          break;
        }
      }
      // repeated identical list items
      const matchKey = root === "monetary_amounts" ? `${item.amount}|${item.currency}` : canonical(String(item.name ?? item.finding ?? item.recommendation ?? ""));
      if (matchKey && matchKey !== "|") {
        const k = `${root}:${matchKey}`;
        const prior = seen.get(k);
        if (prior !== undefined && prior !== index) warn("duplicate_item", `repeats item #${prior + 1}`);
        else if (index !== null) seen.set(k, index);
      }
    }

    // provenance checks
    const evidence: EvidenceCheck[] = [];
    let locatorsExist = true;
    const cited = leaf.provenance.source_block_ids;
    const citedBlocks = cited.map((loc) => ({ loc, block: blocks.get(loc) ?? null }));
    for (const c of citedBlocks) if (!c.block) locatorsExist = false;
    if (!isNull) {
      if (cited.length === 0) err("evidence_missing", "non-null value cites no source block");
      if (!locatorsExist) err("evidence_locator_unknown", `cited source block does not exist: ${citedBlocks.filter((c) => !c.block).map((c) => c.loc).join(", ")}`);
      if (leaf.provenance.evidence_quotes.length === 0) err("evidence_quote_missing", "non-null value has no evidence quote");
    }
    for (const quote of leaf.provenance.evidence_quotes) {
      if (!normalizeText(quote)) {
        err("evidence_quote_empty", "evidence quote is empty");
        evidence.push({ quote, sourceBlockId: null, locator: cited[0] ?? "", exactMatch: false, quoteStart: null, quoteEnd: null });
        continue;
      }
      let hit: EvidenceCheck | null = null;
      for (const c of citedBlocks) {
        if (!c.block) continue;
        const found = findQuote(c.block.normalizedText, quote);
        if (found) {
          hit = { quote, sourceBlockId: c.block.id, locator: c.loc, exactMatch: true, quoteStart: found.start, quoteEnd: found.end };
          break;
        }
      }
      if (!hit) {
        const first = citedBlocks.find((c) => c.block);
        hit = { quote, sourceBlockId: first?.block?.id ?? null, locator: first?.loc ?? cited[0] ?? "", exactMatch: false, quoteStart: null, quoteEnd: null };
        warn("evidence_quote_not_found", "cited quote does not appear verbatim in the cited block(s)");
      }
      evidence.push(hit);
    }
    const evidenceExactMatch: 0 | 1 = evidence.length > 0 && evidence.every((e) => e.exactMatch) ? 1 : 0;

    const hasError = messages.some((m) => m.level === "error");
    const hasWarning = messages.some((m) => m.level === "warning");
    return { fieldPath: leaf.fieldPath, messages, deterministicScore: hasError ? 0 : hasWarning ? 0.5 : 1, evidenceExactMatch, locatorsExist, evidence };
  });
}
