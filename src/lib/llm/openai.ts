import OpenAI, { APIConnectionTimeoutError, APIError, RateLimitError } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { extractionOutputSchema, fieldKind } from "@/lib/schema/report";
import {
  ANSWER_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  EXTRACTOR_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
  answerUserPrompt,
  extractorUserPrompt,
  judgeUserPrompt,
  verifierUserPrompt,
} from "./prompts";
import {
  AGREEMENTS,
  LlmError,
  SPECIFICITIES,
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

const claimSchema = z.object({
  text: z.string(),
  kind: z.enum(["direct", "synthesis"]),
  citations: z.array(z.object({ chunk_index: z.number().int(), quote: z.string() })),
});

const answerSchema = z.object({
  sufficient: z.boolean(),
  refusal_reason: z.string().nullable(),
  answer_text: z.string(),
  claims: z.array(claimSchema),
  draft: z
    .object({
      title: z.string(),
      key_evidence: z.array(claimSchema),
      findings: z.array(claimSchema),
      recommendations: z.array(claimSchema),
      limitations: z.array(z.string()),
    })
    .nullable(),
});

const verifySchema = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      status: z.enum(VERIFIER_STATUSES),
      corrected_value: z.string().nullable(),
      agreement: z.enum(AGREEMENTS),
      contradiction: z.boolean(),
      specificity: z.enum(SPECIFICITIES),
      reason: z.string(),
    }),
  ),
});

const judgeSchema = z.object({ score: z.number(), reason: z.string() });

function mapError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof APIConnectionTimeoutError) return new LlmError(err.message, "timeout", true);
  if (err instanceof RateLimitError) return new LlmError(err.message, "rate_limited", true);
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    return new LlmError(`${status} ${err.message}`, "api_error", status >= 500 || status === 408 || status === 409);
  }
  if (err instanceof Error && /ECONNRESET|ETIMEDOUT|fetch failed|socket/i.test(err.message)) {
    return new LlmError(err.message, "api_error", true);
  }
  return new LlmError(err instanceof Error ? err.message : String(err), "api_error", false);
}

function coerceCorrected(fieldPath: string, raw: string | null): unknown {
  if (raw === null) return null;
  const kind = fieldKind(fieldPath);
  if (kind === "number") {
    const n = Number(raw.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return raw;
}

export type OpenAiProviderOptions = {
  apiKey: string;
  models: LlmModels;
  timeoutMs?: number;
};

export function createOpenAiProvider(opts: OpenAiProviderOptions): LlmProvider {
  if (!opts.apiKey) throw new LlmError("OPENAI_API_KEY is not set", "config", false);
  const client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 180_000, maxRetries: 2 });

  async function parseWithRetry<T>(
    model: string,
    system: string,
    user: string,
    schema: z.ZodType<T>,
    name: string,
  ): Promise<{ parsed: T; usage: LlmUsage; raw: unknown }> {
    let lastErr: LlmError | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          text: { format: zodTextFormat(schema, name) },
        });
        const usage: LlmUsage = {
          model,
          inputTokens: response.usage?.input_tokens ?? 0,
          outputTokens: response.usage?.output_tokens ?? 0,
          latencyMs: Date.now() - started,
        };
        const parsed = response.output_parsed;
        if (parsed === null || parsed === undefined) {
          lastErr = new LlmError(`model returned no structured output (${name})`, "invalid_structured_output", false);
          continue; // one immediate retry
        }
        const check = schema.safeParse(parsed);
        if (!check.success) {
          lastErr = new LlmError(`structured output failed validation: ${check.error.message}`, "invalid_structured_output", false);
          continue;
        }
        return { parsed: check.data, usage, raw: parsed };
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
      const { parsed, usage, raw } = await parseWithRetry(
        opts.models.extractor,
        EXTRACTOR_SYSTEM_PROMPT,
        extractorUserPrompt(input.documentName, input.blocks),
        extractionOutputSchema,
        "extraction",
      );
      return { output: parsed, usage, raw };
    },

    async verify(items: VerifyItem[]): Promise<VerifyResult> {
      if (items.length === 0) {
        return { outcomes: [], usage: { model: opts.models.verifier, inputTokens: 0, outputTokens: 0, latencyMs: 0 } };
      }
      const prompt = verifierUserPrompt(
        items.map((it, index) => ({
          index,
          fieldPath: it.fieldPath,
          fieldDefinition: it.fieldDefinition,
          candidateValue: it.candidateValue,
          quote: it.evidence.quote,
          locator: it.evidence.locator,
          blockText: it.blockText,
          quoteFound: it.quoteFound,
        })),
      );
      const { parsed, usage } = await parseWithRetry(opts.models.verifier, VERIFIER_SYSTEM_PROMPT, prompt, verifySchema, "verification");
      const byIndex = new Map(parsed.items.map((i) => [i.index, i]));
      const outcomes: VerifyOutcome[] = items.map((it, index) => {
        const r = byIndex.get(index);
        if (!r) {
          return {
            fieldPath: it.fieldPath,
            status: "unsupported",
            correctedValue: null,
            agreement: "different",
            contradiction: false,
            specificity: "none",
            reason: "verifier returned no result for this item",
          };
        }
        return {
          fieldPath: it.fieldPath,
          status: r.status,
          correctedValue: coerceCorrected(it.fieldPath, r.corrected_value),
          agreement: r.agreement,
          contradiction: r.contradiction,
          specificity: r.specificity,
          reason: r.reason,
        };
      });
      return { outcomes, usage };
    },

    async answer(input: AnswerInput): Promise<AnswerResult> {
      const system = input.mode === "answer" ? ANSWER_SYSTEM_PROMPT : DRAFT_SYSTEM_PROMPT;
      const { parsed, usage } = await parseWithRetry(
        opts.models.answer,
        system,
        answerUserPrompt(input.question, input.mode, input.chunks),
        answerSchema,
        "answer",
      );
      const toClaim = (c: z.infer<typeof claimSchema>) => ({
        text: c.text,
        kind: c.kind,
        citations: c.citations.map((ci) => ({ chunkIndex: ci.chunk_index, quote: ci.quote })),
      });
      return {
        sufficient: parsed.sufficient,
        refusalReason: parsed.refusal_reason,
        answerText: parsed.answer_text,
        claims: parsed.claims.map(toClaim),
        draft: parsed.draft
          ? {
              title: parsed.draft.title,
              key_evidence: parsed.draft.key_evidence.map(toClaim),
              findings: parsed.draft.findings.map(toClaim),
              recommendations: parsed.draft.recommendations.map(toClaim),
              limitations: parsed.draft.limitations,
            }
          : null,
        usage,
      };
    },

    async judge(input: JudgeInput): Promise<JudgeResult> {
      const { parsed, usage } = await parseWithRetry(opts.models.judge, JUDGE_SYSTEM_PROMPT, judgeUserPrompt(input), judgeSchema, "judgement");
      return { score: Math.max(0, Math.min(1, parsed.score)), reason: parsed.reason, usage };
    },

    async embed(texts: string[]): Promise<EmbedResult> {
      if (texts.length === 0) {
        return { vectors: [], usage: { model: opts.models.embedding, inputTokens: 0, outputTokens: 0, latencyMs: 0 } };
      }
      const started = Date.now();
      try {
        const res = await client.embeddings.create({
          model: opts.models.embedding,
          input: texts,
          dimensions: opts.models.embeddingDimensions,
        });
        const vectors = res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
        return {
          vectors,
          usage: { model: opts.models.embedding, inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: 0, latencyMs: Date.now() - started },
        };
      } catch (err) {
        throw mapError(err);
      }
    },
  };
}
