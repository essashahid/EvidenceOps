import OpenAI, { APIConnectionTimeoutError, APIError, RateLimitError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { extractionOutputSchema, fieldKind } from "@/lib/schema/report";
import {
  DRAFT_SYSTEM_PROMPT,
  EXTRACTOR_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  RAG_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
  draftUserPrompt,
  extractorUserPrompt,
  judgeUserPrompt,
  ragUserPrompt,
  verifierBatchUserPrompt,
} from "./prompts";
import {
  LlmError,
  VERIFIER_STATUSES,
  type AnswerInput,
  type AnswerResult,
  type EmbedResult,
  type ExtractInput,
  type ExtractResult,
  type JudgeInput,
  type JudgeResult,
  type LlmModels,
  type LlmProvider,
  type LlmUsage,
  type VerifyItem,
  type VerifyOutcome,
  type VerifyResult,
} from "./types";

const verifySchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(VERIFIER_STATUSES),
      /** JSON-encoded corrected value or null (strict schemas cannot express "any"). */
      corrected_value: z.string().nullable(),
      contradiction_detected: z.boolean(),
      evidence_specificity: z.number(),
      reason: z.string(),
    }),
  ),
});

const judgeSchema = z.object({
  correctness: z.number(),
  evidence_support: z.number(),
  completeness: z.number(),
  passed: z.boolean(),
  reason: z.string(),
});

const answerSchema = z.object({ answer: z.string() });

export function mapError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof SyntaxError || err instanceof z.ZodError) return new LlmError("The provider returned invalid structured output", "invalid_structured_output", true);
  if (err instanceof APIConnectionTimeoutError) return new LlmError(err.message, "timeout", true);
  if (err instanceof RateLimitError) return new LlmError(err.message, "rate_limited", true);
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    return new LlmError(`${status} ${err.message}`, "api_error", status >= 500 || status === 408 || status === 409);
  }
  if (err instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(err.message)) return new LlmError(err.message, "api_error", true);
  return new LlmError(err instanceof Error ? err.message : String(err), "api_error", false);
}

function coerceCorrected(fieldPath: string, raw: string | null): unknown {
  if (raw === null || raw.trim() === "" || raw.trim() === "null") return null;
  const kind = fieldKind(fieldPath);
  if (kind === "item") {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string" || typeof parsed === "number" || parsed === null) return parsed;
  } catch {
    /* plain string */
  }
  return raw;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

export type OpenAiProviderOptions = { apiKey: string; models: LlmModels; timeoutMs?: number; baseURL?: string };

export function createOpenAiProvider(opts: OpenAiProviderOptions): LlmProvider {
  if (!opts.apiKey) throw new LlmError("OPENAI_API_KEY is not set", "config", false);
  const client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 60_000, maxRetries: 0, baseURL: opts.baseURL });

  /** Structured call with one immediate retry on invalid structured output (spec: failure modes). */
  async function parseWithRetry<T>(model: string, system: string, user: string, schema: z.ZodType<T>, name: string): Promise<{ parsed: T; usage: LlmUsage }> {
    let lastErr: LlmError | null = null;
    let inputTokens = 0, outputTokens = 0;
    const overallStarted = Date.now();
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await client.responses.create({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          text: { format: zodTextFormat(schema, name) },
        });
        inputTokens += response.usage?.input_tokens ?? 0;
        outputTokens += response.usage?.output_tokens ?? 0;
        const usage: LlmUsage = { model, inputTokens, outputTokens, latencyMs: Date.now() - overallStarted };
        const check = schema.safeParse(JSON.parse(response.output_text || "null"));
        if (!check.success) {
          lastErr = new LlmError(`structured output failed validation (${name}): ${check.error.message}`, "invalid_structured_output", false);
          continue;
        }
        return { parsed: check.data, usage };
      } catch (err) {
        const mapped = mapError(err);
        if (mapped.code === "invalid_structured_output" && attempt === 0) {
          lastErr = mapped;
          continue;
        }
        throw mapped;
      }
    }
    throw lastErr ?? new LlmError("structured output failed", "invalid_structured_output", false);
  }

  return {
    name: "openai",
    models: opts.models,

    async extract(input: ExtractInput): Promise<ExtractResult> {
      const { parsed, usage } = await parseWithRetry(opts.models.extract, EXTRACTOR_SYSTEM_PROMPT, extractorUserPrompt(input.logicalKey, input.versionNumber, input.blocks), extractionOutputSchema, "extraction");
      return { output: parsed, usage, raw: parsed };
    },

    async verify(items: VerifyItem[]): Promise<VerifyResult> {
      if (items.length === 0) return { outcomes: [], usage: { model: opts.models.verify, inputTokens: 0, outputTokens: 0, latencyMs: 0 } };
      const prompt = verifierBatchUserPrompt(items.map((it) => ({ fieldPath: it.fieldPath, fieldDefinition: it.fieldDefinition, candidate: it.candidateValue, evidence: it.evidence, context: it.context })));
      const { parsed, usage } = await parseWithRetry(opts.models.verify, VERIFIER_SYSTEM_PROMPT, prompt, verifySchema, "verification");
      const byIndex = new Map(parsed.items.map((i) => [i.index, i]));
      const outcomes: VerifyOutcome[] = items.map((it, index) => {
        const r = byIndex.get(index);
        if (!r) return { fieldPath: it.fieldPath, status: "unsupported", correctedValue: null, contradictionDetected: false, evidenceSpecificity: 0, reason: "verifier returned no result for this item" };
        return {
          fieldPath: it.fieldPath,
          status: r.status,
          correctedValue: coerceCorrected(it.fieldPath, r.corrected_value),
          contradictionDetected: r.contradiction_detected,
          evidenceSpecificity: clamp01(r.evidence_specificity),
          reason: r.reason,
        };
      });
      return { outcomes, usage };
    },

    async answer(input: AnswerInput): Promise<AnswerResult> {
      const blocks = input.blocks.map((b) => ({ retrieval_id: b.retrievalId, logical_key: b.logicalKey, version: b.version, locator: b.locator, document: b.document, is_current: b.isCurrent, text: b.text }));
      const system = input.mode === "answer" ? RAG_SYSTEM_PROMPT : DRAFT_SYSTEM_PROMPT;
      const user = input.mode === "answer" ? ragUserPrompt(input.question, blocks) : draftUserPrompt(input.mode, input.question, blocks);
      const { parsed, usage } = await parseWithRetry(opts.models.rag, system, user, answerSchema, "answer");
      return { text: parsed.answer, usage };
    },

    async judge(input: JudgeInput): Promise<JudgeResult> {
      const { parsed, usage } = await parseWithRetry(opts.models.eval, JUDGE_SYSTEM_PROMPT, judgeUserPrompt(input), judgeSchema, "judgement");
      return { correctness: clamp01(parsed.correctness), evidenceSupport: clamp01(parsed.evidence_support), completeness: clamp01(parsed.completeness), passed: parsed.passed, reason: parsed.reason, usage };
    },

    async embed(texts: string[]): Promise<EmbedResult> {
      if (texts.length === 0) return { vectors: [], usage: { model: opts.models.embed, inputTokens: 0, outputTokens: 0, latencyMs: 0 } };
      const started = Date.now();
      try {
        const res = await client.embeddings.create({ model: opts.models.embed, input: texts, dimensions: opts.models.embedDimensions });
        const vectors = res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
        return { vectors, usage: { model: opts.models.embed, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: 0, latencyMs: Date.now() - started } };
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}
