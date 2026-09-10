import { env } from "@/lib/env";
import { hashObject } from "@/lib/hash";
import { DRAFT_PROMPT_VERSION, EVAL_PROMPT_VERSION, EXTRACT_PROMPT_VERSION, PIPELINE_VERSION, RAG_PROMPT_VERSION, SCHEMA_VERSION, VERIFY_PROMPT_VERSION } from "@/lib/config";
import { createMockProvider } from "./mock";
import { createOpenAiProvider } from "./openai";
import type { LlmModels, LlmProvider } from "./types";

let cached: LlmProvider | null = null;
let cachedKey = "";

export function llmModelsFromEnv(): LlmModels {
  const e = env();
  if (e.LLM_PROVIDER === "mock") return { extract: "mock", verify: "mock", rag: "mock", eval: "mock", embed: "mock", embedDimensions: e.OPENAI_EMBED_DIMENSIONS };
  return { extract: e.OPENAI_EXTRACT_MODEL, verify: e.OPENAI_VERIFY_MODEL, rag: e.OPENAI_RAG_MODEL, eval: e.OPENAI_EVAL_MODEL, embed: e.OPENAI_EMBED_MODEL, embedDimensions: e.OPENAI_EMBED_DIMENSIONS };
}

export function getLlm(): LlmProvider {
  const e = env();
  const key = `${e.LLM_PROVIDER}:${JSON.stringify(llmModelsFromEnv())}`;
  if (cached && cachedKey === key) return cached;
  cached = e.LLM_PROVIDER === "mock" ? createMockProvider(llmModelsFromEnv()) : createOpenAiProvider({ apiKey: e.OPENAI_API_KEY ?? "", models: llmModelsFromEnv() });
  cachedKey = key;
  return cached;
}

/** Model, prompt versions, generation parameters and schema version, hashed (spec section 36). */
export function modelConfigHash(provider: LlmProvider = getLlm()): string {
  return hashObject({
    provider: provider.name,
    models: provider.models,
    pipelineVersion: PIPELINE_VERSION,
    schemaVersion: SCHEMA_VERSION,
    prompts: { extract: EXTRACT_PROMPT_VERSION, verify: VERIFY_PROMPT_VERSION, rag: RAG_PROMPT_VERSION, draft: DRAFT_PROMPT_VERSION, eval: EVAL_PROMPT_VERSION },
    validationRevision: "audit-v2",
    generation: { temperature: "default", structuredOutput: true },
  }).slice(0, 16);
}

export function modelConfigSummary(provider: LlmProvider = getLlm()) {
  return { provider: provider.name, models: provider.models, pipelineVersion: PIPELINE_VERSION, schemaVersion: SCHEMA_VERSION, prompts: { extract: EXTRACT_PROMPT_VERSION, verify: VERIFY_PROMPT_VERSION, rag: RAG_PROMPT_VERSION, draft: DRAFT_PROMPT_VERSION, eval: EVAL_PROMPT_VERSION } };
}

export type { LlmProvider } from "./types";
