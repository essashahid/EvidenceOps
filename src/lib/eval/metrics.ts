import { canonical, tokenize } from "@/lib/text";
import { LIST_FIELDS, LIST_ITEM_KEYS, LIST_MATCH_KEY, SCALAR_FIELDS, type ReportRecord } from "@/lib/schema/report";

export type ScalarComparison = { field: string; expected: unknown; actual: unknown; correct: boolean };
export type ListComparison = { field: string; tp: number; fp: number; fn: number; details: { expected: unknown; actual: unknown; matched: boolean; correct: boolean }[] };

export function valuesEqual(fieldPath: string, expected: unknown, actual: unknown): boolean {
  if (expected === null || expected === undefined) return actual === null || actual === undefined || actual === "";
  const leaf = fieldPath.replace(/^.*\./, "");
  if (leaf === "amount") return Math.abs(Number(expected) - Number(actual)) < 0.5;
  if (leaf === "publication_date" || ["document_type", "entity_type", "severity", "priority", "currency"].includes(leaf)) return String(expected) === String(actual);
  const a = canonical(expected);
  const b = canonical(actual);
  if (a === b) return true;
  // free text: tolerate small wording drift (token F1 >= 0.85)
  const at = tokenize(String(expected));
  const bt = tokenize(String(actual));
  if (at.length === 0 || bt.length === 0) return false;
  const bset = new Set(bt);
  const overlap = at.filter((t) => bset.has(t)).length;
  const p = overlap / bt.length;
  const r = overlap / at.length;
  const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return f1 >= 0.85;
}

export function compareScalars(expected: ReportRecord, actual: ReportRecord): ScalarComparison[] {
  return SCALAR_FIELDS.map((f) => ({ field: f, expected: expected[f], actual: actual[f], correct: valuesEqual(f, expected[f], actual[f]) }));
}

/** Greedy item matching on the list's match key; an item counts as a true positive only if every key matches. */
export function compareLists(expected: ReportRecord, actual: ReportRecord): ListComparison[] {
  return LIST_FIELDS.map((field) => {
    const exp = [...(expected[field] as Record<string, unknown>[])];
    const act = [...(actual[field] as Record<string, unknown>[])];
    const matchKey = LIST_MATCH_KEY[field];
    const used = new Set<number>();
    const details: ListComparison["details"] = [];
    let tp = 0;
    let fp = 0;
    for (const a of act) {
      let best = -1;
      for (let i = 0; i < exp.length; i++) {
        if (used.has(i)) continue;
        if (valuesEqual(`${field}[0].${matchKey}`, exp[i]![matchKey], a[matchKey])) {
          best = i;
          break;
        }
      }
      if (best === -1) {
        fp++;
        details.push({ expected: null, actual: a, matched: false, correct: false });
        continue;
      }
      used.add(best);
      const e = exp[best]!;
      const correct = LIST_ITEM_KEYS[field].every((k) => valuesEqual(`${field}[0].${k}`, e[k], a[k]));
      if (correct) tp++;
      else fp++;
      details.push({ expected: e, actual: a, matched: true, correct });
    }
    const fn = exp.length - used.size + details.filter((d) => d.matched && !d.correct).length;
    return { field, tp, fp, fn, details };
  });
}

export function microF1(comparisons: ListComparison[]): { precision: number; recall: number; f1: number; tp: number; fp: number; fn: number } {
  const tp = comparisons.reduce((n, c) => n + c.tp, 0);
  const fp = comparisons.reduce((n, c) => n + c.fp, 0);
  const fn = comparisons.reduce((n, c) => n + c.fn, 0);
  const precision = tp + fp === 0 ? 1 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

export function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}
