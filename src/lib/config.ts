/**
 * Pipeline constants. Anything that changes model behaviour is folded into the
 * model config hash so that reprocessing with a different configuration creates
 * a new extraction run instead of reusing cached step outputs.
 */
export const PIPELINE_VERSION = "1.0.0";
export const EXTRACTOR_PROMPT_VERSION = "extract-v1";
export const VERIFIER_PROMPT_VERSION = "verify-v1";
export const ANSWER_PROMPT_VERSION = "answer-v1";
export const DRAFT_PROMPT_VERSION = "draft-v1";
export const JUDGE_PROMPT_VERSION = "judge-v1";

export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  maxPages: 50,
  allowedMimeTypes: {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  } as const,
};

/** Scanned-document heuristic: <100 chars/page on >50% of pages. */
export const SCANNED_DETECTION = { minCharsPerPage: 100, maxLowTextPageRatio: 0.5 };

export const CHUNKING = { targetTokens: 800, overlapTokens: 120 };

export const RETRIEVAL = {
  topK: 8,
  vectorWeight: 0.75,
  lexicalWeight: 0.25,
  candidateMultiplier: 4,
  /** Combined score under which the answerer refuses for lack of evidence. */
  minCombinedScore: 0.05,
};

export const CONFIDENCE_WEIGHTS = {
  evidence_exact_match: 0.3,
  deterministic_validation: 0.2,
  verifier_support: 0.25,
  cross_pass_agreement: 0.15,
  evidence_specificity: 0.1,
} as const;

export const ROUTING_THRESHOLDS = { autoApprove: 0.86, review: 0.65 } as const;

export const VERIFIER_BATCH_SIZE = 12;

export const RETRY_SCHEDULE_MS = [2_000, 8_000, 30_000] as const;
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

/** USD per 1M tokens. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "gpt-5.6-luna-pro": { input: 2.0, output: 12.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  mock: { input: 0, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export const REGRESSION_RULES = {
  extractionExactAccuracyDropPct: 2,
  evidencePrecisionDropPct: 1,
  reviewRecallDropPct: 5,
  retrievalRecallDropPct: 3,
  minRefusalAccuracy: 0.95,
  minSemanticScore: 0.9,
} as const;

export const SUCCESS_TARGETS = {
  scalarExactAccuracy: 0.95,
  listMicroF1: 0.9,
  evidenceValidity: 0.98,
  classificationAccuracy: 0.95,
  reviewRecall: 0.9,
  reviewPrecision: 0.75,
  retrievalRecallAt5: 0.9,
  citationPrecision: 0.95,
  evidenceSupportedRate: 0.95,
  refusalAccuracy: 0.95,
  semanticScore: 0.9,
} as const;
