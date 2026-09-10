/**
 * Deterministic fixture generator for the EvidenceOps corpus (spec sections 10 and 28).
 *
 * 1. Builds every document body from the source-of-truth definitions in fixtures/source/.
 * 2. Renders PDFs (pdf-lib, fixed dates) and DOCX files (docx), copies the two exact duplicates
 *    within the same run, and writes the "extras" (scanned-like, corrupt).
 * 3. Parses every rendered file with the real pipeline parsers, resolves the locator of every
 *    evidence quote, extractor quote and golden fact, and emits fixtures/truth/*.json,
 *    fixtures/documents/manifest.json and fixtures/golden/rag-cases.json.
 * 4. Re-reads everything from disk and verifies it; exits non-zero on any failure.
 *
 * Run with: pnpm fixtures:generate
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { faker } from "@faker-js/faker";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import JSZip from "jszip";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { parsePdf, parseDocx, blockLocator, type ParsedBlock, type ParseResult } from "@/lib/pipeline/parse";
import { normalizeText } from "@/lib/text";
import { LIST_FIELDS, SCALAR_FIELDS, reportRecordSchema, type ReportRecord } from "@/lib/schema/report";
import { sha256 } from "@/lib/hash";
import type { BodySection, CorrectionSpec, DocSpec, GoldenRagCase, Manifest, ManifestFile, Truth, UncertainField, UncertainKind } from "../fixtures/types";
import { CORRECTIONS, DOCUMENTS, DUPLICATES, fileName, truthKey } from "../fixtures/source";
import { INSUFFICIENT, RAG_CASES } from "../fixtures/source/rag-cases";

const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");
const DOCS_DIR = path.join(FIXTURES_DIR, "documents");
const EXTRAS_DIR = path.join(DOCS_DIR, "extras");
const TRUTH_DIR = path.join(FIXTURES_DIR, "truth");
const GOLDEN_DIR = path.join(FIXTURES_DIR, "golden");
const MANIFEST_FILE = path.join(DOCS_DIR, "manifest.json");
const GOLDEN_FILE = path.join(GOLDEN_DIR, "rag-cases.json");

const FAKER_SEED = 20260910;
/** Fixed timestamp so PDF output is byte-for-byte reproducible. */
const FIXED_DATE = new Date("2026-09-10T09:00:00Z");

const EXPECTED = { files: 20, pdf: 16, docx: 4, unique: 16, duplicates: 2, corrected: 2, minPages: 50, maxPages: 70, minWords: 700, maxWords: 1200, minDocPages: 2, maxDocPages: 4 };
const ALL_KINDS: UncertainKind[] = ["missing_date", "conflicting_amount", "ambiguous_owner", "abbreviation", "duplicate_recommendation", "abbreviated_date", "negation", "distractor_amount", "weak_evidence", "missing_evidence"];
/** The ten planted edge cases of spec section 10 and how each is evidenced. */
const EDGE_CASES = ["missing_date", "conflicting_amount", "ambiguous_owner", "abbreviation", "duplicate_recommendation", "corrected_version", "exact_duplicate", "abbreviated_date", "negation", "distractor_amount"] as const;

// PDF layout
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 72;
const BODY_SIZE = 12;
const BODY_LEADING = 21;
const HEADING_SIZE = 14;
const HEADING_LEADING = 24;
const TITLE_SIZE = 18;
const TITLE_LEADING = 26;
const PARAGRAPH_GAP = 12;
const TEXT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = MARGIN / 2;

const failures: string[] = [];
function fail(msg: string) {
  failures.push(msg);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function longDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
function isAscii(s: string): boolean {
  return /^[\x20-\x7e]*$/.test(s);
}
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------------------------
// Deterministic fillers (faker)
// ---------------------------------------------------------------------------------------------

type Fill = { lead: string; analyst: string; interviews: number; sampled: number; files: number; orders: number; invoices: number; letters: number; start: string; end: string; ref: string };

function asciiName(): string {
  for (let i = 0; i < 20; i++) {
    const name = `${faker.person.firstName()} ${faker.person.lastName()}`;
    if (isAscii(name) && !/[.]/.test(name)) return name;
  }
  return "Morgan Hale";
}

/** All faker values are drawn up front, in document order, so the sequence is fixed. */
function drawFills(count: number): Fill[] {
  faker.seed(FAKER_SEED);
  const fills: Fill[] = [];
  for (let i = 0; i < count; i++) {
    const lead = asciiName();
    const analyst = asciiName();
    const start = faker.date.between({ from: "2025-06-01T00:00:00Z", to: "2026-01-31T00:00:00Z" });
    const end = new Date(start.getTime() + faker.number.int({ min: 21, max: 70 }) * 86400000);
    fills.push({
      lead,
      analyst,
      interviews: faker.number.int({ min: 9, max: 31 }),
      sampled: faker.number.int({ min: 40, max: 180 }),
      files: faker.number.int({ min: 60, max: 240 }),
      orders: faker.number.int({ min: 10, max: 60 }),
      invoices: faker.number.int({ min: 20, max: 90 }),
      letters: faker.number.int({ min: 5, max: 40 }),
      start: longDate(start),
      end: longDate(end),
      ref: faker.string.alphanumeric({ length: 6, casing: "upper" }),
    });
  }
  return fills;
}

// ---------------------------------------------------------------------------------------------
// Body and record construction
// ---------------------------------------------------------------------------------------------

type Built = {
  spec: DocSpec;
  version: number;
  key: string;
  reportNumber: string;
  filename: string;
  body: BodySection[];
  record: ReportRecord;
  /** field path -> verbatim quotes (locators resolved later) */
  quotes: Record<string, string[]>;
  uncertain: Omit<UncertainField, "extractor_locators">[];
};

/** Split a paragraph into sentences, protecting the abbreviations used in the corpus. */
function sentences(paragraph: string): string[] {
  const guarded = paragraph.replace(/\bNo\. /g, "No ").replace(/\bSept\. /g, "Sept ");
  return guarded
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$"(])/)
    .map((s) => s.replace(//g, ".").trim())
    .filter((s) => s.length > 0);
}

function firstSentenceWith(body: BodySection[], phrase: string, skipTitle: boolean): string | null {
  const needle = phrase.toLowerCase();
  const sections = skipTitle ? body.slice(1) : body;
  for (const section of sections) {
    for (const p of section.paragraphs) {
      for (const s of sentences(p)) if (s.toLowerCase().includes(needle)) return s;
    }
  }
  return null;
}

function applyReplacements(text: string, correction: CorrectionSpec | null): string {
  if (!correction) return text;
  let out = text;
  for (const r of correction.replacements) out = out.split(r.from).join(r.to);
  return out;
}

function build(spec: DocSpec, fill: Fill, correction: CorrectionSpec | null): Built {
  const version = correction ? 2 : 1;
  const reportNumber = correction ? `${spec.key}-R1` : spec.key;
  const dateLine = correction ? correction.dateLine : spec.dateLine;
  const dateIso = correction ? correction.dateIso : spec.dateIso;
  const R = (t: string) => applyReplacements(t, correction);

  const titleParas = [`Report No. ${reportNumber}`, spec.orgLine ?? `Issued by ${spec.org}`];
  if (dateLine) titleParas.push(dateLine);

  const methodology = `The work was led by ${fill.lead} and supported by ${fill.analyst}. The team conducted ${fill.interviews} structured interviews, examined a sample of ${fill.sampled} records and reviewed ${fill.files} internal documents between ${fill.start} and ${fill.end}. Records held by third parties were not independently verified except where this document says otherwise.`;
  const appendixA = `Appendix A: Records examined. The ${fill.files} internal documents reviewed included ${fill.orders} purchase orders, ${fill.invoices} invoices and ${fill.letters} items of correspondence, all indexed under working reference ${fill.ref}.`;

  const findingParas = spec.findings.map((f, i) => `Finding ${i + 1}: ${f.finding} ${f.detail} Severity: ${cap(f.severity)}.`);
  const recQuotes = spec.recommendations.map((r, i) => {
    const q = [`Recommendation ${i + 1}: ${r.recommendation}`, r.targetText ?? `Target: ${r.target_entity}.`];
    if (r.status_if_stated) q.push(`Status: ${r.status_if_stated}.`);
    return q;
  });
  const recParas = recQuotes.map((q) => q.join(" "));
  const financialParas = [[spec.financialIntro, ...spec.amounts.filter((a) => !a.inBody).map((a) => a.sentence)].join(" "), ...(spec.financialExtra ?? [])];

  const body: BodySection[] = [
    { heading: spec.title, paragraphs: titleParas },
    { heading: "Executive Summary", paragraphs: [...spec.summary] },
    { heading: "Background", paragraphs: [...spec.background, methodology] },
    { heading: "Findings", paragraphs: findingParas },
    { heading: "Recommendations", paragraphs: recParas },
    { heading: "Financial Impact", paragraphs: financialParas },
    { heading: "Appendix", paragraphs: [appendixA, ...spec.appendix] },
  ].map((s) => ({ heading: R(s.heading), paragraphs: s.paragraphs.map(R) }));

  if (correction) body[1]!.paragraphs.unshift(correction.supersessionNote);

  // Document the evidence collection and limitations consistently without adding findings.
  const methodNotes = [
    "The evidence register preserves the relationship between each reviewed item and its original record. Working copies were organized by topic, with separate references for correspondence and supporting schedules. A reference identifies the material examined; it does not establish that every statement in that material is accurate. Conclusions remain limited to the findings expressly stated in this report.",
    "Review procedures distinguished statements made during interviews from observations supported by retained documents. Where an interview described an event, the team checked the available record for the same event before relying on the statement. Material that could not be reconciled was retained with its context so that a later reader could inspect the basis for the conclusion.",
    "The sampling approach was intended to describe the matters selected for examination. It was not designed to estimate the frequency of an issue across records outside that selection. Readers should therefore interpret a finding in relation to its stated scope, period and subject. Silence about another activity does not imply that the activity was examined or found satisfactory.",
    "This appendix explains the preparation of the evidence file. It does not introduce additional recommendations or change the responsibility assigned in the recommendations section. Any later correction to the source must be issued as a separately identified edition. Earlier editions remain part of the record so that differences can be inspected without overwriting the originally published statements.",
  ];
  for (const note of methodNotes) {
    if (wordCount(body) >= 710) break;
    body[body.length - 1]!.paragraphs.push(note);
  }

  const record: ReportRecord = {
    report_title: spec.title,
    report_number: reportNumber,
    issuing_organization: spec.org,
    publication_date: dateIso,
    document_type: spec.document_type,
    subject_entities: spec.entities.map((e) => ({ name: e.name })),
    key_findings: spec.findings.map((f) => ({ finding: f.finding, severity: f.severity })),
    recommendations: spec.recommendations.map((r) => ({ recommendation: r.recommendation, target_entity: r.target_entity, status_if_stated: r.status_if_stated })),
    monetary_amounts: spec.amounts.map((a) => ({ amount: a.amount, currency: a.currency, context: a.context })),
  };
  if (correction) {
    // A corrected edition changes the printed figure; keep the record in step with the text.
    for (const r of correction.replacements) {
      const fromNum = parseMoney(r.from);
      const toNum = parseMoney(r.to);
      for (const m of record.monetary_amounts) if (m && m.amount === fromNum) m.amount = toNum;
    }
  }

  const quotes: Record<string, string[]> = {
    report_title: [spec.title],
    report_number: [`Report No. ${reportNumber}`],
    issuing_organization: [spec.orgLine ?? `Issued by ${spec.org}`],
  };
  if (dateLine) quotes.publication_date = [dateLine];
  const typeSentence = firstSentenceWith(body, spec.typePhrase, true);
  if (!typeSentence) fail(`${spec.key} v${version}: no sentence contains the document type phrase ${JSON.stringify(spec.typePhrase)}`);
  quotes.document_type = [typeSentence ?? spec.title];
  spec.entities.forEach((e, i) => {
    const s = e.quote ?? firstSentenceWith(body, e.name, true) ?? firstSentenceWith(body, e.name, false);
    if (!s) fail(`${spec.key} v${version}: no sentence names entity ${JSON.stringify(e.name)}`);
    quotes[`subject_entities[${i}]`] = [s ?? e.name];
  });
  spec.findings.forEach((f, i) => {
    quotes[`key_findings[${i}]`] = [`Finding ${i + 1}: ${f.finding}`, `Severity: ${cap(f.severity)}.`];
  });
  recQuotes.forEach((q, i) => {
    quotes[`recommendations[${i}]`] = q;
  });
  spec.amounts.forEach((a, i) => {
    quotes[`monetary_amounts[${i}]`] = [R(a.sentence)];
  });
  for (const k of Object.keys(quotes)) quotes[k] = quotes[k]!.map(R);

  const uncertain = spec.uncertain.map((u) => structuredClone(u));
  return { spec, version, key: spec.key, reportNumber, filename: fileName(spec, version), body, record, quotes, uncertain };
}

function parseMoney(text: string): number {
  const m = /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million)?/i.exec(text);
  if (!m) return NaN;
  return Number(m[1]!.replace(/,/g, "")) * (m[2] ? 1e6 : 1);
}

function bodyParagraphs(body: BodySection[]): string[] {
  return body.flatMap((s) => [s.heading, ...s.paragraphs]);
}

function wordCount(body: BodySection[]): number {
  return bodyParagraphs(body)
    .join(" ")
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ---------------------------------------------------------------------------------------------
// Static checks on the built document (before rendering)
// ---------------------------------------------------------------------------------------------

function staticChecks(b: Built) {
  const tag = `${b.key} v${b.version}`;
  const paras = bodyParagraphs(b.body);
  for (const p of paras) if (!isAscii(p)) fail(`${tag}: non-ASCII text in body: ${JSON.stringify(p.slice(0, 60))}`);
  const normalized = paras.map(normalizeText);
  const inBody = (q: string) => normalized.some((p) => p.includes(normalizeText(q)));

  const parsed = reportRecordSchema.safeParse(b.record);
  if (!parsed.success) fail(`${tag}: record does not satisfy reportRecordSchema: ${parsed.error.message}`);

  // every non-null scalar and every list item has evidence, and nothing else does
  const expected = new Set<string>();
  for (const f of SCALAR_FIELDS) if (b.record[f] !== null) expected.add(f);
  for (const f of LIST_FIELDS) (b.record[f] as unknown[]).forEach((_, i) => expected.add(`${f}[${i}]`));
  for (const fp of expected) if (!b.quotes[fp]) fail(`${tag}: missing evidence quotes for ${fp}`);
  for (const fp of Object.keys(b.quotes)) if (!expected.has(fp)) fail(`${tag}: evidence for ${fp} but the record has no such non-null field`);
  for (const [fp, qs] of Object.entries(b.quotes)) {
    for (const q of qs) {
      if (!isAscii(q) || /[\r\n]/.test(q)) fail(`${tag}: evidence quote for ${fp} must be single-line ASCII`);
      if (!inBody(q)) fail(`${tag}: evidence quote for ${fp} is not in the body: ${JSON.stringify(q)}`);
    }
  }
  for (const u of b.uncertain) {
    for (const q of u.extractor_quotes) {
      if (!isAscii(q) || /[\r\n]/.test(q)) fail(`${tag}: extractor quote for ${u.field_path} must be single-line ASCII`);
      const found = inBody(q);
      if (u.kind === "missing_evidence" && found) fail(`${tag}: missing_evidence quote for ${u.field_path} must NOT appear in the body`);
      if (u.kind !== "missing_evidence" && !found) fail(`${tag}: ${u.kind} quote for ${u.field_path} is not in the body: ${JSON.stringify(q)}`);
    }
    if (!ALL_KINDS.includes(u.kind)) fail(`${tag}: unknown uncertain kind ${u.kind}`);
  }
  if (b.uncertain.length > 2) fail(`${tag}: at most 2 uncertain fields per document (got ${b.uncertain.length})`);
  for (const d of b.spec.distractors) if (!inBody(d.text)) fail(`${tag}: distractor text is not in the body: ${JSON.stringify(d.text)}`);
  for (const required of ["Executive Summary", "Background", "Findings", "Recommendations", "Financial Impact", "Appendix"]) {
    if (!b.body.some((s) => s.heading === required)) fail(`${tag}: missing section ${required}`);
  }
  const words = wordCount(b.body);
  if (words < EXPECTED.minWords || words > EXPECTED.maxWords) fail(`${tag}: ${words} words; expected ${EXPECTED.minWords} to ${EXPECTED.maxWords}`);
  if (b.record.publication_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(b.record.publication_date)) fail(`${tag}: publication_date is not ISO`);
  for (const m of b.record.monetary_amounts) if (m && !["USD", "EUR", "GBP", "CAD"].includes(m.currency)) fail(`${tag}: currency ${m.currency} is not one of USD, EUR, GBP, CAD`);
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
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) current = candidate;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

type LayoutItem = { kind: "title" | "heading" | "paragraph"; lines: string[]; forceBreak: boolean };

async function renderPdf(b: Built): Promise<{ bytes: Buffer; pages: number }> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle(b.spec.title);
  doc.setAuthor(b.spec.org);
  doc.setProducer("EvidenceOps fixtures");
  doc.setCreator("EvidenceOps fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const items: LayoutItem[] = [];
  b.body.forEach((section, i) => {
    const forceBreak = i > 0 && (b.spec.page_hints ?? []).includes(i);
    if (i === 0) items.push({ kind: "title", lines: wrapLine(section.heading, bold, TITLE_SIZE, TEXT_WIDTH), forceBreak: false });
    else items.push({ kind: "heading", lines: wrapLine(section.heading, bold, HEADING_SIZE, TEXT_WIDTH), forceBreak });
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
  const leadingOf = (item: LayoutItem) => (item.kind === "title" ? TITLE_LEADING : item.kind === "heading" ? HEADING_LEADING : BODY_LEADING);
  const heightOf = (item: LayoutItem) => item.lines.length * leadingOf(item);

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!page || item.forceBreak) newPage();
    if (item.kind !== "paragraph") {
      const next = items[i + 1];
      const needed = heightOf(item) + (next ? Math.min(2, next.lines.length) * BODY_LEADING : 0);
      if (y - needed < bottom) newPage();
      const cur = page as unknown as PDFPage;
      const size = item.kind === "title" ? TITLE_SIZE : HEADING_SIZE;
      for (const line of item.lines) {
        y -= leadingOf(item);
        cur.drawText(line, { x: MARGIN, y, size, font: bold, color: rgb(0, 0, 0) });
      }
      y -= PARAGRAPH_GAP / 2;
      continue;
    }
    // Paragraphs are never split across pages (they are all far shorter than a page).
    if (y - heightOf(item) < bottom) newPage();
    const cur = page as unknown as PDFPage;
    for (const line of item.lines) {
      y -= BODY_LEADING;
      cur.drawText(line, { x: MARGIN, y, size: BODY_SIZE, font, color: rgb(0, 0, 0) });
    }
    y -= PARAGRAPH_GAP;
  }

  pages.forEach((pg, idx) => {
    const label = `${b.reportNumber} | Page ${idx + 1} of ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 9);
    pg.drawText(label, { x: PAGE_WIDTH - MARGIN - w, y: FOOTER_Y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  });

  const bytes = Buffer.from(await doc.save({ useObjectStreams: false }));
  return { bytes, pages: pages.length };
}

// ---------------------------------------------------------------------------------------------
// DOCX rendering
// ---------------------------------------------------------------------------------------------

async function renderDocx(b: Built): Promise<Buffer> {
  const children: Paragraph[] = [];
  b.body.forEach((section, i) => {
    children.push(new Paragraph({ heading: i === 0 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, children: [new TextRun(section.heading)] }));
    for (const p of section.paragraphs) children.push(new Paragraph({ children: [new TextRun(p)] }));
  });
  const doc = new Document({ creator: b.spec.org, title: b.spec.title, description: "EvidenceOps synthetic fixture", sections: [{ children }] });
  const zip = await JSZip.loadAsync(await Packer.toBuffer(doc));
  const fixed = new Date("2026-01-01T00:00:00.000Z");
  const core = zip.file("docProps/core.xml");
  if (core) zip.file("docProps/core.xml", (await core.async("string")).replace(/<dcterms:(created|modified)([^>]*)>[^<]*<\/dcterms:\1>/g, (_all, name, attrs) => `<dcterms:${name}${attrs}>${fixed.toISOString()}</dcterms:${name}>`));
  zip.forEach((_name, entry) => { entry.date = fixed; });
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

// ---------------------------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------------------------

async function scannedLikePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setProducer("EvidenceOps fixtures");
  doc.setCreator("EvidenceOps fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 3; p++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
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
const corruptPdf = () => Buffer.concat([Buffer.from("%PDF-1.7\n", "ascii"), garbage(2048, 0x5eed1234)]);
const corruptDocx = () => Buffer.from("This file has a .docx extension but is not an OOXML zip archive.\n".repeat(24), "ascii");

// ---------------------------------------------------------------------------------------------
// Locator resolution
// ---------------------------------------------------------------------------------------------

type Parsed = { blocks: ParsedBlock[]; locators: string[] };

async function parseFile(format: "pdf" | "docx", bytes: Buffer): Promise<ParseResult> {
  return format === "pdf" ? parsePdf(bytes) : parseDocx(bytes);
}

function toParsed(key: string, version: number, result: ParseResult): Parsed | null {
  if (result.status !== "parsed") return null;
  return { blocks: result.blocks, locators: result.blocks.map((b) => blockLocator(key, version, b)) };
}

/** Locators of the blocks that contain every one of the quotes. */
function locate(parsed: Parsed, quotes: string[]): string[] {
  const needles = quotes.map(normalizeText);
  const out: string[] = [];
  parsed.blocks.forEach((b, i) => {
    if (needles.every((q) => b.normalizedText.includes(q))) out.push(parsed.locators[i]!);
  });
  return out;
}

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

type Row = { truth: string; org: string; type: string; format: string; pages: string; words: number; evidence: number; uncertain: number };

async function main() {
  const t0 = Date.now();
  await fs.rm(DOCS_DIR, { recursive: true, force: true });
  await fs.rm(TRUTH_DIR, { recursive: true, force: true });
  await fs.rm(GOLDEN_DIR, { recursive: true, force: true });
  await fs.mkdir(EXTRAS_DIR, { recursive: true });
  await fs.mkdir(TRUTH_DIR, { recursive: true });
  await fs.mkdir(GOLDEN_DIR, { recursive: true });

  // ---- build
  const keys = new Set<string>();
  for (const d of DOCUMENTS) {
    if (keys.has(d.key)) fail(`duplicate logical key ${d.key}`);
    keys.add(d.key);
  }
  const fills = drawFills(DOCUMENTS.length);
  const fillOf = new Map(DOCUMENTS.map((d, i) => [d.key, fills[i]!]));
  const built: Built[] = DOCUMENTS.map((d) => build(d, fillOf.get(d.key)!, null));
  for (const c of CORRECTIONS) {
    const spec = DOCUMENTS.find((d) => d.key === c.key);
    if (!spec) {
      fail(`correction refers to unknown key ${c.key}`);
      continue;
    }
    built.push(build(spec, fillOf.get(spec.key)!, c));
  }
  for (const b of built) staticChecks(b);
  if (failures.length) return finish([], null);

  // ---- render, parse, resolve
  const rendered = new Map<string, { bytes: Buffer; pages: number | null; parsed: Parsed | null }>();
  const rows: Row[] = [];
  const truths: Truth[] = [];
  const parsedByKey = new Map<string, Parsed>(); // truth key -> parsed
  for (const b of built) {
    const tag = truthKey(b.key, b.version);
    let bytes: Buffer;
    let pages: number | null = null;
    if (b.spec.format === "pdf") {
      const r = await renderPdf(b);
      bytes = r.bytes;
      pages = r.pages;
    } else bytes = await renderDocx(b);
    await fs.writeFile(path.join(DOCS_DIR, b.filename), bytes);
    const result = await parseFile(b.spec.format, bytes);
    const parsed = toParsed(b.key, b.version, result);
    if (!parsed) {
      fail(`${tag}: parser returned ${result.status} for ${b.filename}`);
      continue;
    }
    if (pages !== null && result.status === "parsed" && result.pageCount !== pages) fail(`${tag}: rendered ${pages} pages but parser saw ${result.pageCount}`);
    if (pages !== null && (pages < EXPECTED.minDocPages || pages > EXPECTED.maxDocPages)) fail(`${tag}: ${pages} pages; expected ${EXPECTED.minDocPages} to ${EXPECTED.maxDocPages}`);
    rendered.set(tag, { bytes, pages, parsed });
    parsedByKey.set(tag, parsed);

    const evidence: Truth["evidence"] = {};
    for (const [fp, quotes] of Object.entries(b.quotes)) {
      const locators = locate(parsed, quotes);
      if (locators.length === 0) fail(`${tag}: no parsed block contains all evidence quotes for ${fp}: ${JSON.stringify(quotes)}`);
      evidence[fp] = { locators, quotes };
    }
    const uncertain_fields: UncertainField[] = b.uncertain.map((u) => {
      let extractor_locators: string[];
      if (u.kind === "missing_evidence") {
        // A fabricated item is cited against the block that holds the real recommendations.
        const last = `recommendations[${b.record.recommendations.length - 1}]`;
        extractor_locators = evidence[last]?.locators ?? [];
      } else {
        extractor_locators = locate(parsed, u.extractor_quotes);
        if (extractor_locators.length === 0) fail(`${tag}: no parsed block contains the extractor quotes for ${u.field_path}`);
      }
      return { ...u, extractor_locators };
    });
    const correction = CORRECTIONS.find((c) => c.key === b.key);
    const truth: Truth = {
      logical_key: b.key,
      version: b.version,
      format: b.spec.format,
      filename: b.filename,
      display_name: b.version === 1 ? b.spec.display_name : `${b.spec.display_name} (corrected edition)`,
      record: b.record,
      evidence,
      uncertain_fields,
      distractors: b.spec.distractors,
      expect_duplicate_files: [],
      supersedes: b.version === 2 ? truthKey(b.key, 1) : null,
      superseded_by: b.version === 1 && correction ? truthKey(b.key, 2) : null,
      body: b.body,
      ...(b.spec.page_hints ? { page_hints: b.spec.page_hints } : {}),
    };
    truths.push(truth);
    rows.push({ truth: tag, org: b.spec.org, type: b.spec.document_type, format: b.spec.format, pages: pages === null ? "-" : String(pages), words: wordCount(b.body), evidence: Object.keys(evidence).length, uncertain: uncertain_fields.length });
  }

  // ---- duplicates (copied within the run; DOCX output is not byte-deterministic across runs)
  const manifest: Manifest = { files: [] };
  const v1s = truths.filter((t) => t.version === 1);
  const v2s = truths.filter((t) => t.version === 2);
  for (const t of v1s) manifest.files.push({ filename: t.filename, truth: truthKey(t.logical_key, 1), expect: "processed" });
  for (const dup of DUPLICATES) {
    const original = truths.find((t) => t.logical_key === dup.of && t.version === 1);
    const r = original ? rendered.get(truthKey(dup.of, 1)) : undefined;
    if (!original || !r) {
      fail(`duplicate refers to unknown document ${dup.of}`);
      continue;
    }
    const name = dup.filename(original.filename);
    await fs.writeFile(path.join(DOCS_DIR, name), r.bytes);
    original.expect_duplicate_files.push(name);
    manifest.files.push({ filename: name, truth: truthKey(dup.of, 1), expect: "duplicate", duplicate_of: original.filename });
  }
  for (const t of v2s) manifest.files.push({ filename: t.filename, truth: truthKey(t.logical_key, 2), expect: "new_version", supersedes: truthKey(t.logical_key, 1) });

  // ---- extras
  await fs.writeFile(path.join(EXTRAS_DIR, "scanned-like.pdf"), await scannedLikePdf());
  await fs.writeFile(path.join(EXTRAS_DIR, "corrupt.pdf"), corruptPdf());
  await fs.writeFile(path.join(EXTRAS_DIR, "corrupt.docx"), corruptDocx());

  // ---- golden set
  const currentVersion = (key: string) => (CORRECTIONS.some((c) => c.key === key) ? 2 : 1);
  const golden: GoldenRagCase[] = RAG_CASES.map((c) => {
    const docs: string[] = [];
    const locators: string[] = [];
    for (const f of c.facts) {
      const parsed = parsedByKey.get(truthKey(f.doc, currentVersion(f.doc)));
      if (!parsed) {
        fail(`${c.case_key}: fact refers to unknown document ${f.doc}`);
        continue;
      }
      const locs = locate(parsed, [f.text]);
      if (locs.length === 0) fail(`${c.case_key}: fact ${JSON.stringify(f.text)} not found in the current version of ${f.doc}`);
      if (!docs.includes(f.doc)) docs.push(f.doc);
      for (const l of locs) if (!locators.includes(l)) locators.push(l);
    }
    return { case_key: c.case_key, category: c.category, question: c.question, expected_answer: c.expected_answer, expected_documents: docs, expected_locators: locators, expected_facts: c.facts.map((f) => f.text), tags: c.tags };
  });

  // ---- write JSON
  for (const t of truths) await fs.writeFile(path.join(TRUTH_DIR, `${truthKey(t.logical_key, t.version)}.json`), JSON.stringify(t, null, 2) + "\n");
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2) + "\n");
  await fs.writeFile(GOLDEN_FILE, JSON.stringify(golden, null, 2) + "\n");

  // ---- verification pass from disk
  const verification = await verifyFromDisk();
  return finish(rows, { verification, elapsedMs: Date.now() - t0 });
}

// ---------------------------------------------------------------------------------------------
// Verification (re-reads everything from disk, independent of the in-memory build)
// ---------------------------------------------------------------------------------------------

type Verification = { files: number; pdf: number; docx: number; pdfPages: number; duplicates: number; corrected: number; uncertain: number; uncertainDocs: number; kinds: Record<string, number>; golden: Record<string, number>; extras: Record<string, string> };

async function verifyFromDisk(): Promise<Verification> {
  const truthFiles = (await fs.readdir(TRUTH_DIR)).filter((n) => n.endsWith(".json")).sort();
  const truths = new Map<string, Truth>();
  for (const name of truthFiles) {
    const t = JSON.parse(await fs.readFile(path.join(TRUTH_DIR, name), "utf8")) as Truth;
    if (name !== `${truthKey(t.logical_key, t.version)}.json`) fail(`truth file ${name} does not match its logical_key/version`);
    truths.set(truthKey(t.logical_key, t.version), t);
  }
  const manifest = JSON.parse(await fs.readFile(MANIFEST_FILE, "utf8")) as Manifest;
  const golden = JSON.parse(await fs.readFile(GOLDEN_FILE, "utf8")) as GoldenRagCase[];

  const parsedByTruth = new Map<string, Parsed>();
  const hashes = new Map<string, string>();
  let pdf = 0;
  let docx = 0;
  let pdfPages = 0;
  for (const t of truths.values()) {
    const bytes = await fs.readFile(path.join(DOCS_DIR, t.filename));
    hashes.set(t.filename, sha256(bytes));
    const result = await parseFile(t.format, bytes);
    const parsed = toParsed(t.logical_key, t.version, result);
    if (!parsed || result.status !== "parsed") {
      fail(`verify ${t.filename}: parser returned ${result.status}`);
      continue;
    }
    parsedByTruth.set(truthKey(t.logical_key, t.version), parsed);
    if (t.format === "pdf") {
      pdf++;
      pdfPages += result.pageCount ?? 0;
    } else docx++;
    const byLocator = new Map(parsed.locators.map((l, i) => [l, parsed.blocks[i]!.normalizedText]));
    for (const [fp, ev] of Object.entries(t.evidence)) {
      if (ev.locators.length === 0) fail(`verify ${t.filename}: ${fp} has no locators`);
      for (const q of ev.quotes) {
        const nq = normalizeText(q);
        if (!ev.locators.some((l) => byLocator.get(l)?.includes(nq))) fail(`verify ${t.filename}: quote for ${fp} not found in any listed locator: ${JSON.stringify(q)}`);
      }
    }
    for (const u of t.uncertain_fields) {
      for (const q of u.extractor_quotes) {
        const nq = normalizeText(q);
        const anywhere = parsed.blocks.some((b) => b.normalizedText.includes(nq));
        if (u.kind === "missing_evidence" && anywhere) fail(`verify ${t.filename}: missing_evidence quote for ${u.field_path} was found in the parsed text`);
        if (u.kind !== "missing_evidence" && !u.extractor_locators.some((l) => byLocator.get(l)?.includes(nq))) fail(`verify ${t.filename}: extractor quote for ${u.field_path} not found in its locators: ${JSON.stringify(q)}`);
      }
    }
    for (const dupName of t.expect_duplicate_files) {
      const dupBytes = await fs.readFile(path.join(DOCS_DIR, dupName));
      hashes.set(dupName, sha256(dupBytes));
      if (!dupBytes.equals(bytes)) fail(`verify ${dupName}: not byte-identical to ${t.filename}`);
      if (t.format === "pdf") {
        pdf++;
        pdfPages += result.pageCount ?? 0;
      } else docx++;
    }
    if (t.version === 2 && (!t.supersedes || !truths.has(t.supersedes))) fail(`verify ${t.filename}: v2 must supersede an existing v1`);
    if (t.version === 2 && !/-R1$/.test(t.record.report_number ?? "")) fail(`verify ${t.filename}: v2 report number must end with -R1`);
    if (t.version === 2 && t.supersedes) {
      const v1 = truths.get(t.supersedes)!;
      const changed = t.record.monetary_amounts.some((m, i) => m && v1.record.monetary_amounts[i] && m.amount !== v1.record.monetary_amounts[i]!.amount);
      if (!changed) fail(`verify ${t.filename}: v2 must change at least one monetary amount`);
      if (!(t.record.publication_date! > v1.record.publication_date!)) fail(`verify ${t.filename}: v2 publication date must be later than v1`);
      if (!t.body.some((s) => s.paragraphs.some((p) => p.includes("This corrected edition supersedes")))) fail(`verify ${t.filename}: v2 must state that it supersedes v1`);
      if (v1.superseded_by !== truthKey(t.logical_key, 2)) fail(`verify ${v1.filename}: superseded_by must point at v2`);
    }
  }

  // composition
  const files = manifest.files.length;
  const unique = [...truths.values()].filter((t) => t.version === 1).length;
  const duplicates = manifest.files.filter((f) => f.expect === "duplicate").length;
  const corrected = manifest.files.filter((f) => f.expect === "new_version").length;
  if (files !== EXPECTED.files) fail(`manifest lists ${files} files; expected ${EXPECTED.files}`);
  if (pdf !== EXPECTED.pdf) fail(`${pdf} PDF files; expected ${EXPECTED.pdf}`);
  if (docx !== EXPECTED.docx) fail(`${docx} DOCX files; expected ${EXPECTED.docx}`);
  if (unique !== EXPECTED.unique) fail(`${unique} unique v1 documents; expected ${EXPECTED.unique}`);
  if (duplicates !== EXPECTED.duplicates) fail(`${duplicates} duplicates; expected ${EXPECTED.duplicates}`);
  if (corrected !== EXPECTED.corrected) fail(`${corrected} corrected v2 files; expected ${EXPECTED.corrected}`);
  if (pdfPages < EXPECTED.minPages || pdfPages > EXPECTED.maxPages) fail(`${pdfPages} PDF pages in the corpus; expected ${EXPECTED.minPages} to ${EXPECTED.maxPages}`);
  const dupFormats = new Set(manifest.files.filter((f) => f.expect === "duplicate").map((f) => path.extname(f.filename)));
  if (!dupFormats.has(".pdf") || !dupFormats.has(".docx")) fail("duplicates must include one PDF and one DOCX");
  const v2Formats = new Set(manifest.files.filter((f) => f.expect === "new_version").map((f) => path.extname(f.filename)));
  if (!v2Formats.has(".pdf") || !v2Formats.has(".docx")) fail("corrected v2 files must include one PDF and one DOCX");
  const seen = new Set<string>();
  manifest.files.forEach((f: ManifestFile, i) => {
    if (seen.has(f.filename)) fail(`manifest lists ${f.filename} twice`);
    seen.add(f.filename);
    if (!truths.has(f.truth)) fail(`manifest entry ${f.filename} refers to unknown truth ${f.truth}`);
    const idx = (name: string) => manifest.files.findIndex((x) => x.filename === name);
    if (f.expect === "duplicate") {
      if (!f.duplicate_of || idx(f.duplicate_of) < 0 || idx(f.duplicate_of) > i) fail(`manifest: duplicate ${f.filename} must follow its original`);
      if (f.duplicate_of && hashes.get(f.duplicate_of) !== hashes.get(f.filename)) fail(`manifest: ${f.filename} hash differs from ${f.duplicate_of}`);
    }
    if (f.expect === "new_version") {
      const v1 = f.supersedes ? truths.get(f.supersedes) : undefined;
      if (!v1 || idx(v1.filename) < 0 || idx(v1.filename) > i) fail(`manifest: new_version ${f.filename} must follow its v1`);
    }
  });
  const onDisk = (await fs.readdir(DOCS_DIR)).filter((n) => n.endsWith(".pdf") || n.endsWith(".docx"));
  for (const n of onDisk) if (!seen.has(n)) fail(`documents/${n} is not listed in the manifest`);

  // uncertain fields and planted edge cases
  const kinds: Record<string, number> = {};
  let uncertain = 0;
  let uncertainDocs = 0;
  for (const t of truths.values()) {
    if (t.uncertain_fields.length > 0) uncertainDocs++;
    for (const u of t.uncertain_fields) {
      uncertain++;
      kinds[u.kind] = (kinds[u.kind] ?? 0) + 1;
      if (u.kind === "missing_date" && t.record.publication_date !== null) fail(`${t.filename}: missing_date document must have a null publication_date`);
      if (u.kind === "abbreviated_date" && t.record.publication_date !== "2026-09-04") fail(`${t.filename}: abbreviated_date document must resolve to 2026-09-04`);
      if (u.kind === "ambiguous_owner") {
        const idx = Number(/\[(\d+)\]/.exec(u.field_path)?.[1]);
        const item = t.record.recommendations[idx];
        if (!item || item.target_entity !== null) fail(`${t.filename}: ambiguous_owner recommendation must have a null target_entity`);
      }
      if (u.kind === "distractor_amount" && t.distractors.length === 0) fail(`${t.filename}: distractor_amount must be documented under distractors`);
      if (u.kind === "conflicting_amount" && u.verifier.status !== "unsupported") fail(`${t.filename}: conflicting_amount must be unsupported by the verifier`);
      if (u.kind === "negation" && !u.extractor_quotes.some((q) => /\bno\b/i.test(q))) fail(`${t.filename}: negation quote must contain the negation`);
      const fullySupported = u.verifier.status === "supported" && u.verifier.evidence_specificity >= 0.75 && !u.verifier.contradiction_detected;
      if (fullySupported && u.expect_routed) fail(`${t.filename}: ${u.field_path} is fully supported but expect_routed is true`);
      if (!fullySupported && !u.expect_routed) fail(`${t.filename}: ${u.field_path} is not fully supported but expect_routed is false`);
    }
  }
  if (uncertain < 14 || uncertain > 18) fail(`${uncertain} uncertain fields planted; expected 14 to 18`);
  if (uncertainDocs < 10) fail(`uncertain fields span ${uncertainDocs} documents; expected at least 10`);
  for (const k of EDGE_CASES) {
    const present = k === "corrected_version" ? corrected > 0 : k === "exact_duplicate" ? duplicates > 0 : (kinds[k] ?? 0) > 0;
    if (!present) fail(`planted edge case ${k} is missing from the corpus`);
  }

  // golden set
  const goldenCounts: Record<string, number> = {};
  if (golden.length !== 40) fail(`golden set has ${golden.length} cases; expected 40`);
  let v2Targets = 0;
  golden.forEach((c, i) => {
    goldenCounts[c.category] = (goldenCounts[c.category] ?? 0) + 1;
    if (c.case_key !== `rag-${String(i + 1).padStart(3, "0")}`) fail(`golden case ${i} has key ${c.case_key}`);
    if (c.category === "unanswerable") {
      if (c.expected_answer !== INSUFFICIENT) fail(`${c.case_key}: unanswerable answer must be exactly ${JSON.stringify(INSUFFICIENT)}`);
      if (c.expected_documents.length || c.expected_locators.length || c.expected_facts.length) fail(`${c.case_key}: unanswerable case must have no documents, locators or facts`);
      return;
    }
    if (c.expected_facts.length < 1 || c.expected_facts.length > 3) fail(`${c.case_key}: expected 1 to 3 facts`);
    if (c.category === "cross_document" && c.expected_documents.length < 2) fail(`${c.case_key}: cross_document case needs at least 2 documents`);
    if (c.category === "single_document" && c.expected_documents.length !== 1) fail(`${c.case_key}: single_document case needs exactly 1 document`);
    if (c.expected_locators.length === 0) fail(`${c.case_key}: no expected locators`);
    if (c.category === "single_document" && c.tags.includes("corrected_figure")) v2Targets++;
    const currentParsed = c.expected_documents.map((key) => {
      const version = [...truths.values()].filter((t) => t.logical_key === key).reduce((m, t) => Math.max(m, t.version), 0);
      return parsedByTruth.get(truthKey(key, version));
    });
    for (const fact of c.expected_facts) {
      const nf = normalizeText(fact);
      const found = currentParsed.some((p) => p?.blocks.some((b) => b.normalizedText.includes(nf)));
      if (!found) fail(`${c.case_key}: fact ${JSON.stringify(fact)} not found in the current version of any expected document`);
      if (!c.expected_answer.includes(fact)) fail(`${c.case_key}: expected_answer does not contain the fact ${JSON.stringify(fact)}`);
    }
    for (const l of c.expected_locators) {
      const ok = currentParsed.some((p) => p?.locators.includes(l));
      if (!ok) fail(`${c.case_key}: locator ${l} is not a block of a current expected document`);
    }
  });
  if ((goldenCounts.single_document ?? 0) !== 20 || (goldenCounts.cross_document ?? 0) !== 10 || (goldenCounts.unanswerable ?? 0) !== 10) fail(`golden categories must be 20/10/10, got ${JSON.stringify(goldenCounts)}`);
  if (v2Targets < 3) fail(`only ${v2Targets} single-document cases target a corrected v2 figure; expected at least 3`);

  // extras
  const scanned = await parsePdf(await fs.readFile(path.join(EXTRAS_DIR, "scanned-like.pdf")));
  if (scanned.status !== "unsupported" || scanned.reason !== "unsupported_scanned_document") fail(`extras/scanned-like.pdf: expected unsupported (scanned), got ${scanned.status}`);
  const badPdf = await parsePdf(await fs.readFile(path.join(EXTRAS_DIR, "corrupt.pdf")));
  if (badPdf.status !== "failed") fail(`extras/corrupt.pdf: expected failed, got ${badPdf.status}`);
  const badDocx = await parseDocx(await fs.readFile(path.join(EXTRAS_DIR, "corrupt.docx")));
  if (badDocx.status !== "failed") fail(`extras/corrupt.docx: expected failed, got ${badDocx.status}`);

  return {
    files,
    pdf,
    docx,
    pdfPages,
    duplicates,
    corrected,
    uncertain,
    uncertainDocs,
    kinds,
    golden: goldenCounts,
    extras: { "scanned-like.pdf": scanned.status === "unsupported" ? `${scanned.status}/${scanned.reason}` : scanned.status, "corrupt.pdf": badPdf.status, "corrupt.docx": badDocx.status },
  };
}

// ---------------------------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------------------------

function table(rows: Record<string, string | number>[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]!);
  const width = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(width[i]!)).join("  ");
  console.log(line(cols));
  console.log(line(width.map((w) => "-".repeat(w))));
  for (const r of rows) console.log(line(cols.map((c) => String(r[c]))));
}

function finish(rows: Row[], summary: { verification: Verification; elapsedMs: number } | null) {
  if (rows.length) {
    console.log("\nDocuments");
    table(rows);
  }
  if (summary) {
    const v = summary.verification;
    console.log("\nCorpus");
    table([
      { metric: "files", value: `${v.files} (${v.pdf} pdf, ${v.docx} docx)` },
      { metric: "unique documents", value: v.files - v.duplicates - v.corrected },
      { metric: "duplicates", value: v.duplicates },
      { metric: "corrected v2", value: v.corrected },
      { metric: "pdf pages", value: v.pdfPages },
      { metric: "uncertain fields", value: `${v.uncertain} across ${v.uncertainDocs} documents` },
      { metric: "kinds", value: Object.entries(v.kinds).map(([k, n]) => `${k}=${n}`).join(", ") },
      { metric: "golden cases", value: Object.entries(v.golden).map(([k, n]) => `${k}=${n}`).join(", ") },
      { metric: "extras", value: Object.entries(v.extras).map(([k, s]) => `${k}=${s}`).join(", ") },
      { metric: "elapsed", value: `${summary.elapsedMs} ms` },
    ]);
  }
  if (failures.length) {
    console.error(`\n${failures.length} problem(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nfixtures verified OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
