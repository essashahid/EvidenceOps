# EvidenceOps

**Production document intelligence and RAG quality workbench.** Turn PDFs and DOCX files into cited structured records and evidence-bound AI answers, with independent verification, calculated confidence, human review, immutable record versions, a golden regression suite and full run observability.

EvidenceOps is the system that sits *after* reliable data acquisition: documents go in, every extracted value comes out with a verbatim quote and a source locator, every model output is checked by a second model and by deterministic code, uncertain values go to a reviewer with the exact evidence, and every run is measured, costed and reported.

```
documents -> parse (provenance anchors) -> chunk -> extract (LLM) -> deterministic validation
-> independent verification (LLM) -> calculated confidence -> route (auto / review / blocked)
-> immutable record versions -> embed -> hybrid RAG with citations -> evaluation -> QA report
```

## What it does

| Capability | Where |
| --- | --- |
| PDF/DOCX ingestion with SHA-256 dedupe and logical-document versioning | `src/lib/pipeline/ingest.ts` |
| Source blocks with immutable locators (`SRC-OPS-2026-004-V2-P03`, `...-PARA17`) | `src/lib/pipeline/parse.ts` |
| Scanned/image-only PDF detection (no OCR; routed to the manual queue) | `parse.ts`, `config.ts` |
| Structured extraction where every leaf carries evidence | `src/lib/schema/report.ts`, `src/lib/llm/` |
| Deterministic validation (required, enums, dates, amounts, list limits, locator exists, quote appears) | `src/lib/pipeline/validate.ts` |
| Independent verifier pass that never sees extractor confidence | `src/lib/llm/prompts.ts`, `process-document.ts` |
| Calculated confidence `0.30 evidence + 0.20 validation + 0.25 verifier + 0.15 agreement + 0.10 specificity` | `src/lib/pipeline/confidence.ts` |
| Routing: auto-approve at 0.86, review from 0.65, blocked below or on contradiction/unsupported evidence | `confidence.ts` |
| Review queue with source context, component breakdown, accept / edit / reject / needs-source | `src/lib/review/`, `/review` |
| Immutable record versions (model, reviewer, reprocess) with parent links and changed fields | `record_versions` |
| Chunking (800 tokens, 120 overlap), pgvector + full-text hybrid retrieval (75/25), current versions only by default | `chunk.ts`, `src/lib/rag/retrieve.ts` |
| Evidence-bound answers and drafts; every citation is re-checked verbatim in code | `src/lib/rag/answer.ts` |
| Durable steps with idempotency keys, 2 s / 8 s / 30 s retries, dead letters, manual retry, resume without re-parsing or re-paying | `steps-runner.ts`, `orchestrate.ts`, `src/inngest/` |
| Golden evaluation suite (extraction, provenance, classification, review routing, retrieval, answers, refusals, duplicates, versions) with regression gates and baselines | `src/lib/eval/` |
| HTML QA report per run (corpus, metrics, confidence distribution, provenance, review, RAG, duplicates/versions, retries, cost, latency, regression) | `src/lib/report/qa-report.ts` |
| Run observability: steps, attempts, latency p50/p95, events, tokens, cost, model config hash | `/runs/[id]` |

## Stack

Node 22, TypeScript, Next.js 16 (App Router, server actions), PostgreSQL + pgvector (Supabase in production, Homebrew/any Postgres locally), Drizzle ORM, Inngest for durable execution, OpenAI Responses API (`gpt-5.6-luna` default, `text-embedding-3-small` at 768 dimensions), Tailwind 4, Vitest, Playwright.

## Quick start (local, no external services)

Requirements: Node 22, pnpm 10, PostgreSQL 15+ with the `vector` extension.

```bash
cp .env.example .env            # defaults: local auth, local storage, inline jobs
createdb evidenceops && createdb evidenceops_test
psql evidenceops -c 'create extension if not exists vector'
psql evidenceops_test -c 'create extension if not exists vector'
pnpm install
pnpm db:migrate                 # applies supabase/migrations/*.sql
pnpm db:seed                    # workspace + demo users + eval cases
pnpm fixtures:generate          # renders the 20-file synthetic corpus and verifies quotes
pnpm dev                        # http://localhost:3000
```

Demo accounts: `admin@evidenceops.local / evidenceops-admin` (admin) and `reviewer@evidenceops.local / evidenceops-reviewer` (reviewer).

Set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` to use real models. With `LLM_PROVIDER=mock` the deterministic, fixture-backed provider is used: extraction comes from the committed ground truth (including planted uncertain readings), verification is rule based, embeddings are hashed bag-of-words vectors and answers are extractive. The mock exists so the whole system, tests and evaluation run offline; it is never used as a fallback for the real provider.

`JOB_DRIVER=inline` processes uploads synchronously in the request (development and tests). `JOB_DRIVER=inngest` dispatches to Inngest; run `pnpm inngest:dev` alongside `pnpm dev` locally.

## Commands

```bash
pnpm lint
pnpm typecheck
pnpm test                 # unit tests (pure modules)
pnpm test:integration     # against TEST_DATABASE_URL: pipeline, failures, review, RAG
pnpm test:e2e             # Playwright against a dev server on port 3100
pnpm eval                 # ingest corpus, run the golden suite, compare baseline, write QA report
pnpm build

pnpm ingest:corpus                    # upload + process the fixture corpus (idempotent)
pnpm process:one OPS-2026-004@1       # process one version inline without Inngest
pnpm process:one <id> --fail-step extract:2   # inject a failure on the first 2 attempts
pnpm eval --set-baseline              # promote this run to the regression baseline
```

`pnpm eval` exits non-zero when a regression rule fails (extraction accuracy drop > 2 pp, evidence validity drop > 1 pp, review recall drop > 5 pp, retrieval Recall@5 drop > 3 pp, refusal accuracy < 95%, semantic score < 0.90, duplicate/version cases failing) or when a success target is unmet. Baselines are stored per provider in `eval/baselines/<provider>.json` and flagged on `eval_runs`.

## Fixture corpus

`fixtures/` holds 18 synthetic operational reports from fictional organizations (16 PDF + 4 DOCX files, 20 uploads including 2 byte-exact duplicates and 2 corrected v2 editions), ground-truth records with per-field evidence quotes, 12 to 15 planted uncertain or contradictory readings, and a 40-question golden RAG set (32 answerable, 8 refusals). See `fixtures/README.md`.

## Reliability model

* Every expensive step is keyed by `workspace:document_version:step:pipeline_version:model_config_hash`. A succeeded `run_steps` row is reused by any later run, so a retry or a re-run never re-parses a document or repeats a paid LLM call whose output already exists.
* Retryable failures (429/5xx/timeouts/transient DB errors) retry at 2 s, 8 s and 30 s. The fourth failure creates a `dead_letters` row; the run stays visible and an admin can click *Retry failed step*.
* Non-retryable failures (corrupt file, invalid structured output after one immediate retry, too many pages) dead-letter immediately.
* A run always ends `completed`, `completed_with_review` or `failed`; a document version always ends `completed`, `completed_with_review`, `failed` or `unsupported`.
* Embedding failure does not fail the document: extraction remains usable and the version is excluded from RAG until the embed step is retried.
* Review writes claim the item with `UPDATE ... WHERE status = 'open'` and check the record version the reviewer saw, so concurrent resolutions are rejected rather than overwritten.

## Deployment

See `docs/deployment.md` for Supabase (Postgres, pgvector, Auth, Storage, RLS), Inngest Cloud and Vercel setup, and `docs/architecture.md` for the data model and flow.
