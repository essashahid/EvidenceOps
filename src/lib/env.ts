import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_APP_NAME: z.string().default("EvidenceOps"),

  // PostgreSQL with pgvector; use a direct Neon connection for session locks.
  DATABASE_URL: z.string().default("postgres://localhost:5432/evidenceops"),
  TEST_DATABASE_URL: z.string().default("postgres://localhost:5432/evidenceops_test"),
  EVIDENCEOPS_DB: z.enum(["default", "test"]).default("default"),

  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("sources"),

  // OpenAI
  LLM_PROVIDER: z.enum(["openai", "mock"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EXTRACT_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_VERIFY_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_RAG_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_EVAL_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_EMBED_MODEL: z.string().default("text-embedding-3-small"),
  OPENAI_EMBED_DIMENSIONS: z.coerce.number().int().refine(n => n === 768, "Database vectors require 768 dimensions").default(768),

  // Inngest
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  JOB_DRIVER: z.enum(["inngest", "inline"]).default("inngest"),

  // Pipeline / prompt versions
  PIPELINE_VERSION: z.string().default("1.0.0"),
  EXTRACT_PROMPT_VERSION: z.string().default("extract-v1"),
  VERIFY_PROMPT_VERSION: z.string().default("verify-v1"),
  RAG_PROMPT_VERSION: z.string().default("rag-v1"),
  DRAFT_PROMPT_VERSION: z.string().default("draft-v1"),
  EVAL_PROMPT_VERSION: z.string().default("eval-v1"),

  // Thresholds and retrieval
  AUTO_APPROVE_THRESHOLD: z.coerce.number().default(0.86),
  REVIEW_THRESHOLD: z.coerce.number().default(0.65),
  CHUNK_TARGET_TOKENS: z.coerce.number().int().default(800),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().default(120),
  RAG_TOP_K: z.coerce.number().int().default(8),
  VECTOR_WEIGHT: z.coerce.number().default(0.75),
  LEXICAL_WEIGHT: z.coerce.number().default(0.25),

  // Limits and retries
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  MAX_DOCUMENT_PAGES: z.coerce.number().int().default(50),
  LLM_MAX_RETRIES: z.coerce.number().int().default(3),
  RETRY_DELAYS_MS: z.string().default("2000,8000,30000"),

  // Demo mode
  PUBLIC_DEMO_MODE: boolish,
  DEMO_MUTATIONS_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === undefined || v === "" || v === "1" || v === "true"),
  DEMO_ADMIN_EMAIL: z.string().default("admin@evidenceops.local"),
  DEMO_ADMIN_PASSWORD: z.string().default("evidenceops-admin"),
  DEMO_REVIEWER_EMAIL: z.string().default("reviewer@evidenceops.local"),
  DEMO_REVIEWER_PASSWORD: z.string().default("evidenceops-reviewer"),
  DEMO_VIEWER_EMAIL: z.string().default("viewer@evidenceops.local"),
  DEMO_VIEWER_PASSWORD: z.string().default("evidenceops-viewer"),

  // Failure injection: "<step>" or "<step>:<attempts>" (applies to every new run; tests use run config instead)
  FAILURE_INJECTION_STEP: z.string().optional(),

  // Database-backed sessions and private Blob storage are supported in production.
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "supabase", "blob"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  AUTH_DRIVER: z.enum(["local", "database", "supabase"]).default("local"),
  AUTH_SECRET: z.string().default("evidenceops-dev-secret-change-me"),

  EVIDENCEOPS_DEBUG: boolish,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parse and cache the environment. Throws with a readable message on invalid values. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid environment: ${parsed.error.message}`);
  const e = parsed.data;
  if (typeof window === "undefined" && e.LLM_PROVIDER === "openai" && !e.OPENAI_API_KEY && e.NODE_ENV !== "test") {
    // Startup validation: the real provider needs a key. Surfaced once, loudly.
    console.warn("[evidenceops] LLM_PROVIDER=openai but OPENAI_API_KEY is empty; model calls will fail until it is set.");
  }
  if (e.AUTH_DRIVER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    throw new Error("AUTH_DRIVER=supabase requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  if (e.STORAGE_DRIVER === "supabase" && (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY)) throw new Error("Supabase storage credentials are missing");
  if (new URL(e.DATABASE_URL).port === "6543" || new URL(e.DATABASE_URL).hostname.includes("-pooler.")) throw new Error("Use a direct database connection; transaction pooling is incompatible with pipeline advisory locks.");
  if (process.env.VERCEL && process.env.NEXT_PHASE !== "phase-production-build") {
    if (e.AUTH_DRIVER === "local" || e.STORAGE_DRIVER === "local" || e.JOB_DRIVER !== "inngest") throw new Error("Vercel requires production authentication, persistent storage and Inngest jobs.");
    if (e.AUTH_DRIVER === "database" && e.AUTH_SECRET.length < 48) throw new Error("Database authentication requires a random AUTH_SECRET of at least 48 characters.");
    if (e.LLM_PROVIDER === "openai" && !e.OPENAI_API_KEY) throw new Error("OpenAI production key is missing.");
  }
  if (e.STORAGE_DRIVER === "blob" && !e.BLOB_READ_WRITE_TOKEN) throw new Error("Private Blob storage requires BLOB_READ_WRITE_TOKEN.");
  if (Math.abs(e.VECTOR_WEIGHT + e.LEXICAL_WEIGHT - 1) > 1e-6) throw new Error("VECTOR_WEIGHT + LEXICAL_WEIGHT must equal 1");
  cached = e;
  return e;
}

export function databaseUrl(): string {
  const e = env();
  if (e.EVIDENCEOPS_DB === "test" || e.NODE_ENV === "test") return e.TEST_DATABASE_URL;
  return e.DATABASE_URL;
}

export function retryDelaysMs(): number[] {
  return env()
    .RETRY_DELAYS_MS.split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** FAILURE_INJECTION_STEP parsed into the run-config shape. */
export function failureInjectionFromEnv(): { step: string; attempts: number } | undefined {
  const raw = env().FAILURE_INJECTION_STEP?.trim();
  if (!raw) return undefined;
  const [step, attempts] = raw.split(":");
  return { step: step!, attempts: Number(attempts ?? 1) || 1 };
}

export function resetEnvCache() {
  cached = null;
}

/** Reads remain available while the background service is being connected. */
export function jobsConfigured(): boolean {
  const e = env();
  return e.JOB_DRIVER === "inline" || Boolean(e.INNGEST_EVENT_KEY && e.INNGEST_SIGNING_KEY);
}
