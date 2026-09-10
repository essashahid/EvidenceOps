import type { ExtractionOutput } from "@/lib/schema/report";
import type { AnswerMode } from "@/lib/db/schema";

export type LlmUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
};

export type SourceBlockInput = { locator: string; text: string };

export type ExtractInput = {
  documentName: string;
  blocks: SourceBlockInput[];
};

export type ExtractResult = { output: ExtractionOutput; usage: LlmUsage; raw?: unknown };

export type VerifyItem = {
  fieldPath: string;
  fieldDefinition: string;
  candidateValue: unknown;
  evidence: { locator: string; quote: string };
  /** Normalized text of the cited source block (empty string when the locator does not exist). */
  blockText: string;
  quoteFound: boolean;
};

export const VERIFIER_STATUSES = ["supported", "partially_supported", "unsupported"] as const;
export type VerifierStatus = (typeof VERIFIER_STATUSES)[number];
export const AGREEMENTS = ["same", "equivalent_formatting", "different"] as const;
export type Agreement = (typeof AGREEMENTS)[number];
export const SPECIFICITIES = ["direct", "contextual", "weak", "none"] as const;
export type Specificity = (typeof SPECIFICITIES)[number];

export type VerifyOutcome = {
  fieldPath: string;
  status: VerifierStatus;
  /** The value the verifier believes is correct, or null when it cannot determine one. */
  correctedValue: unknown;
  agreement: Agreement;
  contradiction: boolean;
  specificity: Specificity;
  reason: string;
};

export type VerifyResult = { outcomes: VerifyOutcome[]; usage: LlmUsage };

export type RetrievedChunkInput = {
  index: number;
  chunkId: string;
  documentName: string;
  logicalKey: string;
  versionNumber: number;
  startLocator: string;
  endLocator: string;
  text: string;
};

export type AnswerInput = {
  question: string;
  mode: AnswerMode;
  chunks: RetrievedChunkInput[];
};

export type AnswerClaim = {
  text: string;
  kind: "direct" | "synthesis";
  citations: { chunkIndex: number; quote: string }[];
};

export type DraftSections = {
  title: string;
  key_evidence: AnswerClaim[];
  findings: AnswerClaim[];
  recommendations: AnswerClaim[];
  limitations: string[];
};

export type AnswerResult = {
  sufficient: boolean;
  refusalReason: string | null;
  answerText: string;
  claims: AnswerClaim[];
  draft: DraftSections | null;
  usage: LlmUsage;
};

export type JudgeInput = {
  question: string;
  referenceAnswer: string;
  expectedFacts: string[];
  answer: string;
};

export type JudgeResult = { score: number; reason: string; usage: LlmUsage };

export type EmbedResult = { vectors: number[][]; usage: LlmUsage };

export type LlmModels = {
  extractor: string;
  verifier: string;
  answer: string;
  judge: string;
  embedding: string;
  embeddingDimensions: number;
};

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
