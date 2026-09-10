# EvidenceOps

Document intelligence with receipts. EvidenceOps turns PDF and DOCX reports into structured records and cited answers, and it refuses to store or say anything it cannot point to in the source.

Every extracted value carries a verbatim quote and a source locator. A second model checks the first without seeing its confidence. Code, not a model, computes the final confidence from five measurable components and decides whether a value is auto-approved, sent to a reviewer, or blocked. Reviewer decisions create new immutable record versions. A golden evaluation suite runs against a committed corpus and fails the build on regression. Every run records its steps, retries, tokens, cost and latency and produces an HTML QA report.

Built for the work that starts after a document-AI prototype "works": making it auditable, correctable, testable and boring to operate.

```
upload ──► parse ──► chunk ──► extract ──► validate ──► verify ──► score & route ──► embed
  │          │                    │            │           │             │              │
  hash,     source blocks       evidence     required,   second       confidence      pgvector +
  dedupe,   with locators       per leaf     enums,      model,       0.30/0.20/      full text
  version   SRC-OPS-2026-       (locator +   dates,      no access    0.25/0.15/
  linkage   004-V2-P03          quote)       amounts,    to extractor 0.10 weights
                                             quote-in-   confidence
                                             source
                                                                      ┌─ auto-approved (>= 0.86)
                                                                      ├─ review (0.65 .. 0.86, partial support)
                                                                      └─ blocked (< 0.65, unsupported, contradiction)
```

## Table of contents

- [What you get](#what-you-get)
- [Measured results](#measured-results)
- [How a document moves through the system](#how-a-document-moves-through-the-system)
- [Confidence and routing](#confidence-and-routing)
- [Reliability model](#reliability-model)
- [Evaluation and regression gate](#evaluation-and-regression-gate)
- [Run it locally](#run-it-locally)
- [Commands](#commands)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [Data model](#data-model)
- [Deploying](#deploying)
- [Limits and non-goals](#limits-and-non-goals)

## What you get

| Screen | What it shows |
| --- | --- |
| `/upload` | Multi-file upload. Each file reports its SHA-256, logical document key, resulting version, and whether it was created, rejected, a duplicate of an existing version, or a new version superseding a prior one. |
| `/documents`, `/documents/[id]/versions/[id]` | Logical documents, their versions, the current record with per-field confidence, routing, verifier verdict and evidence quote; full version history (model / reviewer / reprocess, changed fields, parent); the parsed source with an anchor per locator; the processing steps for that version. |
| `/review`, `/review/[id]` | Queue filtered by status, field, confidence and document. The item screen shows the source context with the exact quote highlighted next to the candidate value, the five confidence components with their weighted contributions, the verifier's verdict and suggested correction, validation messages, and Accept / Edit & Accept / Reject / Needs more source. |
| `/ask` | Questions and first drafts (executive brief, findings summary, recommendation summary) answered only from retrieved chunks. Each claim links to its source locator; refusals are explicit; the retrieved chunks and their vector, lexical and combined scores are shown. |
| `/runs`, `/runs/[id]` | Every processing run: status, current step, documents done/failed, review items, retries, tokens in/out/embedding, cost, p50/p95 step latency, per-step attempts and errors, dead letters with a retry button, the event timeline, and QA reports. |
| `/evals`, `/evals/[id]` | Evaluation runs against the golden suite: each metric against its target, regression checks against the baseline, integrity checks, and per-case results with judge reasons. |

## Measured results

Numbers from the committed baseline (`eval/baselines/mock.json`) for the 20-file fixture corpus, produced with the deterministic mock provider (see [Configuration](#configuration) for what that means and how to get real-model numbers).

| Metric | Target | Measured |
| --- | ---: | ---: |
| Scalar-field exact accuracy (90 fields, 18 versions) | >= 95% | 97.8% |
| List/object extraction micro-F1 | >= 90% | 97.3% |
| Evidence/provenance validity | >= 98% | 99.1% |
| Document classification accuracy | >= 95% | 100% |
| Review recall on planted uncertain/incorrect fields (12) | >= 90% | 100% |
| Review-queue precision (12 of 15 routed items were planted) | >= 75% | 80% |
| Retrieval Recall@5 (32 questions) | >= 90% | 98.4% |
| Citation precision (quote found verbatim in cited chunk) | >= 95% | 100% |
| Evidence-supported answer rate | >= 95% | 100% |
| Refusal accuracy on 8 unanswerable questions | >= 95% | 100% |
| Semantic answer score (mean) | >= 0.90 | 1.00 |
| Duplicate uploads detected / corrected versions linked | 2 / 2 | 2 / 2 |
| Duplicate records created by re-runs | 0 | 0 |

The six per-document cases that fail inside that run are the documents carrying planted contradictions; that is the suite doing its job. The two extraction misses are planted ambiguous dates the extractor is expected to get wrong and the verifier is expected to catch.

Test suites: 31 unit tests, 17 integration tests against a real Postgres, 7 Playwright flows.

## How a document moves through the system

1. **Upload** (`src/lib/pipeline/ingest.ts`). Type and size are checked before anything is written (`.pdf`/`.docx`, 10 MB, 50 pages). The file is hashed. An identical hash in the workspace is reported as a duplicate and not processed. A new hash for an existing logical key (`OPS-2026-004` from `OPS-2026-004-v2-corrected.pdf`) becomes version N+1 with `supersedes_version_id` set and the old version marked not current. Bytes are stored before the version row exists, so no version can point at a missing file.
2. **Parse** (`parse.ts`). PDF pages (pdfjs) or DOCX paragraphs (mammoth) become `source_blocks` with raw text, normalized text, character offsets and an immutable locator such as `SRC-OPS-2026-004-V2-P03` or `SRC-OPS-2026-009-V1-PARA17`. Fewer than 100 characters on more than half the pages means the file is scanned; it is marked `unsupported_scanned_document` and dead-lettered to the manual queue. No OCR.
3. **Chunk** (`chunk.ts`). Sentence-aligned chunks of about 800 tokens with 120 tokens of overlap, never crossing documents, each keeping its start and end block.
4. **Extract** (`llm/openai.ts`, `llm/prompts.ts`). One structured call (OpenAI Responses API, strict JSON schema from Zod). Every leaf of the record (`report_title`, `report_number`, `issuing_organization`, `publication_date`, `document_type`, `subject_entities[]`, `key_findings[]`, `recommendations[]`, `monetary_amounts[]`) carries `{locator, quote}`. A business value without provenance cannot be represented, let alone stored.
5. **Validate** (`validate.ts`). Deterministic checks: required fields, enum membership, ISO dates in a plausible range, positive and plausible amounts, list limits, duplicate list items, locator exists, quote occurs verbatim in the cited block (with offsets recorded for highlighting).
6. **Verify** (`process-document.ts`). Batches of up to 12 fields go to an independent model call with the candidate value, the cited quote, the entire cited block and the field definition. It returns supported / partially supported / unsupported, a corrected value, agreement (`same`, `equivalent_formatting`, `different`), a contradiction flag and evidence specificity. It never sees the extractor's confidence.
7. **Score and route** (`confidence.ts`). See below. Writes `record_versions` v1, `field_values`, `field_evidence` and `review_items`.
8. **Embed**. `text-embedding-3-small` at 768 dimensions, cached by `sha256(text | model | dims)` so identical chunks are never embedded twice.
9. **Review** (`src/lib/review/`). Accept, Edit & Accept and Reject each create record version N+1 (`created_by_type = reviewer`, parent link, changed fields, all field states copied), leaving the model's version intact. Needs more source flags the item without creating a version.
10. **Ask** (`src/lib/rag/`). Hybrid retrieval (75% cosine similarity on pgvector, 25% PostgreSQL `ts_rank_cd`, both normalized over the candidate pool), top 8, current versions only unless `include superseded` is set. The model answers from those chunks only. Every citation is then re-checked in code: the quote must occur verbatim in the cited chunk, and the precise source block is resolved. Claims with no valid citation are marked unsupported; an answer whose claims are all unsupported is downgraded to a refusal.

## Confidence and routing

```
confidence = 0.30 * evidence_exact_match      1 if the normalized quote occurs in the cited block
           + 0.20 * deterministic_validation  1 clean, 0.5 warnings only, 0 any error
           + 0.25 * verifier_support          supported 1, partially 0.5, unsupported 0
           + 0.15 * cross_pass_agreement      same 1, equivalent formatting 0.75, different 0
           + 0.10 * evidence_specificity      direct 1, contextual 0.75, weak 0.4, none 0
```

| Outcome | Condition |
| --- | --- |
| `auto_approved` | confidence >= 0.86 and no contradiction |
| `review` | 0.65 <= confidence < 0.86, or the verifier says partially supported |
| `blocked` | confidence < 0.65, or unsupported, or contradiction, or the cited locator does not exist, or a required field is empty |

Worked example from the fixtures: the Northstar summary says "$1.2 million", the appendix says the corrected figure is $1.25 million. The extractor cites the summary. Validation passes, the quote matches, the verifier answers partially supported with a corrected value of 1,250,000 and flags a contradiction. Confidence is 0.70 and the field is blocked with the reason and the verifier's suggestion shown to the reviewer.

## Reliability model

- **Idempotent steps.** Each durable step is keyed by `workspace:document_version:step:pipeline_version:model_config_hash` in `run_steps`. A succeeded row is reused by any later run of that version, so a retry, a manual re-run, or a second run of the same batch never re-parses a document and never repeats a paid model call whose output exists. The integration suite asserts this by counting `llm_calls`.
- **Retries.** Retryable failures (429, 5xx, timeouts, transient database errors) retry after 2 s, 8 s and 30 s. The fourth failure writes a `dead_letters` row; the run stays visible and an admin can retry the step from the run page. Non-retryable failures (corrupt file, structured output still invalid after one immediate retry, too many pages) dead-letter immediately.
- **Terminal states only.** A run ends `completed`, `completed_with_review` or `failed`. A version ends `completed`, `completed_with_review`, `failed` or `unsupported`. Nothing stays "running" silently.
- **Embedding failure is isolated.** The record stays usable; the version is excluded from retrieval until the embed step is retried.
- **Review concurrency.** Items are claimed with `UPDATE ... WHERE status = 'open'` and the record version the reviewer looked at must still be current; a second write is rejected, not merged.
- **Two runners, one contract.** Inngest functions (`src/inngest/functions.ts`) and the inline runner (`src/lib/pipeline/orchestrate.ts`) call the same step functions. `pnpm process:one` processes a single version synchronously for debugging; `--fail-step extract:2` injects two failures to watch the retry and resume behaviour.
- **Model config hash.** Provider, model names, prompt versions and pipeline version are hashed. Change any of them and reprocessing creates new extraction runs instead of reusing cached outputs.

## Evaluation and regression gate

`pnpm eval` seeds 148 cases from the fixtures, ingests the corpus (idempotent), runs every case, aggregates, compares with the baseline, writes the QA report and exits non-zero on failure.

| Case type | Count | What it checks |
| --- | ---: | --- |
| `extraction` | 18 | Scalar exact match and list micro-F1 against the ground-truth record |
| `provenance` | 18 | Every field's evidence resolves to a real block and the quote matches verbatim |
| `classification` | 18 | `document_type` exact |
| `review_routing` | 18 | Every planted non-supported reading is routed; every field under 0.86 has a review item |
| `retrieval` | 32 | Expected documents present in the top 5 |
| `answer` | 32 | Citation precision, all claims supported, judge score against reference and expected facts |
| `refusal` | 8 | Unanswerable questions are refused |
| `duplicate`, `version` | 2 + 2 | Byte-identical uploads skipped with an event; corrected editions linked and current |

Hard regression rules against the baseline: extraction exact accuracy drop > 2 pp, evidence validity drop > 1 pp, review recall drop > 5 pp, Recall@5 drop > 3 pp, refusal accuracy < 95%, semantic score < 0.90, or any duplicate/version case failing. Baselines are per provider in `eval/baselines/<provider>.json`; `pnpm eval --set-baseline` promotes a run.

The QA report (`src/lib/report/qa-report.ts`) is a self-contained HTML file with corpus counts, extraction metrics, confidence distribution, provenance statistics, review statistics, RAG evaluation, duplicate and version events, retries and failures, cost, latency and regression status. It is served and downloadable from each run page.

## Run it locally

Requirements: Node 22, pnpm 10, PostgreSQL 15+ with the `vector` extension (Homebrew: `brew install postgresql@17 pgvector`).

```bash
git clone https://github.com/essashahid/EvidenceOps.git && cd EvidenceOps
pnpm install
cp .env.example .env                     # defaults: mock LLM, local auth, local storage, inline jobs

createdb evidenceops && createdb evidenceops_test
psql evidenceops      -c 'create extension if not exists vector'
psql evidenceops_test -c 'create extension if not exists vector'

pnpm db:migrate
pnpm db:seed                             # workspace, demo users, eval cases
pnpm ingest:corpus                       # upload + process the 20 fixture files
pnpm dev                                 # http://localhost:3000
```

Sign in as `admin@evidenceops.local` / `evidenceops-admin` (admin) or `reviewer@evidenceops.local` / `evidenceops-reviewer` (reviewer). Then open `/review` to resolve a planted contradiction, `/ask` to ask "What is the revised program cost in the Northstar operational review?", and `/runs` to see the ingest run and generate a QA report.

To use real models, set `LLM_PROVIDER=openai` and `OPENAI_API_KEY` in `.env`, then reset so cached mock outputs are not reused:

```bash
pnpm db:reset && pnpm db:seed && rm -rf .data/storage
pnpm eval --set-baseline
```

## Commands

```bash
pnpm dev / build / start
pnpm lint                    # eslint
pnpm typecheck               # tsc --noEmit
pnpm test                    # unit (vitest): text, chunking, validation, confidence, metrics, regression, mock provider
pnpm test:integration        # vitest against TEST_DATABASE_URL: pipeline, failures, review, RAG
pnpm test:e2e                # playwright, boots its own dev server on :3100 against the test database
pnpm eval [--set-baseline] [--no-ingest] [--no-cache] [--no-strict]
pnpm db:migrate | db:seed | db:reset
pnpm fixtures:generate       # re-render the corpus and verify every evidence quote
pnpm ingest:corpus [--no-wait]
pnpm process:one OPS-2026-004@1 [--fail-step verify:4]
pnpm inngest:dev             # local Inngest dev server (with JOB_DRIVER=inngest)
```

The definition of done for this repository is that `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `eval` and `build` all pass. They do.

## Configuration

| Variable | Values | Notes |
| --- | --- | --- |
| `LLM_PROVIDER` | `openai`, `mock` | `mock` is a deterministic, fixture-backed provider: extraction comes from the committed ground truth including the planted uncertain readings, verification is rule based, embeddings are hashed bag-of-words vectors, answers are extractive, and known golden questions decide answerability. It exists so the whole system, tests and the eval harness run offline and reproducibly. It is never a fallback for the real provider. |
| `OPENAI_*_MODEL` | defaults `gpt-5.6-luna`, embeddings `text-embedding-3-small` @ 768 | Prices for cost estimates are in `src/lib/config.ts`. |
| `JOB_DRIVER` | `inline`, `inngest` | `inline` processes in the request (development and tests). |
| `AUTH_DRIVER` | `local`, `supabase` | `local` is email/password in `app_users` with an HMAC-signed cookie; `supabase` uses Supabase Auth and mirrors users into `app_users`. |
| `STORAGE_DRIVER` | `local`, `supabase` | Source files and QA reports. |
| `DATABASE_URL`, `TEST_DATABASE_URL` | Postgres URLs | Tests and e2e always use the test database and reset it. |

Full list with comments in `.env.example`.

## Repository layout

```
src/lib/pipeline/    ingest, parse, chunk, validate, confidence, steps-runner (idempotency, dead letters),
                     process-document (the seven steps), orchestrate (inline runner with retry schedule)
src/lib/llm/         provider interface, OpenAI Responses implementation, mock provider, prompts
src/lib/schema/      the extraction record schema, field paths, evidence types
src/lib/review/      resolve actions (immutable versions, optimistic concurrency), queue queries
src/lib/rag/         hybrid retrieval, evidence-bound answering with citation validation
src/lib/eval/        golden cases, metrics, regression rules, baselines, corpus ingestion, runner
src/lib/report/      QA report generator
src/inngest/         Inngest client and durable functions
src/app/             Next.js App Router pages, server actions, report route
supabase/migrations/ 0001_init.sql (schema), 0002_supabase_rls.sql (RLS + bucket; applied only on Supabase)
fixtures/            ground truth, manifest, generator, corpus, extras, 40 golden questions
tests/               unit, integration, e2e
eval/baselines/      committed regression baselines per provider
docs/                architecture.md, deployment.md
```

## Data model

Twenty-six tables in `supabase/migrations/0001_init.sql`. The ones that carry the guarantees:

- `documents` / `document_versions`: logical identity vs. immutable content; `content_hash` unique per workspace, `supersedes_version_id`, `is_current`, `parse_status`, `processing_status`.
- `source_blocks`: page or paragraph text with locator and offsets.
- `chunks` + `embedding_cache`: text, block span, `vector(768)`, generated `tsvector`.
- `processing_runs`, `run_steps` (unique `idempotency_key`), `run_events`, `dead_letters`, `llm_calls`.
- `extraction_runs`: raw extractor output and verifier output per model configuration.
- `record_versions` → `field_values` → `field_evidence`: payload per version; per-field confidence, five components, routing, verifier verdict, validation messages; quote, offsets, locator, exact-match flag.
- `review_items`, `review_actions`: queue and audit trail with old value, new value, reviewer, comment, resulting version.
- `rag_queries`, `rag_answers`, `answer_citations`: question, embedding, retrieved set with scores, answer, sufficiency, citations with resolved block.
- `eval_cases`, `eval_runs`, `eval_results`, `qa_reports`.

## Deploying

Supabase (Postgres + pgvector + Auth + Storage, RLS policies in the second migration), Inngest Cloud for durable execution, Vercel for the app. Step by step in [`docs/deployment.md`](docs/deployment.md).

## Limits and non-goals

- No OCR. Scanned or image-only PDFs are detected and routed to the manual queue.
- One extraction schema (operational reports). Adding another is a new Zod schema, field definitions and fixtures; the pipeline, review, versioning and eval machinery are schema-agnostic by construction but the demo ships one.
- Single workspace in the demo; the data model and queries are workspace-scoped throughout.
- The committed baseline is from the mock provider. Real-model numbers require an OpenAI key and will differ.
