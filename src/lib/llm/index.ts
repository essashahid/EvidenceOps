import { env } from "@/lib/env";
import { hashObject } from "@/lib/hash";
import { ANSWER_PROMPT_VERSION, EXTRACTOR_PROMPT_VERSION, PIPELINE_VERSION, VERIFIER_PROMPT_VERSION } from "@/lib/config";
import { createMockProvider } from "./mock";
import { createOpenAiProvider } from "./openai";
import type { LlmModels, LlmProvider } from "./types";

let cached: LlmProvider | null = null;
let cachedKey = "";

export function llmModelsFromEnv(): LlmModels {
  const e = env();
  if (e.LLM_PROVIDER === "mock") {
    return { extractor: "mock", verifier: "mock", answer: "mock", judge: "mock", embedding: "mock", embeddingDimensions: e.EMBEDDING_DIMENSIONS };
  }
  return {
    extractor: e.OPENAI_EXTRACTOR_MODEL,
    verifier: e.OPENAI_VERIFIER_MODEL,
    answer: e.OPENAI_ANSWER_MODEL,
    judge: e.OPENAI_JUDGE_MODEL,
    embedding: e.OPENAI_EMBEDDING_MODEL,
    embeddingDimensions: e.EMBEDDING_DIMENSIONS,
  };
}

export function getLlm(): LlmProvider {
  const e = env();
  const key = `${e.LLM_PROVIDER}:${JSON.stringify(llmModelsFromEnv())}`;
  if (cached && cachedKey === key) return cached;
  cached = e.LLM_PROVIDER === "mock" ? createMockProvider(llmModelsFromEnv()) : createOpenAiProvider({ apiKey: e.OPENAI_API_KEY ?? "", models: llmModelsFromEnv() });
  cachedKey = key;
  return cached;
}

/** Everything that changes model behaviour, hashed. Used for step idempotency and eval baselines. */
export function modelConfigHash(provider: LlmProvider = getLlm()): string {
  return hashObject({
    provider: provider.name,
    models: provider.models,
    pipelineVersion: PIPELINE_VERSION,
    prompts: { extractor: EXTRACTOR_PROMPT_VERSION, verifier: VERIFIER_PROMPT_VERSION, answer: ANSWER_PROMPT_VERSION },
  }).slice(0, 16);
}

export type { LlmProvider } from "./types";
