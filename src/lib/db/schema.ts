import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  boolean,
  jsonb,
  numeric,
  customType,
  primaryKey,
  bigserial,
} from "drizzle-orm/pg-core";

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string) {
    return JSON.parse(value) as number[];
  },
});

const textArray = customType<{ data: string[]; driverData: string[] }>({
  dataType() {
    return "text[]";
  },
});

export const appUsers = pgTable("app_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
    userId: uuid("user_id").notNull().references(() => appUsers.id),
    role: text("role", { enum: ["admin", "reviewer", "viewer"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  logicalKey: text("logical_key").notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const PARSE_STATUSES = ["pending", "parsed", "failed", "unsupported"] as const;
export const PROCESSING_STATUSES = [
  "queued",
  "processing",
  "completed",
  "completed_with_review",
  "failed",
  "unsupported",
] as const;

export const documentVersions = pgTable("document_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  documentId: uuid("document_id").notNull().references(() => documents.id),
  versionNumber: integer("version_number").notNull(),
  contentHash: text("content_hash").notNull(),
  storagePath: text("storage_path").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull(),
  sourceFilename: text("source_filename").notNull(),
  supersedesVersionId: uuid("supersedes_version_id"),
  isCurrent: boolean("is_current").notNull().default(true),
  parseStatus: text("parse_status", { enum: PARSE_STATUSES }).notNull().default("pending"),
  processingStatus: text("processing_status", { enum: PROCESSING_STATUSES }).notNull().default("queued"),
  pageCount: integer("page_count"),
  charCount: integer("char_count"),
  uploadedBy: uuid("uploaded_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sourceBlocks = pgTable("source_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  blockType: text("block_type", { enum: ["page", "paragraph"] }).notNull(),
  blockIndex: integer("block_index").notNull(),
  locator: text("locator").notNull(),
  pageNumber: integer("page_number"),
  paragraphNumber: integer("paragraph_number"),
  rawText: text("raw_text").notNull(),
  normalizedText: text("normalized_text").notNull(),
  charStart: integer("char_start").notNull(),
  charEnd: integer("char_end").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chunks = pgTable("chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  chunkIndex: integer("chunk_index").notNull(),
  text: text("text").notNull(),
  startBlockId: uuid("start_block_id").notNull(),
  endBlockId: uuid("end_block_id").notNull(),
  startLocator: text("start_locator").notNull(),
  endLocator: text("end_locator").notNull(),
  tokenCount: integer("token_count").notNull(),
  textHash: text("text_hash").notNull(),
  embedding: vector("embedding"),
  embeddingModel: text("embedding_model"),
  embeddingDimensions: integer("embedding_dimensions"),
  embeddingKey: text("embedding_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const embeddingCache = pgTable("embedding_cache", {
  embeddingKey: text("embedding_key").primaryKey(),
  embedding: vector("embedding").notNull(),
  model: text("model").notNull(),
  dimensions: integer("dimensions").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const RUN_STATUSES = ["queued", "running", "completed", "completed_with_review", "failed"] as const;

export const processingRuns = pgTable("processing_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  runType: text("run_type", { enum: ["ingest", "reprocess", "eval", "backfill"] }).notNull(),
  pipelineVersion: text("pipeline_version").notNull(),
  provider: text("provider").notNull(),
  modelConfigHash: text("model_config_hash").notNull(),
  status: text("status", { enum: RUN_STATUSES }).notNull().default("queued"),
  currentStep: text("current_step"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  documentsTotal: integer("documents_total").notNull().default(0),
  documentsCompleted: integer("documents_completed").notNull().default(0),
  documentsFailed: integer("documents_failed").notNull().default(0),
  reviewItemsCreated: integer("review_items_created").notNull().default(0),
  retries: integer("retries").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  embeddingTokens: bigint("embedding_tokens", { mode: "number" }).notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  initiatedBy: uuid("initiated_by"),
  configJson: jsonb("config_json").$type<RunConfig>().notNull().default({}),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RunConfig = {
  /** Test hook: fail the named step on its first N attempts. */
  injectFailure?: { step: string; attempts: number };
  label?: string;
  documentVersionIds?: string[];
  [k: string]: unknown;
};

export const STEP_STATUSES = ["pending", "running", "succeeded", "failed", "dead_letter", "skipped"] as const;

export const runSteps = pgTable("run_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  processingRunId: uuid("processing_run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id"),
  stepName: text("step_name").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status", { enum: STEP_STATUSES }).notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  latencyMs: integer("latency_ms"),
  outputRef: text("output_ref"),
  outputJson: jsonb("output_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmCalls = pgTable("llm_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id"),
  processingRunId: uuid("processing_run_id"),
  documentVersionId: uuid("document_version_id"),
  purpose: text("purpose", { enum: ["extract", "verify", "answer", "draft", "judge", "embed", "classify"] }).notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version"),
  idempotencyKey: text("idempotency_key"),
  cacheHit: boolean("cache_hit").notNull().default(false),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const extractionRuns = pgTable("extraction_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  processingRunId: uuid("processing_run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  extractorModel: text("extractor_model").notNull(),
  verifierModel: text("verifier_model").notNull(),
  extractorPromptVersion: text("extractor_prompt_version").notNull(),
  verifierPromptVersion: text("verifier_prompt_version").notNull(),
  modelConfigHash: text("model_config_hash").notNull(),
  rawExtractionJson: jsonb("raw_extraction_json").notNull(),
  verificationJson: jsonb("verification_json"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
});

export const recordVersions = pgTable("record_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  extractionRunId: uuid("extraction_run_id"),
  parentRecordVersionId: uuid("parent_record_version_id"),
  versionNumber: integer("version_number").notNull(),
  createdByType: text("created_by_type", { enum: ["model", "reviewer", "reprocess"] }).notNull(),
  createdByUserId: uuid("created_by_user_id"),
  modelConfigHash: text("model_config_hash"),
  payloadJson: jsonb("payload_json").notNull(),
  changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
  isCurrent: boolean("is_current").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ROUTING_STATUSES = ["auto_approved", "review", "blocked", "accepted", "rejected", "needs_source"] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];

export const fieldValues = pgTable("field_values", {
  id: uuid("id").primaryKey().defaultRandom(),
  recordVersionId: uuid("record_version_id").notNull().references(() => recordVersions.id),
  fieldPath: text("field_path").notNull(),
  valueJson: jsonb("value_json"),
  isRequired: boolean("is_required").notNull().default(false),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
  routingStatus: text("routing_status", { enum: ROUTING_STATUSES }).notNull(),
  deterministicValidation: numeric("deterministic_validation", { precision: 4, scale: 3 }).notNull().default("0"),
  evidenceExactMatch: numeric("evidence_exact_match", { precision: 4, scale: 3 }).notNull().default("0"),
  verifierSupport: numeric("verifier_support", { precision: 4, scale: 3 }).notNull().default("0"),
  crossPassAgreement: numeric("cross_pass_agreement", { precision: 4, scale: 3 }).notNull().default("0"),
  evidenceSpecificity: numeric("evidence_specificity", { precision: 4, scale: 3 }).notNull().default("0"),
  verifierStatus: text("verifier_status"),
  verifierReason: text("verifier_reason"),
  ambiguity: text("ambiguity"),
  contradiction: boolean("contradiction").notNull().default(false),
  verifierCorrectedValueJson: jsonb("verifier_corrected_value_json"),
  validationMessages: jsonb("validation_messages").$type<ValidationMessage[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ValidationMessage = { level: "error" | "warning"; code: string; message: string };

export const fieldEvidence = pgTable("field_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  fieldValueId: uuid("field_value_id").notNull().references(() => fieldValues.id),
  sourceBlockId: uuid("source_block_id"),
  quoteText: text("quote_text").notNull(),
  quoteStart: integer("quote_start"),
  quoteEnd: integer("quote_end"),
  sourceLocator: text("source_locator").notNull(),
  exactMatch: boolean("exact_match").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewItems = pgTable("review_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  recordVersionId: uuid("record_version_id").notNull().references(() => recordVersions.id),
  fieldValueId: uuid("field_value_id").notNull().references(() => fieldValues.id),
  fieldPath: text("field_path").notNull(),
  status: text("status", { enum: ["open", "resolved", "rejected", "needs_source", "superseded"] }).notNull().default("open"),
  priority: text("priority", { enum: ["normal", "high"] }).notNull().default("normal"),
  reason: text("reason").notNull(),
  assignedTo: uuid("assigned_to"),
  resolvedBy: uuid("resolved_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const reviewActions = pgTable("review_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewItemId: uuid("review_item_id").notNull().references(() => reviewItems.id),
  reviewerUserId: uuid("reviewer_user_id").notNull(),
  action: text("action", { enum: ["accept", "edit_accept", "reject", "needs_source"] }).notNull(),
  oldValueJson: jsonb("old_value_json"),
  newValueJson: jsonb("new_value_json"),
  comment: text("comment"),
  resultingRecordVersionId: uuid("resulting_record_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ragQueries = pgTable("rag_queries", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  queryText: text("query_text").notNull(),
  queryEmbedding: vector("query_embedding"),
  includeSuperseded: boolean("include_superseded").notNull().default(false),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ANSWER_MODES = ["answer", "executive_brief", "findings", "recommendations"] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const ragAnswers = pgTable("rag_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  ragQueryId: uuid("rag_query_id").notNull().references(() => ragQueries.id),
  mode: text("mode", { enum: ANSWER_MODES }).notNull(),
  answerText: text("answer_text").notNull(),
  answerJson: jsonb("answer_json"),
  sufficientEvidence: boolean("sufficient_evidence").notNull(),
  refusalReason: text("refusal_reason"),
  retrievedJson: jsonb("retrieved_json").notNull().default([]),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const answerCitations = pgTable("answer_citations", {
  id: uuid("id").primaryKey().defaultRandom(),
  ragAnswerId: uuid("rag_answer_id").notNull().references(() => ragAnswers.id),
  chunkId: uuid("chunk_id"),
  sourceBlockId: uuid("source_block_id"),
  documentVersionId: uuid("document_version_id"),
  sourceLocator: text("source_locator").notNull(),
  citationOrder: integer("citation_order").notNull(),
  supportedClaim: text("supported_claim").notNull(),
  quoteText: text("quote_text"),
  similarityScore: numeric("similarity_score", { precision: 6, scale: 5 }),
  lexicalScore: numeric("lexical_score", { precision: 6, scale: 5 }),
  combinedScore: numeric("combined_score", { precision: 6, scale: 5 }),
});

export const EVAL_CASE_TYPES = [
  "extraction",
  "provenance",
  "review_routing",
  "retrieval",
  "answer",
  "refusal",
  "duplicate",
  "version",
  "classification",
] as const;
export type EvalCaseType = (typeof EVAL_CASE_TYPES)[number];

export const evalCases = pgTable("eval_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  caseKey: text("case_key").notNull().unique(),
  caseType: text("case_type", { enum: EVAL_CASE_TYPES }).notNull(),
  question: text("question"),
  documentLogicalKey: text("document_logical_key"),
  expectedJson: jsonb("expected_json").notNull(),
  tags: textArray("tags").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evalRuns = pgTable("eval_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id),
  processingRunId: uuid("processing_run_id"),
  baselineEvalRunId: uuid("baseline_eval_run_id"),
  provider: text("provider").notNull(),
  modelConfigHash: text("model_config_hash").notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  aggregateMetricsJson: jsonb("aggregate_metrics_json").$type<Record<string, unknown>>().notNull().default({}),
  regressionJson: jsonb("regression_json").$type<Record<string, unknown>>().notNull().default({}),
  regressionPassed: boolean("regression_passed"),
  isBaseline: boolean("is_baseline").notNull().default(false),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
});

export const evalResults = pgTable("eval_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  evalRunId: uuid("eval_run_id").notNull().references(() => evalRuns.id),
  evalCaseId: uuid("eval_case_id").notNull().references(() => evalCases.id),
  passed: boolean("passed").notNull(),
  metricJson: jsonb("metric_json").$type<Record<string, unknown>>().notNull().default({}),
  expectedJson: jsonb("expected_json").notNull(),
  actualJson: jsonb("actual_json"),
  judgeReason: text("judge_reason"),
  latencyMs: integer("latency_ms").notNull().default(0),
  estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const runEvents = pgTable("run_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  processingRunId: uuid("processing_run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id"),
  level: text("level", { enum: ["debug", "info", "warn", "error"] }).notNull(),
  eventType: text("event_type").notNull(),
  message: text("message").notNull(),
  payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deadLetters = pgTable("dead_letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  processingRunId: uuid("processing_run_id").notNull().references(() => processingRuns.id),
  documentVersionId: uuid("document_version_id").notNull().references(() => documentVersions.id),
  failedStep: text("failed_step").notNull(),
  errorCode: text("error_code").notNull(),
  errorMessage: text("error_message").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  retryable: boolean("retryable").notNull().default(true),
  status: text("status", { enum: ["open", "retrying", "resolved"] }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const qaReports = pgTable("qa_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  processingRunId: uuid("processing_run_id").notNull().references(() => processingRuns.id),
  evalRunId: uuid("eval_run_id"),
  status: text("status", { enum: ["pending", "generated", "failed"] }).notNull().default("pending"),
  storagePath: text("storage_path"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
