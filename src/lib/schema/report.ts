import { z } from "zod";

/**
 * The extraction target: an operational-report record (spec section 15).
 * The extractor returns every scalar and every list item wrapped with provenance:
 * source_block_ids (display locators), evidence_quotes (verbatim) and ambiguity.
 */
export const DOCUMENT_TYPES = ["operational_review", "audit_report", "evaluation", "investigation", "guidance", "other"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const SEVERITIES = ["info", "low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const LIST_LIMITS = { subject_entities: 15, key_findings: 15, recommendations: 15, monetary_amounts: 20 } as const;

const provenance = {
  source_block_ids: z.array(z.string()).describe("Display locators of the cited source blocks, e.g. SRC-OPS-2026-004-V1-P02"),
  evidence_quotes: z.array(z.string()).describe("Short verbatim quotes copied from the cited blocks"),
  ambiguity: z.string().nullable().describe("Why the value is uncertain, or null"),
};

const scalar = <T extends z.ZodTypeAny>(value: T) => z.object({ value, ...provenance });

export const extractionOutputSchema = z.object({
  report_title: scalar(z.string().nullable()),
  report_number: scalar(z.string().nullable()),
  issuing_organization: scalar(z.string().nullable()),
  publication_date: scalar(z.string().nullable().describe("YYYY-MM-DD or null")),
  document_type: scalar(z.enum(DOCUMENT_TYPES)),
  subject_entities: z.array(z.object({ name: z.string(), ...provenance })),
  key_findings: z.array(z.object({ finding: z.string(), severity: z.enum(SEVERITIES), ...provenance })),
  recommendations: z.array(z.object({ recommendation: z.string(), target_entity: z.string().nullable(), status_if_stated: z.string().nullable(), ...provenance })),
  monetary_amounts: z.array(z.object({ amount: z.number(), currency: z.string(), context: z.string(), ...provenance })),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type Provenance = { source_block_ids: string[]; evidence_quotes: string[]; ambiguity: string | null };

/** Plain business record without provenance (record_versions.payload_json, fixtures/truth). */
export const subjectEntitySchema = z.object({ name: z.string() });
export const keyFindingSchema = z.object({ finding: z.string(), severity: z.enum(SEVERITIES) });
export const recommendationSchema = z.object({ recommendation: z.string(), target_entity: z.string().nullable(), status_if_stated: z.string().nullable() });
export const monetaryAmountSchema = z.object({ amount: z.number(), currency: z.string(), context: z.string() });

export const reportRecordSchema = z.object({
  report_title: z.string().nullable(),
  report_number: z.string().nullable(),
  issuing_organization: z.string().nullable(),
  publication_date: z.string().nullable(),
  document_type: z.enum(DOCUMENT_TYPES).nullable(),
  // list items are nullable because a reviewer may reject an item
  subject_entities: z.array(subjectEntitySchema.nullable()),
  key_findings: z.array(keyFindingSchema.nullable()),
  recommendations: z.array(recommendationSchema.nullable()),
  monetary_amounts: z.array(monetaryAmountSchema.nullable()),
});
export type ReportRecord = z.infer<typeof reportRecordSchema>;

export const SCALAR_FIELDS = ["report_title", "report_number", "issuing_organization", "publication_date", "document_type"] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];
export const LIST_FIELDS = ["subject_entities", "key_findings", "recommendations", "monetary_amounts"] as const;
export type ListField = (typeof LIST_FIELDS)[number];

export const LIST_ITEM_KEYS: Record<ListField, readonly string[]> = {
  subject_entities: ["name"],
  key_findings: ["finding", "severity"],
  recommendations: ["recommendation", "target_entity", "status_if_stated"],
  monetary_amounts: ["amount", "currency", "context"],
};

/** Key used to match list items between two records (diffs, eval F1). */
export const LIST_MATCH_KEY: Record<ListField, string> = {
  subject_entities: "name",
  key_findings: "finding",
  recommendations: "recommendation",
  monetary_amounts: "amount",
};

/** No field is strictly required by the schema (nulls are legal), but these are the ones the record is useless without. */
export const CORE_FIELDS: ReadonlySet<string> = new Set(["report_title", "issuing_organization", "document_type"]);

export type FieldKind = "string" | "date" | "enum" | "item";

export function fieldKind(fieldPath: string): FieldKind {
  if (fieldPath === "publication_date") return "date";
  if (fieldPath === "document_type") return "enum";
  if (/\[\d+\]$/.test(fieldPath)) return "item";
  return "string";
}

/** One reviewable unit: a scalar field or a whole list item, with its provenance. */
export type LeafField = { fieldPath: string; value: unknown; provenance: Provenance; core: boolean };

export function flattenExtraction(out: ExtractionOutput): LeafField[] {
  const leaves: LeafField[] = [];
  for (const f of SCALAR_FIELDS) {
    const s = out[f];
    leaves.push({ fieldPath: f, value: s.value, provenance: { source_block_ids: s.source_block_ids, evidence_quotes: s.evidence_quotes, ambiguity: s.ambiguity }, core: CORE_FIELDS.has(f) });
  }
  for (const f of LIST_FIELDS) {
    const items = out[f] as Array<Record<string, unknown> & Provenance>;
    items.forEach((item, i) => {
      const value: Record<string, unknown> = {};
      for (const k of LIST_ITEM_KEYS[f]) value[k] = item[k];
      leaves.push({ fieldPath: `${f}[${i}]`, value, provenance: { source_block_ids: item.source_block_ids, evidence_quotes: item.evidence_quotes, ambiguity: item.ambiguity }, core: false });
    });
  }
  return leaves;
}

export function toRecord(out: ExtractionOutput): ReportRecord {
  return {
    report_title: out.report_title.value,
    report_number: out.report_number.value,
    issuing_organization: out.issuing_organization.value,
    publication_date: out.publication_date.value,
    document_type: out.document_type.value,
    subject_entities: out.subject_entities.map((e) => ({ name: e.name })),
    key_findings: out.key_findings.map((e) => ({ finding: e.finding, severity: e.severity })),
    recommendations: out.recommendations.map((e) => ({ recommendation: e.recommendation, target_entity: e.target_entity, status_if_stated: e.status_if_stated })),
    monetary_amounts: out.monetary_amounts.map((e) => ({ amount: e.amount, currency: e.currency, context: e.context })),
  };
}

export function parseFieldPath(fieldPath: string): { root: string; index: number | null } {
  const m = /^([a-z_]+)(?:\[(\d+)\])?$/.exec(fieldPath);
  if (!m) throw new Error(`invalid field path: ${fieldPath}`);
  return { root: m[1]!, index: m[2] !== undefined ? Number(m[2]) : null };
}

export function getFieldValue(record: ReportRecord, fieldPath: string): unknown {
  const { root, index } = parseFieldPath(fieldPath);
  const rootVal = (record as Record<string, unknown>)[root];
  if (index === null) return rootVal;
  return (rootVal as unknown[] | undefined)?.[index];
}

/** Return a new record with one field (scalar or list item) replaced. */
export function setFieldValue(record: ReportRecord, fieldPath: string, value: unknown): ReportRecord {
  const next = structuredClone(record) as unknown as Record<string, unknown>;
  const { root, index } = parseFieldPath(fieldPath);
  if (index === null) next[root] = value;
  else {
    const arr = next[root] as unknown[];
    while (arr.length <= index) arr.push(null);
    arr[index] = value;
  }
  return next as unknown as ReportRecord;
}

export const EMPTY_RECORD: ReportRecord = {
  report_title: null,
  report_number: null,
  issuing_organization: null,
  publication_date: null,
  document_type: null,
  subject_entities: [],
  key_findings: [],
  recommendations: [],
  monetary_amounts: [],
};

export function fieldLabel(fieldPath: string): string {
  return fieldPath.replace(/\[(\d+)\]/g, (_, i) => ` #${Number(i) + 1}`).replace(/_/g, " ");
}

/** Definitions shown to the verifier and in the UI. */
export const FIELD_DEFINITIONS: Record<string, string> = {
  report_title: "The full title of the report as printed in its title block.",
  report_number: "The report identifier printed in the title block (e.g. OPS-2026-004 or OPS-2026-004-R1).",
  issuing_organization: "The organization that issued or authored the report.",
  publication_date: "The publication date of this edition as an ISO date YYYY-MM-DD, only when the document gives enough information to determine the exact date.",
  document_type: `One of ${DOCUMENT_TYPES.join(", ")}.`,
  subject_entities: "A named organization, facility, program, vendor or system the report is about.",
  key_findings: "One finding stated in the report with its stated severity (info, low, medium, high).",
  recommendations: "One recommendation stated in the report, the entity it targets if stated, and its status if stated.",
  monetary_amounts: "A monetary amount stated in the report as a number, its ISO currency code, and what it refers to.",
};

export function fieldDefinition(fieldPath: string): string {
  return FIELD_DEFINITIONS[parseFieldPath(fieldPath).root] ?? "";
}

export function enumValuesFor(fieldPath: string): readonly string[] | null {
  return fieldPath === "document_type" ? DOCUMENT_TYPES : null;
}
