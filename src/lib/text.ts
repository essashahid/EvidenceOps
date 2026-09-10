/**
 * Text normalization shared by parsing, evidence matching and evaluation. Normalization
 * never rewrites content; it only makes whitespace and typographic punctuation comparable.
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n+ */g, " ")
    .trim();
}

/** Lowercase, punctuation-insensitive form used for value comparison. */
export function canonical(input: unknown): string {
  if (input === null || input === undefined) return "";
  return normalizeText(String(input))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Locate a normalized quote inside normalized block text. Returns [start, end] or null. */
export function findQuote(blockNormalized: string, quote: string): { start: number; end: number } | null {
  const q = normalizeText(quote);
  if (!q) return null;
  const idx = blockNormalized.indexOf(q);
  if (idx >= 0) return { start: idx, end: idx + q.length };
  const lower = blockNormalized.toLowerCase().indexOf(q.toLowerCase());
  if (lower >= 0) return { start: lower, end: lower + q.length };
  return null;
}

export function tokenize(input: string): string[] {
  return canonical(input)
    .split(/[\s.]+/)
    .filter((t) => t.length > 1);
}

const STOPWORDS = new Set(
  "the a an and or of to in on for by with at from as is are was were be been this that these those it its into than then which who whom what when where why how does do did has have had not no yes about over under per each all any".split(
    " ",
  ),
);

export function contentTokens(input: string): string[] {
  return tokenize(input).filter((t) => !STOPWORDS.has(t));
}

export function excerpt(text: string, start: number, end: number, context = 250): { before: string; match: string; after: string } {
  const s = Math.max(0, start - context);
  const e = Math.min(text.length, end + context);
  return { before: text.slice(s, start), match: text.slice(start, end), after: text.slice(end, e) };
}
