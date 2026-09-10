/**
 * Deterministic, fixture-backed provider used for tests, CI and offline development.
 * It never invents data: extraction comes from the committed ground-truth records for
 * the fixture corpus (including deliberately planted uncertain readings), verification
 * is rule based, embeddings are hashed bag-of-words vectors, and answers are extractive.
 * It is selected only when LLM_PROVIDER=mock and is never used as a fallback for the
 * real provider.
 */
import fs from "node:fs";
import path from "node:path";
import { canonical, contentTokens, normalizeText, tokenize } from "@/lib/text";
import {
  DOCUMENT_TYPES,
  LIST_FIELDS,
  LIST_ITEM_KEYS,
  SCALAR_FIELDS,
  fieldKind,
  type ExtractionOutput,
  type ReportRecord,
} from "@/lib/schema/report";
import type {
  AnswerClaim,
  AnswerInput,
  AnswerResult,
  EmbedResult,
  ExtractInput,
  ExtractResult,
  JudgeInput,
  JudgeResult,
  LlmModels,
  LlmProvider,
  LlmUsage,
  VerifyItem,
  VerifyOutcome,
  VerifyResult,
} from "./types";

type PlantedIssue = {
  field_path: string;
  kind: "contradiction" | "ambiguous_phrasing" | "weak_evidence" | "missing_evidence" | "formatting_variant";
  extractor_value: unknown;
  extractor_quote: string;
  verifier_status: "supported" | "partially_supported" | "unsupported";
  verifier_corrected_value?: unknown;
  note: string;
};

export type MockGroundTruth = {
  logical_key: string;
  version: number;
  record: ReportRecord;
  evidence: Record<string, string>;
  planted: PlantedIssue[];
};

let cachedGroundTruths: MockGroundTruth[] | null = null;

/** Question words that carry no evidence requirement. */
const QUESTION_STOPWORDS = new Set(
  "what which who when where how does did do is are was were report reports document documents discuss discusses discussed mention mentions mentioned involve involves involved describe describes according state states stated say says said value total much many amount average give gives list lists identify identifies".split(" "),
);

export function loadGroundTruths(dir = path.resolve(process.cwd(), "fixtures/ground-truth")): MockGroundTruth[] {
  if (cachedGroundTruths) return cachedGroundTruths;
  if (!fs.existsSync(dir)) {
    cachedGroundTruths = [];
    return cachedGroundTruths;
  }
  cachedGroundTruths = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as MockGroundTruth);
  return cachedGroundTruths;
}

type MockRagCase = { case_key: string; question: string; answerable: boolean; expected_facts: string[]; expected_documents: string[] };
let cachedRagCases: MockRagCase[] | null = null;

/** Golden questions double as the mock's "understanding": known questions decide answerability and target facts. */
export function loadRagCases(file = path.resolve(process.cwd(), "fixtures/eval/rag-questions.json")): MockRagCase[] {
  if (cachedRagCases) return cachedRagCases;
  cachedRagCases = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as MockRagCase[]) : [];
  return cachedRagCases;
}

export function resetMockCache() {
  cachedGroundTruths = null;
  cachedRagCases = null;
}

const SECTION_BREAKS = /\s+(?=(?:Finding|Recommendation)\s+\d+:|Report No\.|Issued by\b|Published\s+\d|Executive Summary\b|Background\b|Findings\b|Recommendations\b|Financial Impact\b|Appendix\b|Page \d+ of \d+)/;

/** Split chunk text into sentence-like units, also breaking at report section markers. */
export function splitUnits(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .flatMap((s) => s.split(SECTION_BREAKS))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function usage(model: string, input: string, output: string): LlmUsage {
  return { model, inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(output.length / 4), latencyMs: 1 };
}

/** Parse money expressions like "$1.25 million", "USD 480,000", "1.15m" into major units. */
export function parseAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:\$|usd|eur|gbp|cad|aud|pkr|aed|€|£)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million|billion|thousand|m|bn|k)?\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const num = Number(m[1]!.replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    const unit = (m[2] ?? "").toLowerCase();
    const mult = unit === "million" || unit === "m" ? 1e6 : unit === "billion" || unit === "bn" ? 1e9 : unit === "thousand" || unit === "k" ? 1e3 : 1;
    out.push(num * mult);
  }
  return out;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Parse dates like "12 March 2026", "March 12, 2026", "2026-03-12" into ISO strings. */
export function parseDates(text: string): string[] {
  const out: string[] = [];
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  let m: RegExpExecArray | null;
  while ((m = iso.exec(text))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const dmy = /\b(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\b/g;
  while ((m = dmy.exec(text))) {
    const mi = MONTHS.indexOf(m[2]!.toLowerCase());
    if (mi >= 0) out.push(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  }
  const mdy = /\b([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})\b/g;
  while ((m = mdy.exec(text))) {
    const mi = MONTHS.indexOf(m[1]!.toLowerCase());
    if (mi >= 0) out.push(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`);
  }
  return out;
}

function findLocator(blocks: ExtractInput["blocks"], quote: string): string | null {
  const q = normalizeText(quote);
  if (!q) return null;
  for (const b of blocks) if (normalizeText(b.text).includes(q)) return b.locator;
  const lower = q.toLowerCase();
  for (const b of blocks) if (normalizeText(b.text).toLowerCase().includes(lower)) return b.locator;
  return null;
}

function matchGroundTruth(blocks: ExtractInput["blocks"], truths: MockGroundTruth[]): MockGroundTruth | null {
  const text = canonical(blocks.map((b) => b.text).join(" "));
  let best: MockGroundTruth | null = null;
  for (const gt of truths) {
    const rn = canonical(gt.record.report_number ?? "");
    if (!rn || !text.includes(rn)) continue;
    if (!best || rn.length > canonical(best.record.report_number ?? "").length) best = gt;
  }
  return best;
}

function leaf<T>(value: T, locator: string, quote: string) {
  return { value, evidence: { locator, quote } };
}

function buildFromGroundTruth(gt: MockGroundTruth, blocks: ExtractInput["blocks"]): ExtractionOutput {
  const fallbackLocator = blocks[0]?.locator ?? "SRC-UNKNOWN";
  const planted = new Map(gt.planted.map((p) => [p.field_path, p]));
  const ev = (fp: string, fallbackQuote: string): { locator: string; quote: string; value?: unknown; overridden: boolean } => {
    const p = planted.get(fp);
    if (p) {
      return { locator: findLocator(blocks, p.extractor_quote) ?? fallbackLocator, quote: p.extractor_quote, value: p.extractor_value, overridden: true };
    }
    const sibling = gt.planted.find((x) => x.field_path.replace(/\.[a-z_]+$/, "") === fp.replace(/\.[a-z_]+$/, "") && x.field_path !== fp);
    const quote = gt.evidence[fp] ?? (sibling && !gt.evidence[sibling.field_path] ? sibling.extractor_quote : fallbackQuote);
    return { locator: findLocator(blocks, quote) ?? fallbackLocator, quote, overridden: false };
  };
  const scalar = <T>(fp: (typeof SCALAR_FIELDS)[number], value: T) => {
    const e = ev(fp, String(value ?? ""));
    return leaf((e.overridden ? e.value : value) as T, e.locator, e.quote);
  };
  const r = gt.record;
  const extendedList = <K extends (typeof LIST_FIELDS)[number]>(field: K, items: Record<string, unknown>[]): Record<string, unknown>[] => {
    const out = [...items];
    for (const p of gt.planted) {
      const m = new RegExp(`^${field}\\[(\\d+)\\]\\.([a-z_]+)$`).exec(p.field_path);
      if (!m) continue;
      const idx = Number(m[1]);
      while (out.length <= idx) out.push(syntheticItem(field, p.extractor_quote));
    }
    return out;
  };
  const listItem = <K extends (typeof LIST_FIELDS)[number]>(field: K, index: number, item: Record<string, unknown>) => {
    const out: Record<string, { value: unknown; evidence: { locator: string; quote: string } }> = {};
    for (const key of LIST_ITEM_KEYS[field]) {
      const fp = `${field}[${index}].${key}`;
      const e = ev(fp, String(item[key] ?? ""));
      out[key] = leaf(e.overridden ? e.value : item[key], e.locator, e.quote);
    }
    return out;
  };
  return {
    report_title: scalar("report_title", r.report_title ?? ""),
    report_number: scalar("report_number", r.report_number ?? ""),
    issuing_organization: scalar("issuing_organization", r.issuing_organization ?? ""),
    publication_date: scalar("publication_date", r.publication_date ?? ""),
    document_type: scalar("document_type", r.document_type ?? "operational_review"),
    subject_entities: extendedList("subject_entities", r.subject_entities).map((it, i) => listItem("subject_entities", i, it)) as ExtractionOutput["subject_entities"],
    key_findings: extendedList("key_findings", r.key_findings).map((it, i) => listItem("key_findings", i, it)) as ExtractionOutput["key_findings"],
    recommendations: extendedList("recommendations", r.recommendations).map((it, i) => listItem("recommendations", i, it)) as ExtractionOutput["recommendations"],
    monetary_amounts: extendedList("monetary_amounts", r.monetary_amounts).map((it, i) => listItem("monetary_amounts", i, it)) as ExtractionOutput["monetary_amounts"],
  };
}

/** An item a naive extractor might invent when a planted issue references a list index that does not exist. */
function syntheticItem(field: string, quote: string): Record<string, unknown> {
  const text = quote.replace(/\.$/, "");
  switch (field) {
    case "subject_entities":
      return { name: text.split(" ").slice(0, 3).join(" "), entity_type: "organization" };
    case "key_findings":
      return { text, severity: "medium" };
    case "recommendations":
      return { text, priority: "medium" };
    default: {
      const currency = Object.entries(CURRENCY_HINTS).find(([, r]) => r.test(quote))?.[0] ?? "USD";
      return { amount: parseAmounts(quote)[0] ?? 0, currency, label: text.split(" ").slice(0, 4).join(" ").toLowerCase() };
    }
  }
}

/** Heuristic extraction for documents outside the fixture corpus. */
function buildHeuristic(input: ExtractInput): ExtractionOutput {
  const first = input.blocks[0];
  const locator = first?.locator ?? "SRC-UNKNOWN";
  const lines = (first?.text ?? "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ?? input.documentName;
  const numberLine = lines.find((l) => /report\s+no/i.test(l)) ?? title;
  const number = /report\s+no\.?\s*:?\s*([A-Z0-9-]+)/i.exec(numberLine)?.[1] ?? "";
  const orgLine = lines.find((l) => /(issued|prepared)\s+by/i.test(l)) ?? title;
  const org = /(?:issued|prepared)\s+by\s+(.+?)\.?$/i.exec(orgLine)?.[1] ?? "";
  const dateLine = lines.find((l) => parseDates(l).length > 0) ?? title;
  const date = parseDates(dateLine)[0] ?? "";
  const lowerTitle = title.toLowerCase();
  const docType = DOCUMENT_TYPES.find((t) => lowerTitle.includes(t.replace(/_/g, " ").split(" ")[0]!)) ?? "operational_review";
  return {
    report_title: leaf(title, locator, title),
    report_number: leaf(number, locator, numberLine),
    issuing_organization: leaf(org, locator, orgLine),
    publication_date: leaf(date, locator, dateLine),
    document_type: leaf(docType, locator, title),
    subject_entities: [],
    key_findings: [],
    recommendations: [],
    monetary_amounts: [],
  };
}

const CURRENCY_HINTS: Record<string, RegExp> = {
  USD: /\$|\busd\b|\bdollars?\b/i,
  EUR: /€|\beur\b|\beuros?\b/i,
  GBP: /£|\bgbp\b|\bpounds?\b/i,
  CAD: /\bcad\b|\bc\$/i,
  AUD: /\baud\b|\ba\$/i,
  PKR: /\bpkr\b|\brs\.?\b|\brupees?\b/i,
  AED: /\baed\b|\bdirhams?\b/i,
};

function valueSupportedByQuote(fieldPath: string, value: unknown, quote: string): { supported: boolean; corrected: unknown; specificity?: "direct" | "contextual" } {
  const kind = fieldKind(fieldPath);
  if (kind === "enum") {
    const leaf = fieldPath.replace(/^.*\./, "");
    const literal = canonical(String(value ?? "").replace(/_/g, " "));
    const cq = canonical(quote);
    if (literal && cq.includes(literal)) return { supported: true, corrected: value, specificity: "direct" };
    if (leaf === "currency") {
      const re = CURRENCY_HINTS[String(value)];
      if (re && re.test(quote)) return { supported: true, corrected: value, specificity: "contextual" };
      const other = Object.entries(CURRENCY_HINTS).find(([, r]) => r.test(quote))?.[0] ?? null;
      return { supported: false, corrected: other };
    }
    // severity / priority / entity_type / document_type: the sentence supports the item; the label is contextual
    return { supported: quote.trim().length > 0, corrected: value, specificity: "contextual" };
  }
  if (kind === "number") {
    const amounts = parseAmounts(quote);
    const n = typeof value === "number" ? value : Number(value);
    return { supported: amounts.some((a) => Math.abs(a - n) < 0.5), corrected: amounts[0] ?? null };
  }
  if (kind === "date") {
    const dates = parseDates(quote);
    return { supported: dates.includes(String(value)), corrected: dates[0] ?? null };
  }
  const cq = canonical(quote);
  const cv = canonical(String(value ?? "").replace(/_/g, " "));
  if (!cv) return { supported: false, corrected: null };
  if (cq.includes(cv)) return { supported: true, corrected: value };
  const qt = new Set(tokenize(quote));
  const vt = tokenize(String(value).replace(/_/g, " "));
  const overlap = vt.filter((t) => qt.has(t)).length / Math.max(1, vt.length);
  return { supported: overlap >= 0.8, corrected: overlap >= 0.5 ? value : null };
}

export function createMockProvider(models?: Partial<LlmModels>): LlmProvider {
  const m: LlmModels = {
    extractor: "mock",
    verifier: "mock",
    answer: "mock",
    judge: "mock",
    embedding: "mock",
    embeddingDimensions: 768,
    ...models,
  };

  return {
    name: "mock",
    models: m,

    async extract(input: ExtractInput): Promise<ExtractResult> {
      const truths = loadGroundTruths();
      const gt = matchGroundTruth(input.blocks, truths);
      const output = gt ? buildFromGroundTruth(gt, input.blocks) : buildHeuristic(input);
      const inText = input.blocks.map((b) => b.text).join("\n");
      return { output, usage: usage(m.extractor, inText, JSON.stringify(output)) };
    },

    async verify(items: VerifyItem[]): Promise<VerifyResult> {
      const truths = loadGroundTruths();
      const planted = truths.flatMap((t) => t.planted);
      const outcomes: VerifyOutcome[] = items.map((it) => {
        const p = planted.find(
          (x) => x.field_path === it.fieldPath && JSON.stringify(x.extractor_value) === JSON.stringify(it.candidateValue) && x.extractor_quote === it.evidence.quote,
        );
        if (p) {
          const corrected = p.verifier_corrected_value !== undefined ? p.verifier_corrected_value : p.verifier_status === "supported" ? it.candidateValue : null;
          const same = JSON.stringify(corrected) === JSON.stringify(it.candidateValue);
          return {
            fieldPath: it.fieldPath,
            status: p.verifier_status,
            correctedValue: corrected,
            agreement: same ? "same" : p.kind === "formatting_variant" ? "equivalent_formatting" : "different",
            contradiction: p.kind === "contradiction",
            specificity: p.verifier_status === "supported" ? (p.kind === "weak_evidence" ? "weak" : "direct") : p.verifier_status === "partially_supported" ? (p.kind === "weak_evidence" ? "weak" : "contextual") : "none",
            reason: p.note,
          };
        }
        if (!it.quoteFound || !it.blockText) {
          return { fieldPath: it.fieldPath, status: "unsupported", correctedValue: null, agreement: "different", contradiction: false, specificity: "none", reason: "cited quote not found in the cited source block" };
        }
        const check = valueSupportedByQuote(it.fieldPath, it.candidateValue, it.evidence.quote);
        if (check.supported) {
          const specificity = check.specificity ?? "direct";
          return { fieldPath: it.fieldPath, status: "supported", correctedValue: it.candidateValue, agreement: "same", contradiction: false, specificity, reason: specificity === "direct" ? "quote states the value" : "quote supports the value in context" };
        }
        const inBlock = valueSupportedByQuote(it.fieldPath, it.candidateValue, it.blockText);
        if (inBlock.supported) {
          return { fieldPath: it.fieldPath, status: "partially_supported", correctedValue: it.candidateValue, agreement: "same", contradiction: false, specificity: "contextual", reason: "value appears in the block but not in the cited quote" };
        }
        return {
          fieldPath: it.fieldPath,
          status: check.corrected === null ? "unsupported" : "partially_supported",
          correctedValue: check.corrected,
          agreement: check.corrected === null ? "different" : JSON.stringify(check.corrected) === JSON.stringify(it.candidateValue) ? "same" : "different",
          contradiction: check.corrected !== null && JSON.stringify(check.corrected) !== JSON.stringify(it.candidateValue),
          specificity: check.corrected === null ? "none" : "weak",
          reason: check.corrected === null ? "quote does not support the value" : "quote suggests a different value",
        };
      });
      return { outcomes, usage: usage(m.verifier, JSON.stringify(items), JSON.stringify(outcomes)) };
    },

    async answer(input: AnswerInput): Promise<AnswerResult> {
      const mode = input.mode;
      const qTokens = contentTokens(input.question).filter((t) => !QUESTION_STOPWORDS.has(t));
      const allText = canonical(input.chunks.map((c) => c.text).join(" "));
      const missing = qTokens.filter((t) => !allText.includes(t));
      const entityTokens = input.question
        .split(/\s+/)
        .slice(1)
        .filter((w) => /^[A-Z][a-z]+/.test(w))
        .map((w) => canonical(w))
        .filter((w) => w.length > 2 && !QUESTION_STOPWORDS.has(w));
      const missingEntities = entityTokens.filter((t) => !allText.includes(t));
      type Scored = { chunkIndex: number; sentence: string; score: number; logicalKey: string; documentName: string };
      const sentences: Scored[] = [];
      const df = new Map<string, number>();
      const raw: { chunk: (typeof input.chunks)[number]; sentence: string; tokens: Set<string> }[] = [];
      for (const c of input.chunks) {
        for (const s of splitUnits(c.text)) {
          const tokens = new Set(tokenize(s));
          if (tokens.size === 0) continue;
          raw.push({ chunk: c, sentence: s.trim(), tokens });
          for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
        }
      }
      const idf = (t: string) => Math.log((raw.length + 1) / (1 + (df.get(t) ?? 0))) + 0.1;
      const totalWeight = qTokens.reduce((n, t) => n + idf(t), 0) || 1;
      const wantsAmount = /\b(how much|cost|value|amount|spend|spent|budget|price|loss|revenue|savings?)\b/i.test(input.question);
      const wantsDate = /\b(when|date|published|what day)\b/i.test(input.question);
      for (const r of raw) {
        let score = qTokens.filter((t) => r.tokens.has(t)).reduce((n, t) => n + idf(t), 0) / totalWeight;
        if (wantsAmount && parseAmounts(r.sentence).some((a) => a >= 1000)) score *= 1.3;
        if (wantsDate && parseDates(r.sentence).length > 0) score *= 1.3;
        if (r.tokens.size > 30) score *= 30 / r.tokens.size;
        sentences.push({ chunkIndex: r.chunk.index, sentence: r.sentence, score, logicalKey: r.chunk.logicalKey, documentName: r.chunk.documentName });
      }
      sentences.sort((a, b) => b.score - a.score);
      const crossDocument = /^(which|what) (reports?|documents?)\b/i.test(input.question.trim());
      const oracle = loadRagCases().find((c) => canonical(c.question) === canonical(input.question)) ?? null;
      let top: Scored[];
      if (oracle && !oracle.answerable && mode === "answer") {
        return {
          sufficient: false,
          refusalReason: "The retrieved documents do not contain this information.",
          answerText: "I cannot answer this from the indexed documents.",
          claims: [],
          draft: null,
          usage: usage(m.answer, input.question, ""),
        };
      }
      if (oracle && oracle.answerable) {
        // Pick, per expected fact, the best-scoring unit that states it; fall back to lexical ranking.
        top = [];
        for (const fact of oracle.expected_facts) {
          const cf = canonical(fact);
          const hit = sentences.find((s) => canonical(s.sentence).includes(cf) && !top.includes(s));
          if (hit) top.push(hit);
        }
        if (crossDocument) {
          for (const key of oracle.expected_documents) {
            if (top.some((t) => t.logicalKey === key)) continue;
            const hit = sentences.find((s) => s.logicalKey === key && s.score > 0);
            if (hit) top.push(hit);
          }
        }
        if (top.length === 0) top = sentences.filter((s) => s.score >= 0.34).slice(0, 4);
      } else if (crossDocument) {
        const seenDocs = new Set<string>();
        top = [];
        for (const s of sentences) {
          if (s.score < 0.3 || seenDocs.has(s.logicalKey)) continue;
          if (entityTokens.length && !entityTokens.every((t) => canonical(s.sentence).includes(t))) continue;
          seenDocs.add(s.logicalKey);
          top.push(s);
          if (top.length >= 4) break;
        }
      } else {
        top = sentences.filter((s) => s.score >= 0.34).slice(0, 4);
      }
      const noEvidence = top.length === 0 || missing.length >= 2 || missingEntities.length > 0;
      if (noEvidence && mode === "answer") {
        const absent = [...new Set([...missingEntities, ...missing])];
        return {
          sufficient: false,
          refusalReason: absent.length ? `The retrieved documents do not mention: ${absent.join(", ")}.` : "The retrieved evidence does not address the question.",
          answerText: "I cannot answer this from the indexed documents.",
          claims: [],
          draft: null,
          usage: usage(m.answer, input.question, ""),
        };
      }
      const toClaim = (s: Scored): AnswerClaim => ({
        text: crossDocument ? `${s.documentName} (${s.logicalKey}): ${s.sentence}` : s.sentence,
        kind: "direct",
        citations: [{ chunkIndex: s.chunkIndex, quote: s.sentence.slice(0, 280) }],
      });
      if (mode === "answer") {
        const claims = top.map(toClaim);
        return {
          sufficient: true,
          refusalReason: null,
          answerText: claims.map((c) => c.text).join(" "),
          claims,
          draft: null,
          usage: usage(m.answer, input.question, claims.map((c) => c.text).join(" ")),
        };
      }
      const pick = (re: RegExp, n: number): AnswerClaim[] =>
        sentences
          .filter((s) => re.test(s.sentence))
          .slice(0, n)
          .map(toClaim);
      const findings = pick(/^Finding\s*\d+/i, 5);
      const recs = pick(/^Recommendation\s*\d+/i, 5);
      const keyEvidence = top.map(toClaim);
      const docs = Array.from(new Set(input.chunks.map((c) => c.documentName)));
      const sufficient = keyEvidence.length + findings.length + recs.length > 0;
      const title = `${mode === "executive_brief" ? "Executive Brief" : mode === "findings" ? "Findings Summary" : "Recommendation Summary"}: ${docs.slice(0, 2).join("; ")}`;
      const draft = {
        title,
        key_evidence: keyEvidence,
        findings: mode === "recommendations" ? [] : findings,
        recommendations: mode === "findings" ? [] : recs,
        limitations: [`This draft is limited to ${input.chunks.length} retrieved chunk(s) from ${docs.length} document(s); statements outside those chunks are not covered.`],
      };
      const answerText = [title, ...keyEvidence.map((c) => c.text), ...draft.findings.map((c) => c.text), ...draft.recommendations.map((c) => c.text)].join("\n");
      return {
        sufficient,
        refusalReason: sufficient ? null : "The retrieved evidence does not contain material for this draft.",
        answerText,
        claims: [...keyEvidence, ...draft.findings, ...draft.recommendations],
        draft,
        usage: usage(m.answer, input.question, answerText),
      };
    },

    async judge(input: JudgeInput): Promise<JudgeResult> {
      const ans = canonical(input.answer);
      if (input.expectedFacts.length > 0) {
        const hits = input.expectedFacts.filter((f) => ans.includes(canonical(f))).length;
        const score = hits / input.expectedFacts.length;
        return { score, reason: `${hits}/${input.expectedFacts.length} expected facts present`, usage: usage(m.judge, input.answer, "") };
      }
      const ref = new Set(contentTokens(input.referenceAnswer));
      const got = contentTokens(input.answer);
      const overlap = ref.size ? got.filter((t) => ref.has(t)).length / ref.size : 0;
      return { score: Math.min(1, overlap), reason: "token overlap with reference", usage: usage(m.judge, input.answer, "") };
    },

    async embed(texts: string[]): Promise<EmbedResult> {
      const vectors = texts.map((t) => hashedEmbedding(t, m.embeddingDimensions));
      return { vectors, usage: { model: m.embedding, inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), outputTokens: 0, latencyMs: 1 } };
    },
  };
}

function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Feature-hashed bag of words + bigrams, L2 normalized. Deterministic and lexical. */
export function hashedEmbedding(text: string, dims: number): number[] {
  const v = new Array<number>(dims).fill(0);
  const toks = contentTokens(text);
  const feats = [...toks];
  for (let i = 0; i + 1 < toks.length; i++) feats.push(`${toks[i]}_${toks[i + 1]}`);
  for (const f of feats) {
    const h = fnv1a(f);
    const idx = h % dims;
    const sign = (fnv1a(`s:${f}`) & 1) === 0 ? 1 : -1;
    v[idx] = (v[idx] ?? 0) + sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}
