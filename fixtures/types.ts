import type { ReportRecord } from "@/lib/schema/report";

/** One body section of a fixture document, rendered in order. */
export type BodySection = { heading: string; paragraphs: string[] };

/**
 * A deliberately uncertain or contradictory field. The record still holds the correct
 * value; this describes the naive reading a mock extractor should produce and what the
 * mock verifier should say about it.
 */
export type PlantedIssue = {
  field_path: string;
  kind: "contradiction" | "ambiguous_phrasing" | "weak_evidence" | "missing_evidence" | "formatting_variant";
  extractor_value: unknown;
  extractor_quote: string;
  verifier_status: "supported" | "partially_supported" | "unsupported";
  verifier_corrected_value?: unknown;
  note: string;
};

/** Ground truth for one version of one logical document (fixtures/ground-truth/<KEY>.v<N>.json). */
export type GroundTruth = {
  logical_key: string;
  version: number;
  format: "pdf" | "docx";
  filename: string;
  display_name: string;
  record: ReportRecord;
  evidence: Record<string, string>;
  planted: PlantedIssue[];
  body: BodySection[];
  page_hints?: number[];
};

export type ManifestExpectation = "processed" | "new_version" | "duplicate";

export type ManifestFile = {
  filename: string;
  ground_truth: string;
  expect: ManifestExpectation;
  supersedes?: string;
  duplicate_of?: string;
};

export type Manifest = { files: ManifestFile[] };

/** One golden RAG evaluation case (fixtures/eval/rag-questions.json). */
export type RagCase = {
  case_key: string;
  question: string;
  answerable: boolean;
  expected_documents: string[];
  expected_facts: string[];
  reference_answer: string;
  tags: string[];
};
