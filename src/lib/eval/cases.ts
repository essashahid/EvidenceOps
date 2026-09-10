import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/lib/db/client";
import { sql } from "drizzle-orm";

export type RagCase = {
  case_key: string;
  question: string;
  answerable: boolean;
  expected_documents: string[];
  expected_facts: string[];
  reference_answer: string;
  tags: string[];
};

export type ManifestFile = {
  filename: string;
  ground_truth: string;
  expect: "processed" | "new_version" | "duplicate";
  supersedes?: string;
  duplicate_of?: string;
};

export type CorpusManifest = { files: ManifestFile[] };

export const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures");

export function loadManifest(): CorpusManifest {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "manifest.json"), "utf8")) as CorpusManifest;
}

export function loadRagCases(): RagCase[] {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "eval/rag-questions.json"), "utf8")) as RagCase[];
}

export type GroundTruthFile = {
  logical_key: string;
  version: number;
  format: "pdf" | "docx";
  filename: string;
  display_name: string;
  record: import("@/lib/schema/report").ReportRecord;
  evidence: Record<string, string>;
  planted: { field_path: string; kind: string; note: string; verifier_status: string }[];
};

export function loadGroundTruthFiles(): Map<string, GroundTruthFile> {
  const dir = path.join(FIXTURES_DIR, "ground-truth");
  const out = new Map<string, GroundTruthFile>();
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const gt = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as GroundTruthFile;
    out.set(`${gt.logical_key}.v${gt.version}`, gt);
  }
  return out;
}

/**
 * Upsert the golden evaluation cases into eval_cases from the fixture files:
 * one extraction + provenance + classification + review_routing case per document version,
 * duplicate/version cases from the manifest, and retrieval/answer/refusal cases from the RAG set.
 */
export async function seedEvalCases(): Promise<number> {
  const db = getDb();
  const rows: (typeof schema.evalCases.$inferInsert)[] = [];
  const truths = loadGroundTruthFiles();
  for (const [key, gt] of truths) {
    rows.push({ caseKey: `extract:${key}`, caseType: "extraction", documentLogicalKey: gt.logical_key, expectedJson: { version: gt.version, record: gt.record }, tags: ["extraction", gt.format] });
    rows.push({ caseKey: `provenance:${key}`, caseType: "provenance", documentLogicalKey: gt.logical_key, expectedJson: { version: gt.version, evidence: gt.evidence }, tags: ["provenance"] });
    rows.push({ caseKey: `classify:${key}`, caseType: "classification", documentLogicalKey: gt.logical_key, expectedJson: { version: gt.version, document_type: gt.record.document_type }, tags: ["classification"] });
    rows.push({
      caseKey: `review:${key}`,
      caseType: "review_routing",
      documentLogicalKey: gt.logical_key,
      expectedJson: { version: gt.version, planted: gt.planted.map((p) => ({ field_path: p.field_path, kind: p.kind, verifier_status: p.verifier_status })) },
      tags: ["review"],
    });
  }
  let manifest: CorpusManifest | null = null;
  try {
    manifest = loadManifest();
  } catch {
    manifest = null;
  }
  for (const f of manifest?.files ?? []) {
    if (f.expect === "duplicate") rows.push({ caseKey: `duplicate:${f.filename}`, caseType: "duplicate", expectedJson: { filename: f.filename, duplicate_of: f.duplicate_of }, tags: ["duplicate"] });
    if (f.expect === "new_version") rows.push({ caseKey: `version:${f.ground_truth}`, caseType: "version", documentLogicalKey: f.ground_truth.split(".v")[0], expectedJson: { filename: f.filename, supersedes: f.supersedes }, tags: ["version"] });
  }
  let rag: RagCase[] = [];
  try {
    rag = loadRagCases();
  } catch {
    rag = [];
  }
  for (const c of rag) {
    if (c.answerable) {
      rows.push({ caseKey: `retrieval:${c.case_key}`, caseType: "retrieval", question: c.question, expectedJson: { expected_documents: c.expected_documents }, tags: c.tags });
      rows.push({ caseKey: `answer:${c.case_key}`, caseType: "answer", question: c.question, expectedJson: { expected_documents: c.expected_documents, expected_facts: c.expected_facts, reference_answer: c.reference_answer }, tags: c.tags });
    } else {
      rows.push({ caseKey: `refusal:${c.case_key}`, caseType: "refusal", question: c.question, expectedJson: { answerable: false, reference_answer: c.reference_answer }, tags: c.tags });
    }
  }
  for (const r of rows) {
    await db
      .insert(schema.evalCases)
      .values(r)
      .onConflictDoUpdate({
        target: schema.evalCases.caseKey,
        set: { caseType: r.caseType, question: r.question ?? null, documentLogicalKey: r.documentLogicalKey ?? null, expectedJson: r.expectedJson, tags: r.tags ?? [], active: sql`true` },
      });
  }
  return rows.length;
}
