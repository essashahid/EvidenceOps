import type { CorrectionSpec, DocSpec } from "../types";
import { DOCUMENTS_1 } from "./documents-1";
import { DOCUMENTS_2 } from "./documents-2";
import { DOCUMENTS_3 } from "./documents-3";

/** The 16 logically unique version-1 documents, in upload order. */
export const DOCUMENTS: DocSpec[] = [...DOCUMENTS_1, ...DOCUMENTS_2, ...DOCUMENTS_3];

/** Corrected version-2 editions: one PDF of a PDF document, one DOCX of a DOCX document. */
export const CORRECTIONS: CorrectionSpec[] = [
  {
    key: "OPS-2026-004",
    dateLine: "Publication date: 24 April 2026",
    dateIso: "2026-04-24",
    replacements: [{ from: "$1.25 million", to: "$1.15 million" }],
    supersessionNote:
      "This corrected edition supersedes Report No. OPS-2026-004 issued on 12 March 2026; the figure previously reported as $1.25 million is revised to $1.15 million following the reversal of a duplicated equipment invoice. No other finding or recommendation has changed.",
  },
  {
    key: "EVL-2026-002",
    dateLine: "Publication date: 16 March 2026",
    dateIso: "2026-03-16",
    replacements: [{ from: "USD 820,000", to: "USD 760,000" }],
    supersessionNote:
      "This corrected edition supersedes Report No. EVL-2026-002 issued on 5 January 2026; the figure previously reported as USD 820,000 is revised to USD 760,000 after the contract amendment signed in February 2026 was applied. No other finding or recommendation has changed.",
  },
];

/** Exact byte-for-byte duplicates with different filenames: one PDF, one DOCX. */
export const DUPLICATES: { of: string; filename: (original: string) => string }[] = [
  { of: "AUD-2026-011", filename: (original) => `copy-of-${original}` },
  { of: "GDN-2026-001", filename: (original) => original.replace(/\.docx$/, "-resend.docx") },
];

export function fileName(spec: DocSpec, version: number): string {
  const suffix = version === 1 ? "" : "-corrected";
  return `${spec.key}-v${version}-${spec.slug}${suffix}.${spec.format}`;
}

export function truthKey(key: string, version: number): string {
  return `${key}-v${version}`;
}
