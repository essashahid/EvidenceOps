import { z } from "zod";

const boolish = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("postgres://localhost:5432/evidenceops"),
  TEST_DATABASE_URL: z.string().default("postgres://localhost:5432/evidenceops_test"),
  EVIDENCEOPS_DB: z.enum(["default", "test"]).default("default"),

  LLM_PROVIDER: z.enum(["openai", "mock"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_EXTRACTOR_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_VERIFIER_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_ANSWER_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_JUDGE_MODEL: z.string().default("gpt-5.6-luna"),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().default(768),

  STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),

  AUTH_DRIVER: z.enum(["local", "supabase"]).default("local"),
  AUTH_SECRET: z.string().default("evidenceops-dev-secret-change-me"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("sources"),

  JOB_DRIVER: z.enum(["inngest", "inline"]).default("inngest"),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  SEED_ADMIN_EMAIL: z.string().default("admin@evidenceops.local"),
  SEED_ADMIN_PASSWORD: z.string().default("evidenceops-admin"),
  SEED_REVIEWER_EMAIL: z.string().default("reviewer@evidenceops.local"),
  SEED_REVIEWER_PASSWORD: z.string().default("evidenceops-reviewer"),

  EVIDENCEOPS_DEBUG: boolish,
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}

/** Resolve the database URL for the current process (test DB when running tests). */
export function databaseUrl(): string {
  const e = env();
  if (e.EVIDENCEOPS_DB === "test" || e.NODE_ENV === "test") return e.TEST_DATABASE_URL;
  return e.DATABASE_URL;
}

/** Reset cached env (tests). */
export function resetEnvCache() {
  cached = null;
}
