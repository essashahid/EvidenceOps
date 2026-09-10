import { env, retryDelaysMs } from "@/lib/env";

/** Pipeline constants. Anything that changes model behaviour is folded into the model config hash. */
export const PIPELINE_VERSION = env().PIPELINE_VERSION;
export const SCHEMA_VERSION = "record-v2";
export const EXTRACT_PROMPT_VERSION = env().EXTRACT_PROMPT_VERSION;
export const VERIFY_PROMPT_VERSION = env().VERIFY_PROMPT_VERSION;
export const RAG_PROMPT_VERSION = env().RAG_PROMPT_VERSION;
export const DRAFT_PROMPT_VERSION = env().DRAFT_PROMPT_VERSION;
export const EVAL_PROMPT_VERSION = env().EVAL_PROMPT_VERSION;

export const UPLOAD_LIMITS = {
  maxBytes: env().MAX_UPLOAD_MB * 1024 * 1024,
  maxPages: env().MAX_DOCUMENT_PAGES,
  allowedMimeTypes: {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  } as const,
};

/** Scanned-document heuristic: more than 50% of pages with fewer than 100 characters. */
export const SCANNED_DETECTION = { minCharsPerPage: 100, maxLowTextPageRatio: 0.5 };

export const CHUNKING = { targetTokens: env().CHUNK_TARGET_TOKENS, overlapTokens: env().CHUNK_OVERLAP_TOKENS };

export const RETRIEVAL = {
  topK: env().RAG_TOP_K,
  vectorWeight: env().VECTOR_WEIGHT,
  lexicalWeight: env().LEXICAL_WEIGHT,
  candidateMultiplier: 4,
  /** Combined score under which nothing is sent to the model and the exact refusal string is returned. */
  minCombinedScore: 0.05,
};

/** The exact refusal string required by the RAG prompt (spec section 25). */
export const INSUFFICIENT_EVIDENCE = "Insufficient evidence in the indexed corpus.";

export const CONFIDENCE_WEIGHTS = {
  evidence_exact_match: 0.3,
  deterministic_validation: 0.2,
  verifier_support: 0.25,
  cross_pass_agreement: 0.15,
  evidence_specificity: 0.1,
} as const;

export const ROUTING_THRESHOLDS = { autoApprove: env().AUTO_APPROVE_THRESHOLD, review: env().REVIEW_THRESHOLD } as const;

export const VERIFIER_BATCH_SIZE = 12;

export const RETRY_SCHEDULE_MS: readonly number[] = retryDelaysMs().slice(0, env().LLM_MAX_RETRIES);
export const MAX_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

/** Demo-corpus cost warning threshold (spec section 39). */
export const COST_WARNING_USD = 0.25;

/**
 * Provider/model prices in USD per 1M tokens. Central configuration, not business logic.
 * Update here when OpenAI changes list prices.
 */
export const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  mock: { input: 0, output: 0 },
};

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) throw new Error(`Configure token pricing for model ${model} before using it.`);
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

/** Regression rules (spec section 33). */
export const REGRESSION_RULES = {
  extractionExactAccuracyDropPct: 2,
  provenanceValidityDropPct: 1,
  reviewRecallDropPct: 5,
  retrievalRecallDropPct: 3,
  minRefusalAccuracy: 0.95,
  minCitationPrecision: 0.95,
  minSemanticScore: 0.9,
} as const;

/** Success criteria (spec section 5). */
export const SUCCESS_TARGETS = {
  scalarExactAccuracy: 0.95,
  listMicroF1: 0.9,
  classificationAccuracy: 0.95,
  provenanceValidity: 0.98,
  reviewRecall: 0.9,
  reviewPrecision: 0.75,
  retrievalRecallAt5: 0.9,
  citationPrecision: 0.95,
  evidenceSupportedRate: 0.95,
  refusalAccuracy: 0.95,
  semanticScore: 0.9,
} as const;

/** Judge pass thresholds per case (spec section 32). */
export const JUDGE_PASS = { correctness: 0.9, evidenceSupport: 0.95, completeness: 0.85 } as const;
