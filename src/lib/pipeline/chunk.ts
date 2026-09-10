import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("cl100k_base");
import { CHUNKING } from "@/lib/config";
import { sha256 } from "@/lib/hash";

export type ChunkSourceBlock = { id: string; locator: string; normalizedText: string };

export type Chunk = {
  chunkIndex: number;
  text: string;
  startBlockId: string;
  endBlockId: string;
  startLocator: string;
  endLocator: string;
  tokenCount: number;
  textHash: string;
};

type Unit = { text: string; tokens: number; block: ChunkSourceBlock };

export function countTokens(text: string): number {
  return encoding.encode(text).length;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Hard-split an oversized sentence on token boundaries. */
function hardSplit(text: string, maxTokens: number): string[] {
  const words = text.split(" ");
  const out: string[] = [];
  let cur: string[] = [];
  let curTokens = 0;
  for (const w of words) {
    const t = countTokens(w + " ");
    if (curTokens + t > maxTokens && cur.length) {
      out.push(cur.join(" "));
      cur = [];
      curTokens = 0;
    }
    cur.push(w);
    curTokens += t;
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

/**
 * Build ~800-token chunks with ~120-token overlap from ordered source blocks of ONE document
 * version. Text is never rewritten; chunks are sentence aligned and keep block provenance.
 */
export function chunkBlocks(blocks: ChunkSourceBlock[], opts = CHUNKING): Chunk[] {
  const units: Unit[] = [];
  for (const block of blocks) {
    for (const sentence of splitSentences(block.normalizedText)) {
      const tokens = countTokens(sentence);
      if (tokens > opts.targetTokens) {
        for (const piece of hardSplit(sentence, opts.targetTokens)) units.push({ text: piece, tokens: countTokens(piece), block });
      } else {
        units.push({ text: sentence, tokens, block });
      }
    }
  }
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < units.length) {
    let tokens = 0;
    let j = i;
    while (j < units.length && tokens + units[j]!.tokens <= opts.targetTokens) {
      tokens += units[j]!.tokens;
      j++;
    }
    if (j === i) j = i + 1; // always make progress
    const slice = units.slice(i, j);
    const text = slice.map((u) => u.text).join(" ");
    chunks.push({
      chunkIndex: chunks.length,
      text,
      startBlockId: slice[0]!.block.id,
      endBlockId: slice[slice.length - 1]!.block.id,
      startLocator: slice[0]!.block.locator,
      endLocator: slice[slice.length - 1]!.block.locator,
      tokenCount: countTokens(text),
      textHash: sha256(text),
    });
    if (j >= units.length) break;
    // overlap: back up over trailing units worth up to overlapTokens
    let back = j;
    let overlap = 0;
    while (back > i + 1 && overlap + units[back - 1]!.tokens <= opts.overlapTokens) {
      back--;
      overlap += units[back]!.tokens;
    }
    i = Math.max(back, i + 1);
  }
  return chunks;
}
