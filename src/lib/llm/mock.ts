/**
 * Deterministic, fixture-backed provider for tests, CI and offline development (LLM_PROVIDER=mock).
 * It never invents data: extraction comes from the committed truth records (including the planted
 * uncertain readings), verification is rule based, embeddings are hashed bag-of-words vectors,
 * answers are extractive with real citations, and known golden questions decide answerability.
 * It is selected only explicitly and is never used as a fallback for the real provider.
 */
import fs from "node:fs";
import path from "node:path";
import { canonical, contentTokens, normalizeText, tokenize } from "@/lib/text";
import { INSUFFICIENT_EVIDENCE } from "@/lib/config";
import { formatCitation } from "./prompts";
import { LIST_FIELDS, LIST_ITEM_KEYS, SCALAR_FIELDS, fieldKind, parseFieldPath, type ExtractionOutput, type ReportRecord } from "@/lib/schema/report";
import type { AnswerInput, AnswerResult, EmbedResult, ExtractInput, ExtractResult, JudgeInput, JudgeResult, LlmModels, LlmProvider, LlmUsage, VerifyItem, VerifyOutcome, VerifyResult } from "./types";

export type MockUncertainField = {
  field_path: string;
  kind: string;
  reason: string;
  extractor_value: unknown;
  extractor_locators: string[];
  extractor_quotes: string[];
  extractor_ambiguity: string | null;
  verifier: { status: "supported" | "partially_supported" | "unsupported"; corrected_value: unknown; contradiction_detected: boolean; evidence_specificity: number };
  expect_routed: boolean;
};

export type MockTruth = {
  logical_key: string;
  version: number;
  record: ReportRecord;
  evidence: Record<string, { locators: string[]; quotes: string[] }>;
  uncertain_fields: MockUncertainField[];
};

type MockGoldenCase = { case_key: string; category: string; question: string; expected_answer: string; expected_documents: string[]; expected_locators: string[]; expected_facts: string[] };

let cachedTruths: MockTruth[] | null = null;
let cachedGolden: MockGoldenCase[] | null = null;

export function loadTruths(dir = path.resolve(process.cwd(), "fixtures/truth")): MockTruth[] {
  if (cachedTruths) return cachedTruths;
  cachedTruths = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as MockTruth)
    : [];
  return cachedTruths;
}

export function loadGolden(file = path.resolve(process.cwd(), "fixtures/golden/rag-cases.json")): MockGoldenCase[] {
  if (cachedGolden) return cachedGolden;
  cachedGolden = fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as MockGoldenCase[]) : [];
  return cachedGolden;
}

export function resetMockCache() {
  cachedTruths = null;
  cachedGolden = null;
}

function usage(model: string, input: string, output: string): LlmUsage {
  return { model, inputTokens: Math.ceil(input.length / 4), outputTokens: Math.ceil(output.length / 4), latencyMs: 1 };
}

/** Parse money expressions like "$1.25 million", "USD 480,000", "1.15m" into major units. */
export function parseAmounts(text: string): number[] {
  const out: number[] = [];
  const re = /(?:\$|usd|eur|gbp|cad|aud|€|£)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(million|billion|thousand|m|bn|k)?\b/gi;
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
const MONTH_ABBR = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec"];

function monthIndex(name: string): number {
  const n = name.toLowerCase().replace(/\.$/, "");
  const full = MONTHS.indexOf(n);
  if (full >= 0) return full;
  const abbr = MONTH_ABBR.indexOf(n);
  if (abbr < 0) return -1;
  return abbr >= 9 ? abbr - 1 : abbr; // "sept" shares September's slot
}

/** Parse dates like "12 March 2026", "March 12, 2026", "2026-03-12", "4 Sept. 26" into ISO strings. */
export function parseDates(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
  while ((m = iso.exec(text))) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  const dmy = /\b(\d{1,2})\s+([A-Za-z]+\.?)\s+(\d{2,4})\b/g;
  while ((m = dmy.exec(text))) {
    const mi = monthIndex(m[2]!);
    if (mi < 0) continue;
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    out.push(`${year}-${String(mi + 1).padStart(2, "0")}-${m[1]!.padStart(2, "0")}`);
  }
  const mdy = /\b([A-Za-z]+\.?)\s+(\d{1,2}),\s+(\d{4})\b/g;
  while ((m = mdy.exec(text))) {
    const mi = monthIndex(m[1]!);
    if (mi >= 0) out.push(`${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`);
  }
  return out;
}

function findLocators(blocks: ExtractInput["blocks"], quote: string): string[] {
  const q = normalizeText(quote);
  if (!q) return [];
  const hits = blocks.filter((b) => normalizeText(b.text).includes(q)).map((b) => b.source_block_id);
  if (hits.length) return hits;
  const lower = q.toLowerCase();
  return blocks.filter((b) => normalizeText(b.text).toLowerCase().includes(lower)).map((b) => b.source_block_id);
}

function matchTruth(input: ExtractInput, truths: MockTruth[]): MockTruth | null {
  const exact = truths.find((t) => t.logical_key === input.logicalKey && t.version === input.versionNumber);
  if (exact) return exact;
  const text = canonical(input.blocks.map((b) => b.text).join(" "));
  let best: MockTruth | null = null;
  for (const t of truths) {
    const rn = canonical(t.record.report_number ?? "");
    if (!rn || !text.includes(rn)) continue;
    if (!best || rn.length > canonical(best.record.report_number ?? "").length) best = t;
  }
  return best;
}

type Prov = { source_block_ids: string[]; evidence_quotes: string[]; ambiguity: string | null };

function buildFromTruth(t: MockTruth, input: ExtractInput): ExtractionOutput {
  const blocks = input.blocks;
  const fallback = blocks[0]?.source_block_id ?? "SRC-UNKNOWN";
  const planted = new Map(t.uncertain_fields.map((u) => [u.field_path, u]));
  const prov = (fp: string, fallbackQuote: string | null): { p: Prov; override?: unknown } => {
    const u = planted.get(fp);
    if (u) {
      const ids = u.extractor_locators.length ? u.extractor_locators : u.extractor_quotes.flatMap((q) => findLocators(blocks, q));
      return { p: { source_block_ids: ids.length ? ids : [fallback], evidence_quotes: u.extractor_quotes, ambiguity: u.extractor_ambiguity }, override: u.extractor_value };
    }
    const ev = t.evidence[fp];
    if (ev) {
      const ids = ev.locators.length ? ev.locators : ev.quotes.flatMap((q) => findLocators(blocks, q));
      return { p: { source_block_ids: ids.length ? ids : [fallback], evidence_quotes: ev.quotes, ambiguity: null } };
    }
    if (fallbackQuote === null) return { p: { source_block_ids: [], evidence_quotes: [], ambiguity: null } };
    const ids = findLocators(blocks, fallbackQuote);
    return { p: { source_block_ids: ids.length ? ids : [fallback], evidence_quotes: [fallbackQuote], ambiguity: null } };
  };
  const r = t.record;
  const scalar = <T>(fp: (typeof SCALAR_FIELDS)[number], value: T) => {
    const { p, override } = prov(fp, value === null ? null : String(value));
    const v = planted.has(fp) ? (override as T) : value;
    return { value: v, ...p };
  };
  const list = <K extends (typeof LIST_FIELDS)[number]>(field: K) => {
    const items = [...(r[field] as (Record<string, unknown> | null)[])];
    // planted indexes beyond the record mean "an extractor may invent this item"
    for (const u of t.uncertain_fields) {
      const { root, index } = parseFieldPath(u.field_path);
      if (root !== field || index === null) continue;
      while (items.length <= index) items.push(null);
    }
    return items.map((item, i) => {
      const fp = `${field}[${i}]`;
      const { p, override } = prov(fp, item ? String(Object.values(item)[0] ?? "") : null);
      const value = (planted.has(fp) ? override : item) as Record<string, unknown> | null;
      const out: Record<string, unknown> = { ...p };
      for (const k of LIST_ITEM_KEYS[field]) out[k] = value?.[k] ?? (k === "amount" ? 0 : k === "severity" ? "info" : k === "target_entity" || k === "status_if_stated" ? null : "");
      return out;
    });
  };
  return {
    report_title: scalar("report_title", r.report_title),
    report_number: scalar("report_number", r.report_number),
    issuing_organization: scalar("issuing_organization", r.issuing_organization),
    publication_date: scalar("publication_date", r.publication_date),
    document_type: scalar("document_type", r.document_type ?? "other"),
    subject_entities: list("subject_entities") as ExtractionOutput["subject_entities"],
    key_findings: list("key_findings") as ExtractionOutput["key_findings"],
    recommendations: list("recommendations") as ExtractionOutput["recommendations"],
    monetary_amounts: list("monetary_amounts") as ExtractionOutput["monetary_amounts"],
  };
}

/** Heuristic extraction for documents outside the fixture corpus. */
function buildHeuristic(input: ExtractInput): ExtractionOutput {
  const first = input.blocks[0];
  const id = first?.source_block_id ?? "SRC-UNKNOWN";
  const text = first?.text ?? "";
  const sentences = text.split(/(?<=[.!?])\s+|\s{2,}/).map((l) => l.trim()).filter(Boolean);
  const title = (sentences[0] ?? "").split(/\s+Report No/i)[0] ?? "";
  const numberSentence = sentences.find((l) => /report\s+no/i.test(l)) ?? "";
  const number = /report\s+no\.?\s*:?\s*([A-Z0-9-]+)/i.exec(numberSentence)?.[1] ?? null;
  const orgSentence = sentences.find((l) => /(issued|prepared)\s+by/i.test(l)) ?? "";
  const org = /(?:issued|prepared)\s+by\s+([^.]+)/i.exec(orgSentence)?.[1]?.trim() ?? null;
  const dateSentence = sentences.find((l) => /published/i.test(l) && parseDates(l).length > 0) ?? "";
  const date = parseDates(dateSentence)[0] ?? null;
  const lower = text.toLowerCase();
  const docType = lower.includes("audit") ? "audit_report" : lower.includes("investigation") ? "investigation" : lower.includes("evaluation") ? "evaluation" : lower.includes("guidance") ? "guidance" : lower.includes("review") ? "operational_review" : "other";
  const p = (q: string): Prov => ({ source_block_ids: q ? [id] : [], evidence_quotes: q ? [q.slice(0, 200)] : [], ambiguity: null });
  return {
    report_title: { value: title || null, ...p(title) },
    report_number: { value: number, ...p(number ? numberSentence : "") },
    issuing_organization: { value: org, ...p(org ? orgSentence : "") },
    publication_date: { value: date, ...p(date ? dateSentence : "") },
    document_type: { value: docType, ...p(title) },
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
};

/** Rule-based support check for a candidate against a quote. */
function supportedByText(fieldPath: string, value: unknown, text: string): { supported: boolean; specificity: number; corrected: unknown } {
  const kind = fieldKind(fieldPath);
  const ct = canonical(text);
  if (kind === "date") {
    const dates = parseDates(text);
    return { supported: dates.includes(String(value)), specificity: dates.includes(String(value)) ? 1 : 0.4, corrected: dates[0] ?? null };
  }
  if (kind === "enum") {
    const literal = canonical(String(value).replace(/_/g, " "));
    return { supported: text.trim().length > 0, specificity: ct.includes(literal) ? 1 : 0.75, corrected: value };
  }
  if (kind === "item") {
    const item = (value ?? {}) as Record<string, unknown>;
    const root = parseFieldPath(fieldPath).root;
    if (root === "monetary_amounts") {
      const amounts = parseAmounts(text);
      const amountOk = amounts.some((a) => Math.abs(a - Number(item.amount)) < 0.5);
      const cur = String(item.currency ?? "");
      const curOk = CURRENCY_HINTS[cur]?.test(text) ?? ct.includes(canonical(cur));
      if (amountOk) return { supported: true, specificity: curOk ? 1 : 0.75, corrected: value };
      const first = amounts[0];
      return { supported: false, specificity: first !== undefined ? 0.4 : 0, corrected: first !== undefined ? { ...item, amount: first } : null };
    }
    const textKey = root === "subject_entities" ? "name" : root === "key_findings" ? "finding" : "recommendation";
    const main = canonical(item[textKey]);
    if (!main) return { supported: false, specificity: 0, corrected: null };
    const contained = ct.includes(main);
    const overlap = (() => {
      const qt = new Set(tokenize(text));
      const vt = tokenize(String(item[textKey]));
      return vt.filter((t) => qt.has(t)).length / Math.max(1, vt.length);
    })();
    if (contained || overlap >= 0.8) {
      const labelKey = root === "key_findings" ? "severity" : null;
      const labelLiteral = labelKey ? canonical(String(item[labelKey] ?? "")) : "";
      return { supported: true, specificity: !labelKey || ct.includes(labelLiteral) ? 1 : 0.75, corrected: value };
    }
    return { supported: overlap >= 0.5, specificity: overlap >= 0.5 ? 0.4 : 0, corrected: overlap >= 0.5 ? value : null };
  }
  const cv = canonical(String(value ?? ""));
  if (!cv) return { supported: false, specificity: 0, corrected: null };
  if (ct.includes(cv)) return { supported: true, specificity: 1, corrected: value };
  const qt = new Set(tokenize(text));
  const vt = tokenize(String(value));
  const overlap = vt.filter((t) => qt.has(t)).length / Math.max(1, vt.length);
  return { supported: overlap >= 0.8, specificity: overlap >= 0.8 ? 0.75 : overlap >= 0.5 ? 0.4 : 0, corrected: overlap >= 0.5 ? value : null };
}

const QUESTION_STOPWORDS = new Set(
  "what which who when where how does did do is are was were report reports document documents discuss discusses discussed mention mentions mentioned involve involves involved describe describes according state states stated say says said value total much many amount average give gives list lists identify identifies".split(" "),
);

const SECTION_BREAKS = /\s+(?=(?:Finding|Recommendation)\s+\d+:|Report No\.|Issued by\b|Published\s+\d|Executive Summary\b|Background\b|Findings\b|Recommendations\b|Financial Impact\b|Appendix\b|Page \d+ of \d+)/;

export function splitUnits(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'])/)
    .flatMap((s) => s.split(SECTION_BREAKS))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function createMockProvider(models?: Partial<LlmModels>): LlmProvider {
  const m: LlmModels = { extract: "mock", verify: "mock", rag: "mock", eval: "mock", embed: "mock", embedDimensions: 768, ...models };

  return {
    name: "mock",
    models: m,

    async extract(input: ExtractInput): Promise<ExtractResult> {
      const t = matchTruth(input, loadTruths());
      const output = t ? buildFromTruth(t, input) : buildHeuristic(input);
      return { output, usage: usage(m.extract, input.blocks.map((b) => b.text).join("\n"), JSON.stringify(output)) };
    },

    async verify(items: VerifyItem[]): Promise<VerifyResult> {
      const planted = loadTruths().flatMap((t) => t.uncertain_fields);
      const outcomes: VerifyOutcome[] = items.map((it) => {
        const u = planted.find((x) => x.field_path === it.fieldPath && JSON.stringify(x.extractor_value) === JSON.stringify(it.candidateValue) && x.extractor_quotes.join("|") === it.evidence.map((e) => e.quote).join("|"));
        if (u) {
          return {
            fieldPath: it.fieldPath,
            status: u.verifier.status,
            correctedValue: u.verifier.corrected_value ?? (u.verifier.status === "supported" ? it.candidateValue : null),
            contradictionDetected: u.verifier.contradiction_detected,
            evidenceSpecificity: u.verifier.evidence_specificity,
            reason: u.reason,
          };
        }
        const found = it.evidence.filter((e) => e.found_in_block);
        if (found.length === 0) return { fieldPath: it.fieldPath, status: "unsupported", correctedValue: null, contradictionDetected: false, evidenceSpecificity: 0, reason: "cited quote not found in the cited source block" };
        const quoteText = found.map((e) => e.quote).join(" ");
        const byQuote = supportedByText(it.fieldPath, it.candidateValue, quoteText);
        if (byQuote.supported) return { fieldPath: it.fieldPath, status: "supported", correctedValue: it.candidateValue, contradictionDetected: false, evidenceSpecificity: byQuote.specificity, reason: "the cited quote states the value" };
        const contextText = it.context.map((c) => c.text).join(" ");
        const byContext = supportedByText(it.fieldPath, it.candidateValue, contextText);
        if (byContext.supported) return { fieldPath: it.fieldPath, status: "partially_supported", correctedValue: it.candidateValue, contradictionDetected: false, evidenceSpecificity: 0.75, reason: "the value appears in the surrounding context but not in the cited quote" };
        const contradiction = byQuote.corrected !== null && JSON.stringify(byQuote.corrected) !== JSON.stringify(it.candidateValue);
        return {
          fieldPath: it.fieldPath,
          status: byQuote.corrected === null ? "unsupported" : "partially_supported",
          correctedValue: byQuote.corrected,
          contradictionDetected: contradiction,
          evidenceSpecificity: byQuote.corrected === null ? 0 : 0.4,
          reason: byQuote.corrected === null ? "the cited quote does not support the value" : "the cited quote suggests a different value",
        };
      });
      return { outcomes, usage: usage(m.verify, JSON.stringify(items), JSON.stringify(outcomes)) };
    },

    async answer(input: AnswerInput): Promise<AnswerResult> {
      const q = input.question;
      const oracle = loadGolden().find((c) => canonical(c.question) === canonical(q)) ?? null;
      if (oracle && oracle.category === "unanswerable" && input.mode === "answer") return { text: INSUFFICIENT_EVIDENCE, usage: usage(m.rag, q, "") };

      const qTokens = contentTokens(q).filter((t) => !QUESTION_STOPWORDS.has(t));
      type Unit = { block: AnswerInput["blocks"][number]; sentence: string; tokens: Set<string> };
      const units: Unit[] = [];
      const df = new Map<string, number>();
      for (const b of input.blocks) {
        for (const s of splitUnits(b.text)) {
          const tokens = new Set(tokenize(s));
          if (tokens.size === 0) continue;
          units.push({ block: b, sentence: s, tokens });
          for (const t of tokens) df.set(t, (df.get(t) ?? 0) + 1);
        }
      }
      const idf = (t: string) => Math.log((units.length + 1) / (1 + (df.get(t) ?? 0))) + 0.1;
      const totalWeight = qTokens.reduce((n, t) => n + idf(t), 0) || 1;
      const wantsAmount = /\b(how much|cost|value|amount|spend|spent|budget|price|loss|revenue|savings?|figure)\b/i.test(q);
      const wantsDate = /\b(when|date|published|what day)\b/i.test(q);
      const scored = units
        .map((u) => {
          let score = qTokens.filter((t) => u.tokens.has(t)).reduce((n, t) => n + idf(t), 0) / totalWeight;
          if (wantsAmount && parseAmounts(u.sentence).some((a) => a >= 1000)) score *= 1.3;
          if (wantsDate && parseDates(u.sentence).length > 0) score *= 1.3;
          if (u.tokens.size > 30) score *= 30 / u.tokens.size;
          return { ...u, score };
        })
        .sort((a, b) => b.score - a.score);

      let picked: typeof scored = [];
      if (oracle && oracle.category !== "unanswerable") {
        for (const fact of oracle.expected_facts) {
          const cf = canonical(fact);
          const hit = scored.find((s) => canonical(s.sentence).includes(cf) && !picked.includes(s));
          if (hit) picked.push(hit);
        }
        for (const key of oracle.expected_documents) {
          if (picked.some((p) => p.block.logicalKey === key)) continue;
          const hit = scored.find((s) => s.block.logicalKey === key && s.score > 0);
          if (hit) picked.push(hit);
        }
      }
      if (picked.length === 0) {
        const allText = canonical(input.blocks.map((b) => b.text).join(" "));
        const missing = qTokens.filter((t) => !allText.includes(t));
        picked = missing.length >= 2 ? [] : scored.filter((s) => s.score >= 0.34).slice(0, 4);
      }
      if (picked.length === 0) {
        return { text: input.mode === "answer" ? INSUFFICIENT_EVIDENCE : `Title\nNo draft could be produced.\n\nEvidence Limitations\n${INSUFFICIENT_EVIDENCE}`, usage: usage(m.rag, q, "") };
      }
      const cite = (u: Unit) => formatCitation(u.block.logicalKey, u.block.version, u.block.locator);
      if (input.mode === "answer") {
        const text = picked.map((u) => `${u.sentence} ${cite(u)}`).join(" ");
        return { text, usage: usage(m.rag, q, text) };
      }
      const findings = scored.filter((u) => /^Finding\s*\d+/i.test(u.sentence)).slice(0, 5);
      const recs = scored.filter((u) => /^Recommendation\s*\d+/i.test(u.sentence)).slice(0, 5);
      const docs = [...new Set(input.blocks.map((b) => b.document))];
      const lines = (xs: Unit[]) => (xs.length ? xs.map((u) => `${u.sentence} ${cite(u)}`).join("\n") : "None stated in the retrieved evidence.");
      let text: string;
      if (input.mode === "executive_brief") {
        text = `Title\nExecutive Brief: ${docs.slice(0, 2).join("; ")}\n\nExecutive Summary\n${lines(picked)}\n\nKey Findings\n${lines(findings)}\n\nRecommendations Stated in the Sources\n${lines(recs)}\n\nRisks / Contradictions\nNone identified in the retrieved evidence.\n\nEvidence Limitations\nThis draft is limited to ${input.blocks.length} retrieved source block(s) from ${docs.length} document(s).`;
      } else if (input.mode === "findings") {
        text = `Title\nFindings Summary: ${docs.slice(0, 2).join("; ")}\n\nFindings\n${lines(findings)}\n\nSupporting Evidence\n${lines(picked)}\n\nOpen Questions\nEvidence outside the ${input.blocks.length} retrieved block(s) was not reviewed.`;
      } else {
        text = `Title\nRecommendation Summary: ${docs.slice(0, 2).join("; ")}\n\nRecommendations\n${lines(recs)}\n\nTarget Entity\n${recs.map((u) => (/Target:\s*([^.]+)/i.exec(u.sentence)?.[1] ?? "not stated")).join("; ") || "not stated"}\n\nSupporting Evidence\n${lines(picked)}\n\nUnresolved Ambiguities\nEvidence outside the ${input.blocks.length} retrieved block(s) was not reviewed.`;
      }
      return { text, usage: usage(m.rag, q, text) };
    },

    async judge(input: JudgeInput): Promise<JudgeResult> {
      const refused = canonical(input.candidateAnswer) === canonical(INSUFFICIENT_EVIDENCE);
      if (input.unanswerable) {
        const s = refused ? 1 : 0;
        return { correctness: s, evidenceSupport: 1, completeness: s, passed: refused, reason: refused ? "refused as expected" : "answered a question with no evidence", usage: usage(m.eval, input.candidateAnswer, "") };
      }
      if (refused) return { correctness: 0, evidenceSupport: 1, completeness: 0, passed: false, reason: "refused an answerable question", usage: usage(m.eval, input.candidateAnswer, "") };
      const ans = canonical(input.candidateAnswer);
      const ev = canonical(input.sourceEvidence);
      const facts = input.expectedAnswer
        .split("||")
        .map((f) => canonical(f))
        .filter(Boolean);
      const hits = facts.filter((f) => ans.includes(f)).length;
      const correctness = facts.length ? hits / facts.length : 0;
      // evidence support: every sentence of the answer (minus citations) must occur in the evidence
      const sentences = input.candidateAnswer
        .replace(/\[[^\]]+\]/g, "\n")
        .split(/\n|(?<=[.!?])\s+/)
        .map((s) => canonical(s))
        .filter((s) => s.length > 10);
      const supported = sentences.filter((s) => ev.includes(s)).length;
      const evidenceSupport = sentences.length ? supported / sentences.length : 1;
      const completeness = correctness;
      const passed = correctness >= 0.9 && evidenceSupport >= 0.95 && completeness >= 0.85;
      return { correctness, evidenceSupport, completeness, passed, reason: `${hits}/${facts.length} expected facts present; ${supported}/${sentences.length} sentences found in evidence`, usage: usage(m.eval, input.candidateAnswer, "") };
    },

    async embed(texts: string[]): Promise<EmbedResult> {
      return { vectors: texts.map((t) => hashedEmbedding(t, m.embedDimensions)), usage: { model: m.embed, inputTokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0), outputTokens: 0, latencyMs: 1 } };
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
    const idx = fnv1a(f) % dims;
    const sign = (fnv1a(`s:${f}`) & 1) === 0 ? 1 : -1;
    v[idx] = (v[idx] ?? 0) + sign;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}
