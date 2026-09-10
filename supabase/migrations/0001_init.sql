-- EvidenceOps schema. Plain PostgreSQL 15+ with pgvector.
create extension if not exists vector;

-- ---------- identity / tenancy ----------
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  password_hash text,               -- only used by the local auth driver
  created_at timestamptz not null default now()
);

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null check (role in ('admin','reviewer','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ---------- documents ----------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  logical_key text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, logical_key)
);

create table if not exists document_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  content_hash text not null,
  storage_path text not null,
  mime_type text not null check (mime_type in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  byte_size bigint not null check (byte_size > 0),
  source_filename text not null,
  supersedes_version_id uuid references document_versions(id),
  is_current boolean not null default true,
  parse_status text not null default 'pending' check (parse_status in ('pending','parsed','failed','unsupported')),
  processing_status text not null default 'queued' check (processing_status in ('queued','processing','completed','completed_with_review','failed','unsupported')),
  page_count integer,
  char_count integer,
  uploaded_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  unique (document_id, version_number),
  unique (workspace_id, content_hash)
);
create index if not exists document_versions_document_idx on document_versions(document_id, is_current);

create table if not exists source_blocks (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  block_type text not null check (block_type in ('page','paragraph')),
  block_index integer not null,
  locator text not null,            -- e.g. SRC-OPS-2026-004-V2-P03
  page_number integer,
  paragraph_number integer,
  raw_text text not null,
  normalized_text text not null,
  char_start integer not null,
  char_end integer not null,
  created_at timestamptz not null default now(),
  unique (document_version_id, block_type, block_index),
  unique (document_version_id, locator)
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  start_block_id uuid not null references source_blocks(id) on delete cascade,
  end_block_id uuid not null references source_blocks(id) on delete cascade,
  start_locator text not null,
  end_locator text not null,
  token_count integer not null,
  text_hash text not null,
  embedding vector(768),
  embedding_model text,
  embedding_dimensions integer,
  embedding_key text,
  search_tsv tsvector generated always as (to_tsvector('english', text)) stored,
  created_at timestamptz not null default now(),
  unique (document_version_id, chunk_index)
);
create index if not exists chunks_tsv_idx on chunks using gin (search_tsv);
create index if not exists chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_workspace_idx on chunks(workspace_id, document_version_id);

create table if not exists embedding_cache (
  embedding_key text primary key,
  embedding vector(768) not null,
  model text not null,
  dimensions integer not null,
  created_at timestamptz not null default now()
);

-- ---------- processing ----------
create table if not exists processing_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  run_type text not null check (run_type in ('ingest','reprocess','eval','backfill')),
  pipeline_version text not null,
  provider text not null,
  model_config_hash text not null,
  status text not null default 'queued' check (status in ('queued','running','completed','completed_with_review','failed')),
  current_step text,
  started_at timestamptz,
  completed_at timestamptz,
  documents_total integer not null default 0,
  documents_completed integer not null default 0,
  documents_failed integer not null default 0,
  review_items_created integer not null default 0,
  retries integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  embedding_tokens bigint not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  initiated_by uuid references app_users(id),
  config_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);
create index if not exists processing_runs_workspace_idx on processing_runs(workspace_id, created_at desc);

create table if not exists run_steps (
  id uuid primary key default gen_random_uuid(),
  processing_run_id uuid not null references processing_runs(id) on delete cascade,
  document_version_id uuid references document_versions(id) on delete cascade,
  step_name text not null,
  idempotency_key text not null unique,
  status text not null check (status in ('pending','running','succeeded','failed','dead_letter','skipped')),
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  latency_ms integer,
  output_ref text,
  output_json jsonb,
  error_code text,
  error_message text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists run_steps_run_idx on run_steps(processing_run_id, created_at);
create index if not exists run_steps_docver_idx on run_steps(document_version_id, step_name);

create table if not exists llm_calls (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  processing_run_id uuid references processing_runs(id) on delete cascade,
  document_version_id uuid references document_versions(id) on delete cascade,
  purpose text not null check (purpose in ('extract','verify','answer','draft','judge','embed','classify')),
  provider text not null,
  model text not null,
  prompt_version text,
  idempotency_key text,
  cache_hit boolean not null default false,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists llm_calls_run_idx on llm_calls(processing_run_id);

create table if not exists extraction_runs (
  id uuid primary key default gen_random_uuid(),
  processing_run_id uuid not null references processing_runs(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  extractor_model text not null,
  verifier_model text not null,
  extractor_prompt_version text not null,
  verifier_prompt_version text not null,
  model_config_hash text not null,
  raw_extraction_json jsonb not null,
  verification_json jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(10,6) not null default 0
);
create index if not exists extraction_runs_docver_idx on extraction_runs(document_version_id);

create table if not exists record_versions (
  id uuid primary key default gen_random_uuid(),
  document_version_id uuid not null references document_versions(id) on delete cascade,
  extraction_run_id uuid references extraction_runs(id),
  parent_record_version_id uuid references record_versions(id),
  version_number integer not null check (version_number >= 1),
  created_by_type text not null check (created_by_type in ('model','reviewer','reprocess')),
  created_by_user_id uuid references app_users(id),
  model_config_hash text,
  payload_json jsonb not null,
  changed_fields jsonb not null default '[]'::jsonb,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (document_version_id, version_number)
);
create index if not exists record_versions_docver_idx on record_versions(document_version_id, is_current);

create table if not exists field_values (
  id uuid primary key default gen_random_uuid(),
  record_version_id uuid not null references record_versions(id) on delete cascade,
  field_path text not null,
  value_json jsonb,
  is_required boolean not null default false,
  confidence numeric(4,3) not null default 0,
  routing_status text not null check (routing_status in ('auto_approved','review','blocked','accepted','rejected','needs_source')),
  deterministic_validation numeric(4,3) not null default 0,
  evidence_exact_match numeric(4,3) not null default 0,
  verifier_support numeric(4,3) not null default 0,
  cross_pass_agreement numeric(4,3) not null default 0,
  evidence_specificity numeric(4,3) not null default 0,
  verifier_status text,
  verifier_reason text,
  ambiguity text,
  contradiction boolean not null default false,
  verifier_corrected_value_json jsonb,
  validation_messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists field_values_record_idx on field_values(record_version_id, field_path);

create table if not exists field_evidence (
  id uuid primary key default gen_random_uuid(),
  field_value_id uuid not null references field_values(id) on delete cascade,
  source_block_id uuid references source_blocks(id) on delete set null,
  quote_text text not null,
  quote_start integer,
  quote_end integer,
  source_locator text not null,
  exact_match boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists field_evidence_field_idx on field_evidence(field_value_id);

-- ---------- review ----------
create table if not exists review_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  record_version_id uuid not null references record_versions(id) on delete cascade,
  field_value_id uuid not null references field_values(id) on delete cascade,
  field_path text not null,
  status text not null default 'open' check (status in ('open','resolved','rejected','needs_source')),
  priority text not null default 'normal' check (priority in ('normal','high')),
  reason text not null,
  assigned_to uuid references app_users(id),
  resolved_by uuid references app_users(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists review_items_open_idx on review_items(workspace_id, status, created_at);

create table if not exists review_actions (
  id uuid primary key default gen_random_uuid(),
  review_item_id uuid not null references review_items(id) on delete cascade,
  reviewer_user_id uuid not null references app_users(id),
  action text not null check (action in ('accept','edit_accept','reject','needs_source')),
  old_value_json jsonb,
  new_value_json jsonb,
  comment text,
  resulting_record_version_id uuid references record_versions(id),
  created_at timestamptz not null default now()
);

-- ---------- RAG ----------
create table if not exists rag_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  query_text text not null,
  query_embedding vector(768),
  include_superseded boolean not null default false,
  created_by uuid references app_users(id),
  created_at timestamptz not null default now()
);

create table if not exists rag_answers (
  id uuid primary key default gen_random_uuid(),
  rag_query_id uuid not null references rag_queries(id) on delete cascade,
  mode text not null check (mode in ('answer','executive_brief','findings','recommendations')),
  answer_text text not null,
  answer_json jsonb,
  sufficient_evidence boolean not null,
  refusal_reason text,
  retrieved_json jsonb not null default '[]'::jsonb,
  model text not null,
  prompt_version text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  latency_ms integer not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists answer_citations (
  id uuid primary key default gen_random_uuid(),
  rag_answer_id uuid not null references rag_answers(id) on delete cascade,
  chunk_id uuid references chunks(id) on delete set null,
  source_block_id uuid references source_blocks(id) on delete set null,
  document_version_id uuid references document_versions(id) on delete set null,
  source_locator text not null,
  citation_order integer not null,
  supported_claim text not null,
  quote_text text,
  similarity_score numeric(6,5),
  lexical_score numeric(6,5),
  combined_score numeric(6,5)
);

-- ---------- evaluation ----------
create table if not exists eval_cases (
  id uuid primary key default gen_random_uuid(),
  case_key text not null unique,
  case_type text not null check (case_type in ('extraction','provenance','review_routing','retrieval','answer','refusal','duplicate','version','classification')),
  question text,
  document_logical_key text,
  expected_json jsonb not null,
  tags text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  processing_run_id uuid references processing_runs(id) on delete set null,
  baseline_eval_run_id uuid references eval_runs(id),
  provider text not null,
  model_config_hash text not null,
  status text not null default 'running' check (status in ('running','completed','failed')),
  aggregate_metrics_json jsonb not null default '{}'::jsonb,
  regression_json jsonb not null default '{}'::jsonb,
  regression_passed boolean,
  is_baseline boolean not null default false,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text
);

create table if not exists eval_results (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid not null references eval_runs(id) on delete cascade,
  eval_case_id uuid not null references eval_cases(id) on delete cascade,
  passed boolean not null,
  metric_json jsonb not null default '{}'::jsonb,
  expected_json jsonb not null,
  actual_json jsonb,
  judge_reason text,
  latency_ms integer not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists eval_results_run_idx on eval_results(eval_run_id);

-- ---------- observability ----------
create table if not exists run_events (
  id bigserial primary key,
  processing_run_id uuid not null references processing_runs(id) on delete cascade,
  document_version_id uuid references document_versions(id) on delete cascade,
  level text not null check (level in ('debug','info','warn','error')),
  event_type text not null,
  message text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists run_events_run_idx on run_events(processing_run_id, created_at);

create table if not exists dead_letters (
  id uuid primary key default gen_random_uuid(),
  processing_run_id uuid not null references processing_runs(id) on delete cascade,
  document_version_id uuid not null references document_versions(id) on delete cascade,
  failed_step text not null,
  error_code text not null,
  error_message text not null,
  attempt_count integer not null default 0,
  retryable boolean not null default true,
  status text not null default 'open' check (status in ('open','retrying','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists qa_reports (
  id uuid primary key default gen_random_uuid(),
  processing_run_id uuid not null references processing_runs(id) on delete cascade,
  eval_run_id uuid references eval_runs(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','generated','failed')),
  storage_path text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
