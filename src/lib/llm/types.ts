import type { ExtractionOutput } from "@/lib/schema/report";
import type { AnswerMode } from "@/lib/db/schema";

export type LlmUsage = { model: string; inputTokens: number; outputTokens: number; latencyMs: number };

export type SourceBlockInput = { source_block_id: string; locator: string; text: string };

export type ExtractInput = { logicalKey: string; versionNumber: number; blocks: SourceBlockInput[] };
export type ExtractResult = { output: ExtractionOutput; usage: LlmUsage; raw?: unknown };

export type VerifyItem = {
  fieldPath: string;
  fieldDefinition: string;
  candidateValue: unknown;
  /** Cited quotes with whether each was found verbatim in one of the cited blocks. */
  evidence: { source_block_id: string; quote: string; found_in_block: boolean }[];
  /** The cited blocks (full normalized text) plus neighbours for context. */
  context: { source_block_id: string; locator: string; text: string }[];
};

export const VERIFIER_STATUSES = ["supported", "partially_supported", "unsupported"] as const;
export type VerifierStatus = (typeof VERIFIER_STATUSES)[number];

export type VerifyOutcome = {
  fieldPath: string;
  status: VerifierStatus;
  correctedValue: unknown;
  contradictionDetected: boolean;
  /** 1.0 direct, 0.75 contextual, 0.4 weak, 0.0 none. */
  evidenceSpecificity: number;
  reason: string;
};
export type VerifyResult = { outcomes: VerifyOutcome[]; usage: LlmUsage };

export type RetrievedBlockInput = {
  retrievalId: number;
  chunkId: string;
  logicalKey: string;
  version: number;
  locator: string;
  document: string;
  isCurrent: boolean;
  text: string;
};

export type AnswerInput = { question: string; mode: AnswerMode; blocks: RetrievedBlockInput[] };

/**
 * The model returns prose with inline citations in the form [KEY vN locator]. Citations are
 * parsed and validated in code against the supplied retrieval set; the model never decides
 * what counts as a valid citation.
 */
export type AnswerResult = { text: string; usage: LlmUsage };

export type JudgeInput = { question: string; expectedAnswer: string; candidateAnswer: string; sourceEvidence: string; unanswerable: boolean };
export type JudgeResult = { correctness: number; evidenceSupport: number; completeness: number; passed: boolean; reason: string; usage: LlmUsage };

export type EmbedResult = { vectors: number[][]; usage: LlmUsage };

export type LlmModels = { extract: string; verify: string; rag: string; eval: string; embed: string; embedDimensions: number };

export interface LlmProvider {
  readonly name: "openai" | "mock";
  readonly models: LlmModels;
  extract(input: ExtractInput): Promise<ExtractResult>;
  verify(items: VerifyItem[]): Promise<VerifyResult>;
  answer(input: AnswerInput): Promise<AnswerResult>;
  judge(input: JudgeInput): Promise<JudgeResult>;
  embed(texts: string[]): Promise<EmbedResult>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_structured_output" | "api_error" | "timeout" | "rate_limited" | "config",
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmError";
  }
}
