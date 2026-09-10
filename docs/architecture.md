# Architecture

The application uses Next.js 16 App Router with server components for reads and server actions for authenticated mutations. React client components handle table filtering/sorting, charts and form pending states. The request proxy verifies signed database sessions (or refreshes sessions for optional Supabase deployments); workspace and role authorization is repeated at the mutation boundary.

## Modules

| Module | Responsibility |
| --- | --- |
| `src/app/(app)` | Dashboard, document/source/history views, review, Ask/draft, runs, evaluations, upload and reports |
| `src/lib/schema/report.ts` | Structured extraction and record schemas; item/scalar field paths |
| `src/lib/pipeline` | Upload/versioning, parsing, chunking, extraction, deterministic validation, independent verification, scoring, routing, embeddings, retries and event logs |
| `src/lib/llm` | Explicit OpenAI and deterministic fixture-backed providers; prompts, usage and model configuration hashes |
| `src/lib/rag` | Hybrid retrieval, citation parsing, support checks and persisted answers/evidence snapshots |
| `src/lib/review` | Scoped review reads, optimistic conflict checks and immutable decisions |
| `src/lib/eval` | Golden cases, metrics, compatible baselines, regression rules and resumability checks |
| `src/lib/report` | Escaped standalone HTML QA report generation and storage |
| `src/inngest` | Document processing/retry and case-checkpointed evaluation workflows |
| `src/lib/auth`, `storage`, `access.ts` | Production/local adapters, session validation and mutation rate limiting |
| `scripts` | Fixture generation, migrations, account/full-demo seeding, evaluation, RLS/browser audit and deployment |

## Data model

Six ordered migrations implement 28 application tables plus the migration ledger:

- Identity: `app_users`, `workspaces`, `workspace_members`.
- Sources: `documents`, `document_versions`, `source_blocks`, `chunks`, `embedding_cache`.
- Execution: `processing_runs`, `processing_run_documents`, `run_steps`, `run_events`, `llm_calls`, `dead_letters`, `mutation_limits`.
- Extraction/review: `extraction_runs`, `record_versions`, `field_values`, `field_evidence`, `review_items`, `review_actions`.
- RAG: `rag_queries`, `rag_answers`, `answer_citations`.
- Quality: `eval_cases`, `eval_runs`, `eval_results`, `qa_reports`.

Migration 0001 creates the schema and indexes. 0002 adds the initial Supabase policies/private bucket. 0003 adds verifier details, mutation limits and current-version uniqueness. 0004 hardens identity linkage and direct-client permissions. 0005 introduces idempotent document outcomes. 0006 preserves superseded review items. Supabase-only migrations are skipped when the database has no Supabase Auth schema.

## Invariants

A workspace cannot access another workspace's records through the application or authenticated RLS policies. A source hash identifies one edition per workspace. Exactly one edition and record are current per identity. Review edits copy field values and evidence rather than mutating the original snapshot. Reprocessing records its own version and supersedes pending review items. Historical answers keep source/locator/score/text snapshots.

Step keys combine source identity, pipeline/model/prompt configuration. Parser/chunker keys use their own revisions and chunk settings to preserve work across model changes. Session advisory locks prevent concurrent execution for the same key. The outcome ledger makes repeated document completion idempotent. Extraction identity also guards record creation after a crash between persistence and step acknowledgement.

## Evidence and evaluation

The extractor supplies field/list-item provenance. Deterministic validation verifies source membership and quoted text. The verifier receives candidates, quotes and neighboring source blocks without an extractor confidence. Code computes the weighted score and routing. RAG resolves cited identifiers against retrieved chunks and independently checks support before persisting a sufficient answer.

Model evaluation reads the latest machine-produced record, independently of subsequent reviewer edits. Cached answers require matching case, corpus, provider/configuration and citation-validation revision. Durable evaluation steps return compact contributions so replay reconstructs aggregate metrics without repeating paid calls or duplicating case rows. The mock provider reads fixture/golden truth and therefore cannot establish live-model quality.

## Operational boundaries

Production uses a dedicated Neon project with a direct database connection, signed database sessions, private Vercel Blob storage, signed Inngest callbacks and OpenAI. The public default workspace is explicitly a synthetic demonstration. Hosted Neon, authentication, storage, browser flows, Inngest delivery, live OpenAI document processing and cited answering are verified. The published 146-case benchmark remains the deterministic mock baseline. See [the deployment runbook](deployment.md).
