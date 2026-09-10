import { normalizeText } from "@/lib/text";
import { SCANNED_DETECTION } from "@/lib/config";

export type ParsedBlock = {
  blockType: "page" | "paragraph";
  blockIndex: number;
  pageNumber: number | null;
  paragraphNumber: number | null;
  rawText: string;
  normalizedText: string;
  charStart: number;
  charEnd: number;
};

export type ParseResult =
  | { status: "parsed"; blocks: ParsedBlock[]; pageCount: number | null; charCount: number }
  | { status: "unsupported"; reason: "unsupported_scanned_document" | "empty_document"; pageCount: number | null; blocks: ParsedBlock[] }
  | { status: "failed"; errorCode: "parse_failed"; message: string };

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

type TextItem = { str: string; hasEOL?: boolean; transform?: number[] };

async function loadPdfjs() {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

/** Extract page text from a PDF. Groups text items into lines using their y position. */
export async function parsePdf(bytes: Buffer): Promise<ParseResult> {
  let doc;
  try {
    const pdfjs = await loadPdfjs();
    doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  } catch (err) {
    return { status: "failed", errorCode: "parse_failed", message: err instanceof Error ? err.message : String(err) };
  }
  const blocks: ParsedBlock[] = [];
  let cursor = 0;
  let lowTextPages = 0;
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines: string[] = [];
      let current = "";
      let lastY: number | null = null;
      for (const item of content.items as TextItem[]) {
        if (typeof item.str !== "string") continue;
        const y: number | null = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && current.trim()) {
          lines.push(current.trimEnd());
          current = "";
        }
        current += item.str;
        if (item.hasEOL) {
          lines.push(current.trimEnd());
          current = "";
        } else if (item.str && !item.str.endsWith(" ")) {
          current += " ";
        }
        if (y !== null) lastY = y;
      }
      if (current.trim()) lines.push(current.trimEnd());
      const rawText = lines.join("\n").trim();
      const normalizedText = normalizeText(rawText);
      if (normalizedText.length < SCANNED_DETECTION.minCharsPerPage) lowTextPages++;
      blocks.push({
        blockType: "page",
        blockIndex: p - 1,
        pageNumber: p,
        paragraphNumber: null,
        rawText,
        normalizedText,
        charStart: cursor,
        charEnd: cursor + normalizedText.length,
      });
      cursor += normalizedText.length + 1;
    }
  } catch (err) {
    return { status: "failed", errorCode: "parse_failed", message: err instanceof Error ? err.message : String(err) };
  } finally {
    await doc.cleanup?.().catch?.(() => {});
    await doc.loadingTask?.destroy?.().catch?.(() => {});
  }
  const pageCount = blocks.length;
  if (pageCount === 0) return { status: "unsupported", reason: "empty_document", pageCount: 0, blocks };
  if (lowTextPages / pageCount > SCANNED_DETECTION.maxLowTextPageRatio) {
    return { status: "unsupported", reason: "unsupported_scanned_document", pageCount, blocks };
  }
  return { status: "parsed", blocks, pageCount, charCount: cursor };
}

/** Extract paragraphs from a DOCX using mammoth's raw text output (one paragraph per line group). */
export async function parseDocx(bytes: Buffer): Promise<ParseResult> {
  let raw: string;
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    raw = result.value;
  } catch (err) {
    return { status: "failed", errorCode: "parse_failed", message: err instanceof Error ? err.message : String(err) };
  }
  const paragraphs = raw
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const blocks: ParsedBlock[] = [];
  let cursor = 0;
  paragraphs.forEach((rawText, i) => {
    const normalizedText = normalizeText(rawText);
    blocks.push({
      blockType: "paragraph",
      blockIndex: i,
      pageNumber: null,
      paragraphNumber: i + 1,
      rawText,
      normalizedText,
      charStart: cursor,
      charEnd: cursor + normalizedText.length,
    });
    cursor += normalizedText.length + 1;
  });
  if (blocks.length === 0) return { status: "unsupported", reason: "empty_document", pageCount: null, blocks };
  return { status: "parsed", blocks, pageCount: null, charCount: cursor };
}

export async function parseDocument(bytes: Buffer, mimeType: string): Promise<ParseResult> {
  if (mimeType === "application/pdf") return parsePdf(bytes);
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return parseDocx(bytes);
  return { status: "failed", errorCode: "parse_failed", message: `unsupported mime type ${mimeType}` };
}

/** Locator for a source block, e.g. SRC-OPS-2026-004-V2-P03 or SRC-OPS-2026-009-V1-PARA17. */
export function blockLocator(logicalKey: string, versionNumber: number, block: Pick<ParsedBlock, "blockType" | "pageNumber" | "paragraphNumber">): string {
  const key = logicalKey.toUpperCase().replace(/[^A-Z0-9]+/g, "-");
  if (block.blockType === "page") return `SRC-${key}-V${versionNumber}-P${String(block.pageNumber).padStart(2, "0")}`;
  return `SRC-${key}-V${versionNumber}-PARA${block.paragraphNumber}`;
}
