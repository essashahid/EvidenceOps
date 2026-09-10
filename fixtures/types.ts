import type { DocumentType, ReportRecord, Severity } from "@/lib/schema/report";

// ---------------------------------------------------------------------------------------------
// Emitted truth (fixtures/truth/<logical-key>-v<version>.json), spec section 10
// ---------------------------------------------------------------------------------------------

export type UncertainKind =
  | "missing_date"
  | "conflicting_amount"
  | "ambiguous_owner"
  | "abbreviation"
  | "duplicate_recommendation"
  | "abbreviated_date"
  | "negation"
  | "distractor_amount"
  | "weak_evidence"
  | "missing_evidence";

export type VerifierExpectation = {
  status: "supported" | "partially_supported" | "unsupported";
  corrected_value: unknown | null;
  contradiction_detected: boolean;
  evidence_specificity: 1 | 0.75 | 0.4 | 0;
};

export type UncertainField = {
  /** "monetary_amounts[0]", "publication_date", "recommendations[3]" (an index beyond the record's list means "an extractor may invent this item"). */
  field_path: string;
  kind: UncertainKind;
  reason: string;
  /** What a naive extractor would return (scalar value or full list-item object). */
  extractor_value: unknown;
  extractor_locators: string[];
  /** Must appear in the body unless kind === "missing_evidence". */
  extractor_quotes: string[];
  extractor_ambiguity: string | null;
  /** What the verifier should conclude. */
  verifier: VerifierExpectation;
  /** True when the field must land in review/blocked. */
  expect_routed: boolean;
};

export type Distractor = { kind: string; text: string; note: string };

export type BodySection = { heading: string; paragraphs: string[] };

export type Truth = {
  logical_key: string;
  version: number;
  format: "pdf" | "docx";
  filename: string;
  display_name: string;
  record: ReportRecord;
  /** For every non-null scalar and every list item: verbatim quotes and the resolved block locators that contain them. */
  evidence: Record<string, { locators: string[]; quotes: string[] }>;
  uncertain_fields: UncertainField[];
  distractors: Distractor[];
  /** Filenames that are byte-identical copies of this file. */
  expect_duplicate_files: string[];
  /** "<logical-key>-v1" for v2 files. */
  supersedes: string | null;
  /** "<logical-key>-v2" for v1 files that have a v2. */
  superseded_by: string | null;
  body: BodySection[];
  page_hints?: number[];
};

// ---------------------------------------------------------------------------------------------
// Manifest (fixtures/documents/manifest.json)
// ---------------------------------------------------------------------------------------------

export type ManifestExpectation = "processed" | "new_version" | "duplicate";

export type ManifestFile = {
  filename: string;
  truth: string;
  expect: ManifestExpectation;
  supersedes?: string;
  duplicate_of?: string;
};

export type Manifest = { files: ManifestFile[] };

// ---------------------------------------------------------------------------------------------
// Golden RAG set (fixtures/golden/rag-cases.json), spec section 28
// ---------------------------------------------------------------------------------------------

export type GoldenCategory = "single_document" | "cross_document" | "unanswerable";

export type GoldenRagCase = {
  case_key: string;
  category: GoldenCategory;
  question: string;
  /** Gold answer text; for unanswerable exactly "Insufficient evidence in the indexed corpus." */
  expected_answer: string;
  /** Logical keys whose CURRENT version holds the evidence ([] for unanswerable). */
  expected_documents: string[];
  /** Resolved locators (SRC-...) of the blocks holding the evidence. */
  expected_locators: string[];
  /** 1 to 3 short verbatim phrases that must appear in a correct answer ([] for unanswerable). */
  expected_facts: string[];
  tags: string[];
};

// ---------------------------------------------------------------------------------------------
// Source-of-truth definitions (fixtures/source/*.ts). These carry quotes but no locators; the
// generator renders, parses and resolves locators before emitting the JSON above.
// ---------------------------------------------------------------------------------------------

export type FindingSpec = { finding: string; severity: Severity; detail: string };

export type RecommendationSpec = {
  recommendation: string;
  target_entity: string | null;
  status_if_stated: string | null;
  /** Overrides the rendered "Target: ..." clause (used for ambiguous owners). */
  targetText?: string;
};

/** inBody: the evidence sentence already appears elsewhere in the body (e.g. an appendix correction), so it is not rendered again in Financial Impact. */
export type AmountSpec = { amount: number; currency: string; context: string; sentence: string; inBody?: boolean };

export type EntitySpec = { name: string; quote?: string };

/** Uncertain field as authored: extractor_locators are resolved by the generator. */
export type UncertainSpec = Omit<UncertainField, "extractor_locators">;

export type DocSpec = {
  key: string;
  format: "pdf" | "docx";
  /** Filename stem after "<key>-v<n>-" and without extension. */
  slug: string;
  display_name: string;
  title: string;
  org: string;
  /** Overrides the "Issued by <org>" line (used for abbreviation edge cases). */
  orgLine?: string;
  /** Rendered date line, or null when the title block has no date. */
  dateLine: string | null;
  dateIso: string | null;
  document_type: DocumentType;
  /** Phrase whose first containing sentence is the evidence for document_type. */
  typePhrase: string;
  entities: EntitySpec[];
  summary: string[];
  background: string[];
  findings: FindingSpec[];
  recommendations: RecommendationSpec[];
  financialIntro: string;
  amounts: AmountSpec[];
  financialExtra?: string[];
  appendix: string[];
  uncertain: UncertainSpec[];
  distractors: Distractor[];
  page_hints?: number[];
};

/** How a version-2 file differs from its version-1 spec. */
export type CorrectionSpec = {
  key: string;
  dateLine: string;
  dateIso: string;
  /** Verbatim text replacements applied to every paragraph (the changed monetary figure). */
  replacements: { from: string; to: string }[];
  /** Paragraph inserted at the top of the Executive Summary. */
  supersessionNote: string;
};

/** Golden case as authored: locators/documents are resolved from the facts. */
export type GoldenCaseSpec = {
  case_key: string;
  category: GoldenCategory;
  question: string;
  expected_answer: string;
  /** Each fact names the logical key whose current version contains it verbatim. */
  facts: { doc: string; text: string }[];
  tags: string[];
};
