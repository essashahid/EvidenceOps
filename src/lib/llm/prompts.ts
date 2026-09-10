import { DOCUMENT_TYPES, ENTITY_TYPES, SEVERITIES, PRIORITIES, CURRENCIES } from "@/lib/schema/report";

export const FIELD_DEFINITIONS: Record<string, string> = {
  report_title: "The full title of the report as printed in the title block.",
  report_number: "The report identifier or number printed in the title block (e.g. 'OPS-2026-004' or 'OPS-2026-004-R1').",
  issuing_organization: "The organization that issued or authored the report.",
  publication_date: "The publication date of this edition of the report, as an ISO date YYYY-MM-DD.",
  document_type: `One of ${DOCUMENT_TYPES.join(", ")} describing what kind of report this is.`,
  "subject_entities[].name": "A named organization, facility, program, vendor, system or person the report is about.",
  "subject_entities[].entity_type": `One of ${ENTITY_TYPES.join(", ")}.`,
  "key_findings[].text": "One finding stated in the report, as a single sentence close to the source wording.",
  "key_findings[].severity": `The stated severity of that finding, one of ${SEVERITIES.join(", ")}.`,
  "recommendations[].text": "One recommendation stated in the report, as a single sentence close to the source wording.",
  "recommendations[].priority": `The stated priority of that recommendation, one of ${PRIORITIES.join(", ")}.`,
  "monetary_amounts[].amount": "A monetary amount stated in the report, as a plain number in major currency units (e.g. $1.25 million -> 1250000).",
  "monetary_amounts[].currency": `ISO currency code, one of ${CURRENCIES.join(", ")}.`,
  "monetary_amounts[].label": "A short label describing what the amount is (e.g. 'revised program cost').",
};

export function fieldDefinition(fieldPath: string): string {
  const generic = fieldPath.replace(/\[\d+\]/g, "[]");
  return FIELD_DEFINITIONS[generic] ?? FIELD_DEFINITIONS[fieldPath] ?? "";
}

export const EXTRACTOR_SYSTEM_PROMPT = `You are a meticulous document-extraction system. You read an operational report that has been split into source blocks, each labelled with a locator such as SRC-OPS-2026-004-V1-P02. You return a structured record.

Rules:
1. Every value must come from the document. Never invent, infer beyond the text, or use outside knowledge.
2. Every value must carry evidence: the locator of the block it came from and a VERBATIM quote (a contiguous excerpt copied exactly from that block, one sentence or less, at most 300 characters) that supports the value. Do not paraphrase inside quotes. Do not merge text from two blocks.
3. If the document states a value in two places with different numbers or dates, prefer the one the document says is corrected or final, and quote that statement.
4. Use ISO dates (YYYY-MM-DD). Convert amounts to plain numbers in major units ("$1.25 million" -> 1250000). Currency codes are ISO 4217.
5. Findings and recommendations: one item per stated finding/recommendation, sentence text close to the source wording, severity/priority exactly as stated in the text.
6. If a scalar field is not present in the document, use an empty string for the value and quote the closest relevant sentence with the correct locator.

Field definitions:
${Object.entries(FIELD_DEFINITIONS)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n")}`;

export function extractorUserPrompt(documentName: string, blocks: { locator: string; text: string }[]): string {
  const body = blocks.map((b) => `<<< ${b.locator} >>>\n${b.text}`).join("\n\n");
  return `Document: ${documentName}\n\nSource blocks:\n\n${body}`;
}

export const VERIFIER_SYSTEM_PROMPT = `You are an independent verification system. For each candidate field you receive: the field definition, the candidate value another system extracted, the quote it cited, and the full text of the source block it cited. You do NOT know how confident the other system was and you must not assume it is right.

For each item decide:
- status: "supported" if the cited block clearly and specifically states the candidate value; "partially_supported" if the block relates to the value but does not state it exactly, states it with different wording, or if other text in the block conflicts with it; "unsupported" if the block does not support the value or the quote does not appear in the block.
- corrected_value: the value you believe is correct based on the block text (same type as the candidate: string, number, or one of the enum values), or null if you cannot determine one. If the candidate is correct, repeat it.
- agreement: "same" if your corrected value equals the candidate exactly; "equivalent_formatting" if it is the same thing written differently (e.g. "1.15m" vs 1150000, "12 March 2026" vs 2026-03-12); "different" if it is materially different or you could not confirm it.
- contradiction: true if the block (or the quote) contains a statement that conflicts with the candidate value (e.g. a figure explicitly superseded or corrected elsewhere in the block).
- specificity: "direct" when the evidence states the value explicitly; "contextual" when it is clear from context but not stated verbatim; "weak" when the evidence is broad or vague; "none" when there is no supporting evidence.
- reason: one sentence.

Be strict about numbers, dates and enumerations. Be tolerant of harmless formatting differences in free text (capitalization, trailing punctuation).`;

export function verifierUserPrompt(items: { index: number; fieldPath: string; fieldDefinition: string; candidateValue: unknown; quote: string; locator: string; blockText: string; quoteFound: boolean }[]): string {
  return items
    .map(
      (it) =>
        `### Item ${it.index}\nField: ${it.fieldPath}\nDefinition: ${it.fieldDefinition}\nCandidate value: ${JSON.stringify(it.candidateValue)}\nCited locator: ${it.locator}\nCited quote: ${JSON.stringify(it.quote)}\nQuote found verbatim in block: ${it.quoteFound ? "yes" : "NO"}\nSource block text:\n${it.blockText || "(locator does not exist in this document)"}`,
    )
    .join("\n\n");
}

export const ANSWER_SYSTEM_PROMPT = `You answer questions about a document corpus using ONLY the retrieved evidence chunks provided. Each chunk is labelled with an index, the document name and version, and source locators.

Rules:
1. Every claim in your answer must be supported by at least one cited chunk, with a verbatim quote (under 300 characters) from that chunk.
2. If the chunks do not contain enough evidence to answer the question, set sufficient=false, give a short refusal_reason, and do not guess.
3. Mark each claim as "direct" when a chunk states it explicitly, or "synthesis" when you combine two or more chunks.
4. Prefer the current version of a document when a superseded version is also present; say so if figures differ between versions.
5. Keep the answer concise and factual. Do not add outside knowledge.`;

export const DRAFT_SYSTEM_PROMPT = `You write evidence-bound first drafts from retrieved chunks. Modes:
- executive_brief: a short brief for leadership.
- findings: a findings summary.
- recommendations: a recommendation summary.

Rules are identical to question answering: every statement in title, key_evidence, findings and recommendations must be a claim with citations and verbatim quotes from the chunks. The limitations list must state what the evidence does not cover. If the evidence is insufficient for the requested draft, set sufficient=false.`;

export function answerUserPrompt(question: string, mode: string, chunks: { index: number; documentName: string; versionNumber: number; startLocator: string; endLocator: string; text: string }[]): string {
  const body = chunks
    .map((c) => `[${c.index}] ${c.documentName} (v${c.versionNumber}; ${c.startLocator} to ${c.endLocator})\n${c.text}`)
    .join("\n\n");
  return `Mode: ${mode}\nQuestion or request: ${question}\n\nRetrieved chunks:\n\n${body}`;
}

export const JUDGE_SYSTEM_PROMPT = `You grade an answer against a reference answer and a list of expected facts. Return a score from 0 to 1: 1 means the answer conveys the same information as the reference and includes every expected fact (allowing different wording or number formatting); 0 means it is wrong, missing, or refuses when it should answer. Deduct proportionally for missing facts and for claims that contradict the reference. Give a one-sentence reason.`;

export function judgeUserPrompt(input: { question: string; referenceAnswer: string; expectedFacts: string[]; answer: string }): string {
  return `Question: ${input.question}\nReference answer: ${input.referenceAnswer}\nExpected facts: ${JSON.stringify(input.expectedFacts)}\nCandidate answer: ${input.answer}`;
}
