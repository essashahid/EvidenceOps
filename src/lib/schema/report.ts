import { z } from "zod";

/**
 * The demo extraction target: an operational report record. Every leaf value the
 * model produces must be accompanied by evidence (a source locator plus a verbatim quote).
 */
export const DOCUMENT_TYPES = [
  "operational_review",
  "audit_report",
  "incident_report",
  "financial_review",
  "compliance_assessment",
  "project_status_report",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ENTITY_TYPES = ["organization", "facility", "program", "vendor", "system", "person"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "PKR", "AED"] as const;

export const LIST_LIMITS = {
  subject_entities: 10,
  key_findings: 12,
  recommendations: 12,
  monetary_amounts: 15,
} as const;

/** Evidence reference emitted by the extractor for each leaf value. */
export const evidenceRefSchema = z.object({
  locator: z.string().describe("Source block locator exactly as shown in the input, e.g. SRC-OPS-2026-004-V1-P02"),
  quote: z.string().describe("Verbatim quote from that source block that supports the value"),
});
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

const withEvidence = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value, evidence: evidenceRefSchema });

/** Extractor output shape: each leaf carries its own evidence. */
export const extractionOutputSchema = z.object({
  report_title: withEvidence(z.string()),
  report_number: withEvidence(z.string()),
  issuing_organization: withEvidence(z.string()),
  publication_date: withEvidence(z.string().describe("ISO date YYYY-MM-DD")),
  document_type: withEvidence(z.enum(DOCUMENT_TYPES)),
  subject_entities: z.array(
    z.object({
      name: withEvidence(z.string()),
      entity_type: withEvidence(z.enum(ENTITY_TYPES)),
    }),
  ),
  key_findings: z.array(
    z.object({
      text: withEvidence(z.string()),
      severity: withEvidence(z.enum(SEVERITIES)),
    }),
  ),
  recommendations: z.array(
    z.object({
      text: withEvidence(z.string()),
      priority: withEvidence(z.enum(PRIORITIES)),
    }),
  ),
  monetary_amounts: z.array(
    z.object({
      amount: withEvidence(z.number()),
      currency: withEvidence(z.enum(CURRENCIES)),
      label: withEvidence(z.string()),
    }),
  ),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/** Plain business record (no evidence) as stored in record_versions.payload_json and fixtures. */
export const reportRecordSchema = z.object({
  report_title: z.string().nullable(),
  report_number: z.string().nullable(),
  issuing_organization: z.string().nullable(),
  publication_date: z.string().nullable(),
  document_type: z.enum(DOCUMENT_TYPES).nullable(),
  // List item leaves are nullable because a reviewer may reject a single leaf value.
  subject_entities: z.array(z.object({ name: z.string().nullable(), entity_type: z.enum(ENTITY_TYPES).nullable() })),
  key_findings: z.array(z.object({ text: z.string().nullable(), severity: z.enum(SEVERITIES).nullable() })),
  recommendations: z.array(z.object({ text: z.string().nullable(), priority: z.enum(PRIORITIES).nullable() })),
  monetary_amounts: z.array(z.object({ amount: z.number().nullable(), currency: z.enum(CURRENCIES).nullable(), label: z.string().nullable() })),
});
export type ReportRecord = z.infer<typeof reportRecordSchema>;

export const SCALAR_FIELDS = [
  "report_title",
  "report_number",
  "issuing_organization",
  "publication_date",
  "document_type",
] as const;
export type ScalarField = (typeof SCALAR_FIELDS)[number];

export const LIST_FIELDS = ["subject_entities", "key_findings", "recommendations", "monetary_amounts"] as const;
export type ListField = (typeof LIST_FIELDS)[number];

export const LIST_ITEM_KEYS: Record<ListField, readonly string[]> = {
  subject_entities: ["name", "entity_type"],
  key_findings: ["text", "severity"],
  recommendations: ["text", "priority"],
  monetary_amounts: ["amount", "currency", "label"],
};

/** Field used to match list items between two records (for diffs and eval F1). */
export const LIST_MATCH_KEY: Record<ListField, string> = {
  subject_entities: "name",
  key_findings: "text",
  recommendations: "text",
  monetary_amounts: "label",
};

export const REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  "report_title",
  "report_number",
  "issuing_organization",
  "publication_date",
  "document_type",
]);

export type FieldKind = "string" | "date" | "enum" | "number";

export function fieldKind(fieldPath: string): FieldKind {
  const leaf = fieldPath.replace(/^.*\./, "");
  if (leaf === "publication_date") return "date";
  if (leaf === "amount") return "number";
  if (["document_type", "entity_type", "severity", "priority", "currency"].includes(leaf)) return "enum";
  return "string";
}

export function enumValuesFor(fieldPath: string): readonly string[] | null {
  const leaf = fieldPath.replace(/^.*\./, "");
  switch (leaf) {
    case "document_type":
      return DOCUMENT_TYPES;
    case "entity_type":
      return ENTITY_TYPES;
    case "severity":
      return SEVERITIES;
    case "priority":
      return PRIORITIES;
    case "currency":
      return CURRENCIES;
    default:
      return null;
  }
}

export type LeafField = { fieldPath: string; value: unknown; evidence: EvidenceRef; required: boolean };

/** Flatten an extraction output into leaf fields with paths like `key_findings[2].severity`. */
export function flattenExtraction(out: ExtractionOutput): LeafField[] {
  const leaves: LeafField[] = [];
  for (const f of SCALAR_FIELDS) {
    const leaf = out[f];
    leaves.push({ fieldPath: f, value: leaf.value, evidence: leaf.evidence, required: REQUIRED_FIELDS.has(f) });
  }
  for (const f of LIST_FIELDS) {
    const items = out[f] as Array<Record<string, { value: unknown; evidence: EvidenceRef }>>;
    items.forEach((item, i) => {
      for (const key of LIST_ITEM_KEYS[f]) {
        const leaf = item[key];
        if (!leaf) continue;
        leaves.push({ fieldPath: `${f}[${i}].${key}`, value: leaf.value, evidence: leaf.evidence, required: false });
      }
    });
  }
  return leaves;
}

/** Strip evidence from an extraction output to obtain the plain record. */
export function toRecord(out: ExtractionOutput): ReportRecord {
  return {
    report_title: out.report_title.value,
    report_number: out.report_number.value,
    issuing_organization: out.issuing_organization.value,
    publication_date: out.publication_date.value,
    document_type: out.document_type.value,
    subject_entities: out.subject_entities.map((e) => ({ name: e.name.value, entity_type: e.entity_type.value })),
    key_findings: out.key_findings.map((e) => ({ text: e.text.value, severity: e.severity.value })),
    recommendations: out.recommendations.map((e) => ({ text: e.text.value, priority: e.priority.value })),
    monetary_amounts: out.monetary_amounts.map((e) => ({
      amount: e.amount.value,
      currency: e.currency.value,
      label: e.label.value,
    })),
  };
}

export function parseFieldPath(fieldPath: string): { root: string; index: number | null; key: string | null } {
  const m = /^([a-z_]+)(?:\[(\d+)\]\.([a-z_]+))?$/.exec(fieldPath);
  if (!m) throw new Error(`invalid field path: ${fieldPath}`);
  return { root: m[1]!, index: m[2] !== undefined ? Number(m[2]) : null, key: m[3] ?? null };
}

export function getFieldValue(record: ReportRecord, fieldPath: string): unknown {
  const { root, index, key } = parseFieldPath(fieldPath);
  const rootVal = (record as Record<string, unknown>)[root];
  if (index === null) return rootVal;
  const arr = rootVal as Array<Record<string, unknown>> | undefined;
  const item = arr?.[index];
  return item && key ? item[key] : undefined;
}

/** Return a new record with one leaf updated (null removes a scalar; null on a list item leaf nulls that key). */
export function setFieldValue(record: ReportRecord, fieldPath: string, value: unknown): ReportRecord {
  const next = structuredClone(record) as unknown as Record<string, unknown>;
  const { root, index, key } = parseFieldPath(fieldPath);
  if (index === null) {
    next[root] = value;
  } else {
    const arr = next[root] as Array<Record<string, unknown>>;
    const item = arr[index];
    if (item && key) item[key] = value;
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

/** Human labels for the UI. */
export function fieldLabel(fieldPath: string): string {
  return fieldPath
    .replace(/\[(\d+)\]/g, (_, i) => ` #${Number(i) + 1}`)
    .replace(/\./g, " › ")
    .replace(/_/g, " ");
}
