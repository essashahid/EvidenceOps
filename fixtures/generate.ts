/**
 * Fixture generator for the EvidenceOps synthetic corpus.
 *
 * Reads fixtures/ground-truth/*.json, renders each document to PDF (pdf-lib) or DOCX (docx),
 * copies the manifest duplicates byte for byte, writes the "extras" (scanned-like, corrupt)
 * and then re-parses every generated file with the real pipeline parsers to prove that every
 * evidence quote and planted extractor quote is (or is not) recoverable from the parsed text.
 *
 * Run with: pnpm fixtures:generate
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parsePdf, parseDocx } from "@/lib/pipeline/parse";
import { normalizeText } from "@/lib/text";
import { LIST_FIELDS, LIST_ITEM_KEYS, SCALAR_FIELDS, reportRecordSchema, getFieldValue } from "@/lib/schema/report";
import { sha256 } from "@/lib/hash";
import type { GroundTruth, Manifest, RagCase } from "./types";

const FIXTURES_DIR = path.resolve(__dirname);
const GT_DIR = path.join(FIXTURES_DIR, "ground-truth");
const CORPUS_DIR = path.join(FIXTURES_DIR, "corpus");
const EXTRAS_DIR = path.join(FIXTURES_DIR, "extras");
const EVAL_FILE = path.join(FIXTURES_DIR, "eval", "rag-questions.json");
const MANIFEST_FILE = path.join(FIXTURES_DIR, "manifest.json");

/** Fixed timestamp so PDF output is byte-for-byte reproducible. */
const FIXED_DATE = new Date("2026-01-15T09:00:00Z");

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const BODY_SIZE = 11;
const BODY_LEADING = 14;
const HEADING_SIZE = 13;
const HEADING_LEADING = 17;
const PARAGRAPH_GAP = BODY_LEADING;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = MARGIN / 2;

const failures: string[] = [];
function fail(msg: string) {
  failures.push(msg);
}

// ---------------------------------------------------------------------------------------------
// Loading and static checks
// ---------------------------------------------------------------------------------------------

async function loadGroundTruth(): Promise<GroundTruth[]> {
  const names = (await fs.readdir(GT_DIR)).filter((n) => n.endsWith(".json")).sort();
  const docs: GroundTruth[] = [];
  for (const name of names) {
    const raw = await fs.readFile(path.join(GT_DIR, name), "utf8");
    const gt = JSON.parse(raw) as GroundTruth;
    const expectedName = `${gt.logical_key}.v${gt.version}.json`;
    if (name !== expectedName) fail(`${name}: file name does not match logical_key/version (${expectedName})`);
    const parsed = reportRecordSchema.safeParse(gt.record);
    if (!parsed.success) fail(`${name}: record does not satisfy reportRecordSchema: ${parsed.error.message}`);
    docs.push(gt);
  }
  return docs;
}

/** All leaf field paths of a record (scalars plus each list item key). */
function leafPaths(gt: GroundTruth): string[] {
  const out: string[] = [...SCALAR_FIELDS];
  for (const f of LIST_FIELDS) {
    const items = gt.record[f] as unknown[];
    items.forEach((_, i) => {
      for (const k of LIST_ITEM_KEYS[f]) out.push(`${f}[${i}].${k}`);
    });
  }
  return out;
}

function bodyParagraphs(gt: GroundTruth): string[] {
  const out: string[] = [];
  for (const s of gt.body) {
    out.push(s.heading);
    out.push(...s.paragraphs);
  }
  return out;
}

function wordCount(gt: GroundTruth): number {
  return bodyParagraphs(gt)
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function isAscii(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}

function staticChecks(gt: GroundTruth) {
  const tag = `${gt.logical_key}.v${gt.version}`;
  const paragraphs = bodyParagraphs(gt).map(normalizeText);
  for (const p of bodyParagraphs(gt)) {
    if (!isAscii(p)) fail(`${tag}: body contains non-ASCII or control characters: ${JSON.stringify(p.slice(0, 80))}`);
  }
  const leaves = leafPaths(gt);
  for (const fp of leaves) {
    const q = gt.evidence[fp];
    if (q === undefined) {
      fail(`${tag}: missing evidence for ${fp}`);
      continue;
    }
    if (/[\n\r]/.test(q)) fail(`${tag}: evidence for ${fp} contains a line break`);
    if (!isAscii(q)) fail(`${tag}: evidence for ${fp} is not plain ASCII`);
    const nq = normalizeText(q);
    if (!paragraphs.some((p) => p.includes(nq))) fail(`${tag}: evidence for ${fp} is not a substring of any body paragraph: ${JSON.stringify(q)}`);
    const value = getFieldValue(gt.record, fp);
    if (value === null || value === undefined) fail(`${tag}: ${fp} has evidence but the record value is null`);
  }
  for (const fp of Object.keys(gt.evidence)) {
    if (!leaves.includes(fp)) fail(`${tag}: evidence key ${fp} does not correspond to a record leaf`);
  }
  const sectionHeadings = gt.body.map((s) => s.heading);
  for (const required of ["Executive Summary", "Background", "Findings", "Recommendations", "Financial Impact", "Appendix"]) {
    if (!sectionHeadings.includes(required)) fail(`${tag}: body is missing the ${required} section`);
  }
  const findings = gt.record.key_findings.length;
  const recs = gt.record.recommendations.length;
  const amounts = gt.record.monetary_amounts.length;
  const entities = gt.record.subject_entities.length;
  if (findings < 3 || findings > 5) fail(`${tag}: expected 3 to 5 findings, got ${findings}`);
  if (recs < 2 || recs > 4) fail(`${tag}: expected 2 to 4 recommendations, got ${recs}`);
  if (amounts < 1 || amounts > 4) fail(`${tag}: expected 1 to 4 monetary amounts, got ${amounts}`);
  if (entities < 2 || entities > 5) fail(`${tag}: expected 2 to 5 subject entities, got ${entities}`);
  if (gt.planted.length > 2) fail(`${tag}: at most two planted issues per document (got ${gt.planted.length})`);
  for (const pi of gt.planted) {
    const found = paragraphs.some((p) => p.includes(normalizeText(pi.extractor_quote)));
    if (pi.kind === "missing_evidence" && found) fail(`${tag}: planted missing_evidence quote for ${pi.field_path} must NOT appear in the body`);
    if (pi.kind !== "missing_evidence" && !found) fail(`${tag}: planted ${pi.kind} quote for ${pi.field_path} does not appear in the body`);
  }
  const words = wordCount(gt);
  if (words < 450 || words > 1200) fail(`${tag}: body has ${words} words; expected roughly 500 to 1100`);
}

// ---------------------------------------------------------------------------------------------
// PDF rendering
// ---------------------------------------------------------------------------------------------

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type LayoutItem = { kind: "heading" | "paragraph"; lines: string[] };

async function renderPdf(gt: GroundTruth): Promise<{ bytes: Buffer; pages: number }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(gt.record.report_title ?? gt.display_name);
  doc.setAuthor(gt.record.issuing_organization ?? "");
  doc.setProducer("EvidenceOps fixtures");
  doc.setCreator("EvidenceOps fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const items: Array<LayoutItem & { forceBreak: boolean }> = [];
  gt.body.forEach((section, sectionIndex) => {
    const forceBreak = (gt.page_hints ?? []).includes(sectionIndex) && sectionIndex > 0;
    items.push({ kind: "heading", lines: wrapLine(section.heading, bold, HEADING_SIZE, TEXT_WIDTH), forceBreak });
    for (const p of section.paragraphs) items.push({ kind: "paragraph", lines: wrapLine(p, font, BODY_SIZE, TEXT_WIDTH), forceBreak: false });
  });

  const pages: PDFPage[] = [];
  let page: PDFPage | null = null;
  let y = 0;
  const bottom = MARGIN;
  const newPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
  };
  const heightOf = (item: LayoutItem) =>
    item.kind === "heading" ? item.lines.length * HEADING_LEADING : item.lines.length * BODY_LEADING;

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!page || item.forceBreak) newPage();
    const p = page as unknown as PDFPage;
    if (item.kind === "heading") {
      // Keep a heading with at least the first two lines of what follows it.
      const next = items[i + 1];
      const needed = heightOf(item) + (next ? Math.min(2, next.lines.length) * BODY_LEADING : 0);
      if (y - needed < bottom) {
        newPage();
      }
      const cur = page as unknown as PDFPage;
      for (const line of item.lines) {
        y -= HEADING_LEADING;
        cur.drawText(line, { x: MARGIN, y, size: HEADING_SIZE, font: bold, color: rgb(0, 0, 0) });
      }
      y -= PARAGRAPH_GAP / 2;
      continue;
    }
    const total = heightOf(item);
    let lines = item.lines;
    if (y - total < bottom && total <= PAGE_HEIGHT - MARGIN * 2) {
      // Paragraph fits on a fresh page: keep it whole.
      newPage();
    }
    while (lines.length > 0) {
      const cur = page as unknown as PDFPage;
      const capacity = Math.floor((y - bottom) / BODY_LEADING);
      if (capacity <= 0) {
        newPage();
        continue;
      }
      const chunk = lines.slice(0, capacity);
      lines = lines.slice(capacity);
      for (const line of chunk) {
        y -= BODY_LEADING;
        cur.drawText(line, { x: MARGIN, y, size: BODY_SIZE, font, color: rgb(0, 0, 0) });
      }
      if (lines.length > 0) newPage();
    }
    y -= PARAGRAPH_GAP;
    void p;
  }

  pages.forEach((pg, idx) => {
    const label = `Page ${idx + 1} of ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 9);
    pg.drawText(label, { x: PAGE_WIDTH - MARGIN - w, y: FOOTER_Y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  });

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, pages: pages.length };
}

// ---------------------------------------------------------------------------------------------
// DOCX rendering
// ---------------------------------------------------------------------------------------------

async function renderDocx(gt: GroundTruth): Promise<Buffer> {
  const children: Paragraph[] = [];
  gt.body.forEach((section, i) => {
    children.push(
      new Paragraph({
        heading: i === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
        children: [new TextRun(section.heading)],
      }),
    );
    for (const p of section.paragraphs) children.push(new Paragraph({ children: [new TextRun(p)] }));
  });
  const doc = new Document({
    creator: gt.record.issuing_organization ?? "EvidenceOps fixtures",
    title: gt.record.report_title ?? gt.display_name,
    description: "EvidenceOps synthetic fixture",
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------------------------

async function writeScannedLike(): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("EvidenceOps fixtures");
  doc.setCreator("EvidenceOps fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // Fake "scanned" content: a grey page frame and ruled lines with no extractable text.
    page.drawRectangle({ x: MARGIN, y: MARGIN, width: TEXT_WIDTH, height: PAGE_HEIGHT - MARGIN * 2, borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 1 });
    for (let i = 0; i < 28; i++) {
      const y = PAGE_HEIGHT - MARGIN - 40 - i * 22;
      const width = TEXT_WIDTH - 40 - ((i * 37 + p * 11) % 120);
      page.drawLine({ start: { x: MARGIN + 20, y }, end: { x: MARGIN + 20 + width, y }, thickness: 6, color: rgb(0.8, 0.8, 0.8) });
    }
    page.drawRectangle({ x: MARGIN + 20, y: MARGIN + 30, width: 180, height: 60, color: rgb(0.85, 0.85, 0.85) });
    page.drawText(`Scan ${p + 1}/3`, { x: MARGIN, y: FOOTER_Y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Deterministic pseudo-random bytes (LCG) so the corrupt file is stable across runs. */
function garbage(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = (state >>> 24) & 0xff;
  }
  return out;
}

function corruptPdf(): Buffer {
  return Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), garbage(2048, 0x5eed1234)]);
}

function corruptDocx(): Buffer {
  const line = "This file has a .docx extension but is not an OOXML zip archive.\n";
  return Buffer.from(line.repeat(24), "ascii");
}

// ---------------------------------------------------------------------------------------------
// Verification against the real parsers
// ---------------------------------------------------------------------------------------------

type Summary = {
  key: string;
  type: string;
  format: string;
  pages: string;
  words: number;
  evidence: number;
  planted: number;
  status: string;
};

async function verifyDocument(gt: GroundTruth, bytes: Buffer, pages: number | null): Promise<Summary> {
  const tag = `${gt.logical_key}.v${gt.version}`;
  const result = gt.format === "pdf" ? await parsePdf(bytes) : await parseDocx(bytes);
  let status = "ok";
  if (result.status !== "parsed") {
    fail(`${tag}: parser returned ${result.status} for ${gt.filename}`);
    status = result.status;
  } else {
    const blocks = result.blocks.map((b) => b.normalizedText);
    for (const [fp, quote] of Object.entries(gt.evidence)) {
      const nq = normalizeText(quote);
      const hits = blocks.filter((b) => b.includes(nq)).length;
      if (hits === 0) {
        fail(`${tag}: evidence quote for ${fp} not found in any parsed block of ${gt.filename}: ${JSON.stringify(quote)}`);
        status = "evidence-miss";
      }
    }
    for (const pi of gt.planted) {
      const nq = normalizeText(pi.extractor_quote);
      const found = blocks.some((b) => b.includes(nq));
      if (pi.kind === "missing_evidence" && found) {
        fail(`${tag}: planted missing_evidence quote for ${pi.field_path} was found in parsed text of ${gt.filename}`);
        status = "planted-miss";
      } else if (pi.kind !== "missing_evidence" && !found) {
        fail(`${tag}: planted ${pi.kind} quote for ${pi.field_path} not found in parsed text of ${gt.filename}`);
        status = "planted-miss";
      }
    }
    if (gt.format === "pdf") {
      const pc = result.pageCount ?? 0;
      if (pc < 2 || pc > 6) {
        fail(`${tag}: ${gt.filename} has ${pc} pages; expected 2 to 6`);
        status = "page-count";
      }
      if (pages !== null && pc !== pages) fail(`${tag}: rendered ${pages} pages but parser saw ${pc}`);
    }
  }
  return {
    key: tag,
    type: gt.record.document_type ?? "?",
    format: gt.format,
    pages: pages === null ? "-" : String(pages),
    words: wordCount(gt),
    evidence: Object.keys(gt.evidence).length,
    planted: gt.planted.length,
    status,
  };
}

async function verifyExtras() {
  const scanned = await parsePdf(await fs.readFile(path.join(EXTRAS_DIR, "scanned-like.pdf")));
  if (scanned.status !== "unsupported" || scanned.reason !== "unsupported_scanned_document") {
    fail(`extras/scanned-like.pdf: expected status unsupported (scanned), got ${JSON.stringify(scanned.status)}`);
  }
  const badPdf = await parsePdf(await fs.readFile(path.join(EXTRAS_DIR, "corrupt.pdf")));
  if (badPdf.status !== "failed") fail(`extras/corrupt.pdf: expected status failed, got ${badPdf.status}`);
  const badDocx = await parseDocx(await fs.readFile(path.join(EXTRAS_DIR, "corrupt.docx")));
  if (badDocx.status !== "failed") fail(`extras/corrupt.docx: expected status failed, got ${badDocx.status}`);
  return {
    scanned: scanned.status === "unsupported" ? `${scanned.status}/${scanned.reason}` : scanned.status,
    corruptPdf: badPdf.status,
    corruptDocx: badDocx.status,
  };
}

async function verifyManifest(manifest: Manifest, docs: GroundTruth[]) {
  const byKey = new Map(docs.map((d) => [`${d.logical_key}.v${d.version}`, d]));
  const seen: string[] = [];
  const seenGt = new Set<string>();
  let pdfs = 0;
  let docxs = 0;
  if (manifest.files.length !== 20) fail(`manifest: expected 20 files, got ${manifest.files.length}`);
  for (const entry of manifest.files) {
    const gt = byKey.get(entry.ground_truth);
    if (!gt) {
      fail(`manifest: ${entry.filename} references unknown ground truth ${entry.ground_truth}`);
      continue;
    }
    if (entry.filename.endsWith(".pdf")) pdfs++;
    else if (entry.filename.endsWith(".docx")) docxs++;
    else fail(`manifest: ${entry.filename} has an unexpected extension`);
    const target = path.join(CORPUS_DIR, entry.filename);
    let exists = true;
    try {
      await fs.access(target);
    } catch {
      exists = false;
      fail(`manifest: ${entry.filename} was not generated`);
    }
    if (entry.expect === "duplicate") {
      if (!entry.duplicate_of) fail(`manifest: duplicate ${entry.filename} lacks duplicate_of`);
      else if (!seen.includes(entry.duplicate_of)) fail(`manifest: duplicate ${entry.filename} appears before its original ${entry.duplicate_of}`);
      else if (exists) {
        const a = sha256(await fs.readFile(target));
        const b = sha256(await fs.readFile(path.join(CORPUS_DIR, entry.duplicate_of)));
        if (a !== b) fail(`manifest: duplicate ${entry.filename} is not byte-identical to ${entry.duplicate_of}`);
      }
    } else {
      if (entry.filename !== gt.filename) fail(`manifest: ${entry.filename} does not match ground truth filename ${gt.filename}`);
      if (seenGt.has(entry.ground_truth)) fail(`manifest: ${entry.ground_truth} is listed twice as a non-duplicate`);
      seenGt.add(entry.ground_truth);
    }
    if (entry.expect === "new_version") {
      if (!entry.supersedes) fail(`manifest: new_version ${entry.filename} lacks supersedes`);
      else {
        const prev = byKey.get(entry.supersedes);
        if (!prev) fail(`manifest: ${entry.filename} supersedes unknown ${entry.supersedes}`);
        else if (!seen.includes(prev.filename)) fail(`manifest: ${entry.filename} appears before the version it supersedes (${prev.filename})`);
        if (gt.version < 2) fail(`manifest: new_version entry ${entry.filename} must be version 2 or later`);
      }
    }
    if (entry.expect === "processed" && gt.version !== 1) fail(`manifest: processed entry ${entry.filename} should be a version 1 document`);
    seen.push(entry.filename);
  }
  if (pdfs !== 16 || docxs !== 4) fail(`manifest: expected 16 PDFs and 4 DOCX, got ${pdfs} PDFs and ${docxs} DOCX`);
  for (const d of docs) {
    if (!seenGt.has(`${d.logical_key}.v${d.version}`)) fail(`manifest: ground truth ${d.logical_key}.v${d.version} is not listed`);
  }
}

async function verifyRagCases(docs: GroundTruth[]) {
  let cases: RagCase[];
  try {
    cases = JSON.parse(await fs.readFile(EVAL_FILE, "utf8")) as RagCase[];
  } catch (err) {
    fail(`eval/rag-questions.json could not be read: ${err instanceof Error ? err.message : String(err)}`);
    return { total: 0, answerable: 0 };
  }
  // Current version of each logical key.
  const current = new Map<string, GroundTruth>();
  for (const d of docs) {
    const prev = current.get(d.logical_key);
    if (!prev || prev.version < d.version) current.set(d.logical_key, d);
  }
  if (cases.length !== 40) fail(`eval: expected exactly 40 RAG cases, got ${cases.length}`);
  const keys = new Set<string>();
  let answerable = 0;
  for (const c of cases) {
    if (keys.has(c.case_key)) fail(`eval: duplicate case_key ${c.case_key}`);
    keys.add(c.case_key);
    if (c.answerable) {
      answerable++;
      if (c.expected_documents.length === 0) fail(`eval: ${c.case_key} is answerable but has no expected_documents`);
      if (c.expected_facts.length === 0) fail(`eval: ${c.case_key} is answerable but has no expected_facts`);
      const texts = c.expected_documents.map((k) => {
        const gt = current.get(k);
        if (!gt) fail(`eval: ${c.case_key} expects unknown document ${k}`);
        return gt ? normalizeText(bodyParagraphs(gt).join(" ")) : "";
      });
      for (const fact of c.expected_facts) {
        const words = fact.split(/\s+/).length;
        if (words < 1 || words > 8) fail(`eval: ${c.case_key} fact ${JSON.stringify(fact)} should be 1 to 8 words`);
        if (!texts.some((t) => t.includes(normalizeText(fact)))) {
          fail(`eval: ${c.case_key} fact ${JSON.stringify(fact)} is not verbatim in the current body of ${c.expected_documents.join(", ")}`);
        }
      }
      for (const k of c.expected_documents) {
        const gt = current.get(k);
        if (!gt) continue;
        const text = normalizeText(bodyParagraphs(gt).join(" "));
        if (!c.expected_facts.some((f) => text.includes(normalizeText(f)))) {
          fail(`eval: ${c.case_key} expects ${k} but none of its facts appear in that document`);
        }
      }
    } else {
      if (c.expected_documents.length !== 0 || c.expected_facts.length !== 0) fail(`eval: refusal case ${c.case_key} must have empty expected_documents and expected_facts`);
    }
  }
  if (cases.length - answerable !== 8) fail(`eval: expected 8 refusal cases, got ${cases.length - answerable}`);
  return { total: cases.length, answerable };
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

function printTable(rows: Summary[]) {
  const cols: Array<[keyof Summary, string]> = [
    ["key", "document"],
    ["type", "type"],
    ["format", "fmt"],
    ["pages", "pages"],
    ["words", "words"],
    ["evidence", "evidence"],
    ["planted", "planted"],
    ["status", "status"],
  ];
  const widths = cols.map(([k, label]) => Math.max(label.length, ...rows.map((r) => String(r[k]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  console.log(line(cols.map(([, label]) => label)));
  console.log(line(widths.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map(([k]) => String(r[k]))));
}

async function main() {
  await fs.mkdir(CORPUS_DIR, { recursive: true });
  await fs.mkdir(EXTRAS_DIR, { recursive: true });
  for (const name of await fs.readdir(CORPUS_DIR)) await fs.rm(path.join(CORPUS_DIR, name));

  const docs = await loadGroundTruth();
  if (docs.length === 0) fail("no ground-truth documents found");
  for (const gt of docs) staticChecks(gt);

  const rows: Summary[] = [];
  const rendered = new Map<string, Buffer>();
  for (const gt of docs) {
    let bytes: Buffer;
    let pages: number | null = null;
    if (gt.format === "pdf") {
      const out = await renderPdf(gt);
      bytes = out.bytes;
      pages = out.pages;
    } else {
      bytes = await renderDocx(gt);
    }
    await fs.writeFile(path.join(CORPUS_DIR, gt.filename), bytes);
    rendered.set(gt.filename, bytes);
    rows.push(await verifyDocument(gt, bytes, pages));
  }

  let manifest: Manifest | null = null;
  try {
    manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8")) as Manifest;
  } catch (err) {
    fail(`manifest.json could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (manifest) {
    for (const entry of manifest.files) {
      if (entry.expect !== "duplicate" || !entry.duplicate_of) continue;
      const src = rendered.get(entry.duplicate_of);
      if (!src) {
        fail(`manifest: duplicate ${entry.filename} refers to ${entry.duplicate_of}, which was not rendered`);
        continue;
      }
      await fs.writeFile(path.join(CORPUS_DIR, entry.filename), src);
    }
    await verifyManifest(manifest, docs);
  }

  await fs.writeFile(path.join(EXTRAS_DIR, "scanned-like.pdf"), await writeScannedLike());
  await fs.writeFile(path.join(EXTRAS_DIR, "corrupt.pdf"), corruptPdf());
  await fs.writeFile(path.join(EXTRAS_DIR, "corrupt.docx"), corruptDocx());
  const extras = await verifyExtras();
  const rag = await verifyRagCases(docs);

  console.log("");
  printTable(rows);
  console.log("");
  const plantedTotal = rows.reduce((n, r) => n + r.planted, 0);
  const plantedDocs = rows.filter((r) => r.planted > 0).length;
  console.log(`documents: ${rows.length} (${rows.filter((r) => r.format === "pdf").length} pdf, ${rows.filter((r) => r.format === "docx").length} docx)`);
  console.log(`planted issues: ${plantedTotal} across ${plantedDocs} documents`);
  console.log(`corpus files: ${(await fs.readdir(CORPUS_DIR)).length}`);
  console.log(`extras: scanned-like.pdf -> ${extras.scanned}; corrupt.pdf -> ${extras.corruptPdf}; corrupt.docx -> ${extras.corruptDocx}`);
  console.log(`rag cases: ${rag.total} (${rag.answerable} answerable, ${rag.total - rag.answerable} refusals)`);
  if (plantedTotal < 12 || plantedTotal > 15) fail(`expected 12 to 15 planted issues in total, got ${plantedTotal}`);
  if (plantedDocs < 8) fail(`planted issues should be spread across at least 8 documents, got ${plantedDocs}`);

  if (failures.length > 0) {
    console.error("");
    console.error(`FAILED: ${failures.length} problem(s)`);
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
  console.log("");
  console.log("all fixture checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
