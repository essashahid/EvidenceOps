# Architecture

## Components

```
Next.js UI + server actions  ->  PostgreSQL/pgvector (Supabase)  <->  Inngest durable functions
        |                                   ^                                  |
        |                                   |                                  v
        +----------- upload ----------------+                 parse -> chunk -> extract -> validate
                                                              -> verify -> score_and_route -> embed
                                                                    |                     |
                                                            record versions        chunk index
                                                            review queue     ->   hybrid RAG / drafts
                                                                    |                     |
                                                                    +---- eval harness ----+
                                                                              |
                                                                        QA HTML report
```

## Data flow

1. **Upload** (`registerUpload`): validate type/size, SHA-256, duplicate check within the workspace, resolve the logical document (derived from the filename identifier such as `OPS-2026-004`), create the next version (`supersedes_version_id`, previous `is_current=false`), store bytes, then create a processing run and dispatch (`dispatchRun`).
2. **parse**: pdfjs page text or mammoth paragraphs become `source_blocks` with locators and character offsets. Fewer than 100 characters on more than half of the pages marks the version `unsupported_scanned_document` (dead letter, manual queue).
3. **chunk**: sentence-aligned ~800-token chunks with ~120-token overlap, never across documents, with start/end block provenance and a full-text `tsvector`.
4. **extract**: one structured call; every leaf value has `{locator, quote}` evidence.
5. **validate**: deterministic checks (`validate.ts`) produce per-field messages, a 1 / 0.5 / 0 score and the evidence exact-match flag with quote offsets.
6. **verify**: an independent model call in batches of 12 receives the candidate, the cited quote, the whole cited block and the field definition (never the extractor's confidence) and returns support status, corrected value, agreement, contradiction flag and specificity.
7. **score_and_route**: code combines the components into the confidence and routing; writes `record_versions` v1 with `field_values` + `field_evidence` and `review_items` for review/blocked fields.
8. **embed**: embeddings keyed by `sha256(text|model|dims)` through `embedding_cache`; stored on `chunks`.
9. **review**: reviewer actions create new immutable record versions (`created_by_type=reviewer`) that copy every field value so each version is self-contained.
10. **RAG**: query embedding, candidate pool from vector and full-text search, normalized 75/25 combination, top 8, current versions only unless requested; the answer model only sees those chunks; citations are validated verbatim in code and stored with the resolved source block.
11. **eval**: golden cases seeded from fixtures, per-case results, aggregates, regression vs baseline, QA report.

## Idempotency and resumability

`run_steps.idempotency_key = workspace:document_version:step:pipeline_version:model_config_hash`. `runStep` returns the stored output when a succeeded row exists, otherwise records an attempt and executes. Inngest memoizes each step inside a function run as well; the database key makes reuse work across runs, manual retries and the inline runner.

## Tables

See `supabase/migrations/0001_init.sql` for the full schema: `workspaces`, `workspace_members`, `app_users`, `documents`, `document_versions`, `source_blocks`, `chunks`, `embedding_cache`, `processing_runs`, `run_steps`, `llm_calls`, `extraction_runs`, `record_versions`, `field_values`, `field_evidence`, `review_items`, `review_actions`, `rag_queries`, `rag_answers`, `answer_citations`, `eval_cases`, `eval_runs`, `eval_results`, `run_events`, `dead_letters`, `qa_reports`.

## Confidence

```
confidence = 0.30 * evidence_exact_match
           + 0.20 * deterministic_validation
           + 0.25 * verifier_support
           + 0.15 * cross_pass_agreement
           + 0.10 * evidence_specificity
```

Auto-approve at >= 0.86 with no contradiction; review for 0.65 <= c < 0.86 or a partially supported verdict; blocked below 0.65 or on unsupported, contradiction, unknown locator, or an empty required field.
