# Implementation and design audit — 2026-09-10

## Outcome

The workbench is implemented, seeded and verified locally using the deterministic mock provider. The optimized production server runs at `http://localhost:3010`. The prior agent's implementation was repaired and extended rather than discarded. Earlier local databases were preserved; the final demonstration uses `evidenceops_verified`.

The demo is deployed at https://evidenceops.vercel.app using dedicated Neon PostgreSQL, database-backed signed sessions, private Vercel Blob and Inngest. All three Vercel environments have the database, authentication, storage and demo configuration. Hosted desktop/mobile browsing, admin sign-in, private client-token uploads and source downloads pass. The Production Inngest app is synced with six functions; a real document event reached the Vercel callback and completed in Neon with one document completed and zero failures. OpenAI credentials are still required for live-model quality verification; the demo explicitly identifies its mock provider.

## Findings and fixes

| Finding | Implemented correction | Evidence |
| --- | --- | --- |
| Extraction schema/UI/tests referenced incompatible old field paths | Unified scalar wrappers and list-item provenance, enums, confidence fields and view rendering | Typecheck, unit, integration, E2E |
| Public demo depended on authentication; action authorization was incomplete | Anonymous synthetic workspace reads, shared server-side role checks and mutation limits | Access unit tests, browser read-only checks |
| Supabase proxy only checked cookies; new identities could receive automatic membership | Validated/refreshed Supabase sessions and required explicit membership | Code audit; hosted session behavior pending credentials |
| RLS covered only a subset of tables and exposed excessive direct privileges | Enabled RLS, revoked client writes/credential reads, scoped allowed reads and linked Auth identities | Temporary PostgreSQL policy verification |
| Concurrent duplicate uploads could race; temporary filenames could collide | Transaction advisory lock plus a repeated hash check; UUID temporary filenames | Concurrent upload/delivery integration test |
| Duplicate job completion inflated run counters | Per-run document outcome ledger and transactional count recomputation | Concurrent delivery and retry tests |
| Successful work could repeat after failure/reprocessing | Stable parse/chunk keys, step advisory locks, persisted extraction/verification batches, record insertion guard | Retry/resumability and idempotency tests |
| Needs-source mutated historical data or could not be resolved later | Preserved original fields, kept item unresolved and supported later resolution | Integration test asserts snapshot equality and subsequent rejection |
| Concurrent/stale reviewer changes could overwrite records | Document lock, current-record check, immutable snapshots and superseded pending review state | Reviewer conflict tests and E2E edit-and-accept |
| Large uploads exceeded Vercel's function request limit | Scoped private Blob client-token upload followed by ownership and byte validation | Real client-token upload/private read passed; anonymous Blob access returns 403 |
| Evaluations ran in a long web request | Durable Inngest case checkpoints, replayable metric contributions and failure reporting | Replay integration test: identical metrics, no new calls or duplicate results |
| Failed results could become the baseline | Gate baseline promotion on all success targets and regression rules; require corpus compatibility | Evaluation/replay verification |
| A matching citation ID was treated as proof of claim support | Independent support verification, rejection of uncited answer tails, full preceding claim validation, source-block resolution and evidence snapshots | Citation tests, RAG integration, browser citation links |
| Costs omitted verification/query embeddings and structured-output retries | Included these usages; preserved usage across malformed JSON retry; explicit unknown-price failure | MSW provider tests and measured evaluation output |
| DOCX files changed hashes between generator runs | Fixed ZIP and core-property timestamps | Two generated manifests/sets compared; identical DOCX hashes |
| QA regeneration overwrote earlier report objects | Unique report-object directories with the required report filename; escaped HTML and restrictive response policy | Generated report artifacts and browser report route |
| Tables/navigation lacked useful filters, charts and responsive polish | Active navigation, shadcn-style controls, TanStack sorting/filtering, Recharts quality panels, focus states, review/run filters and source downloads | Desktop/mobile screenshot audit |
| Chart labels overlapped and animation hid bars in initial captures | Horizontal category charts and deterministic non-animated marks | Updated evaluation screenshots |
| Production build rejected re-exported route configuration | Declared `/rag` segment configuration locally | Optimized build passed |

## Design verification

Reviewed dashboard, library, source/provenance, review detail, cited answer, evaluation detail, run detail and HTML QA report at 1440×1000. Reviewed the seven main application routes at 390×844. The audit checks HTTP responses, uncaught page errors, document-width overflow, public upload controls and public answer controls. Tables intentionally scroll horizontally inside their containers on narrow screens.

Visual improvements include a restrained teal/slate palette, consistent card/table borders, visible keyboard focus, a skip link, active navigation, readable evidence highlights and distinct pending/failed/review states. Evaluation charts now separate baseline comparison, confidence counts and failure categories. Screenshots are in `docs/screenshots/`; automated checks are in `scripts/visual-audit.ts`. This is a practical product/design review, not a formal accessibility certification.

## Verification results

| Check | Result |
| --- | --- |
| `pnpm lint` | Passed; no lint errors/warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 43 passed across 10 files |
| `pnpm test:integration` | 20 passed across 5 files |
| `pnpm test:e2e` | 7 passed in Chromium; includes actual edit-and-accept |
| `pnpm eval --no-ingest --no-cache` | EVAL PASSED; 11/11 aggregate targets, 10/10 regression rules |
| `pnpm build` | Optimized Next.js production build passed |
| `pnpm verify:rls` | Membership isolation and denied anonymous/credential reads/client writes passed |
| Production-server browser audit | 8 desktop and 7 mobile routes; 200 responses, no uncaught errors or page-wide overflow; anonymous upload/Ask disabled |
| Fixture reproducibility | 20 files, 16 PDF/4 DOCX, 16 documents, 18 editions, 57 PDF pages, 40 golden questions; repeat DOCX hashes equal |

The last full E2E run completed in 1.1 minutes. Fixture regeneration, tests and verification use isolated local data. The local RLS script uses a minimal Supabase-compatible Auth/Storage schema scaffold; actual hosted services remain untested.

## Measured quality and cost

See [evaluation-results.json](evaluation-results.json) for the uncached run `52531eab-d7e2-48ec-8d41-8d62161f9015` and [the standalone HTML QA report](qa-report.html).

- Scalar exact accuracy 96.67%; list/object F1 97.01%; classification 100%; provenance validity 99.68%.
- Review recall 100%; review precision 100%; retrieval Recall@5 98.33%.
- Citation precision 100%; evidence-supported answers 100%; refusal accuracy 100%; semantic score 100%.
- 141/146 individual cases passed. Three extraction cases and one provenance case expose planted errors; one cross-document retrieval case misses one expected source at top five. All remain visible.
- Duplicate and corrected-version checks passed 2/2 each; no duplicate model records and no below-threshold auto-approvals.
- Failure injection produced two verifier failures, then succeeded on attempt three. Parsing and extraction ran once.
- Actual OpenAI spend: **$0**, because the provider was mock. Mock usage estimates: 89,350 input / 4,436 output tokens; p50 2 ms and p95 34 ms per evaluation case. These timings and scores are not a live-model benchmark.

## Delivery and remaining dependencies

The Vercel project is connected to `essashahid/EvidenceOps`, configured for Node 22 and pnpm, with known production/preview variables and generated strong demo passwords. The private `.data/production.env` file contains these passwords and placeholders for missing credentials; it is ignored by git and mode 600.

Inngest Marketplace activation, production sync and background delivery are complete. Provide an OpenAI API key privately and switch `LLM_PROVIDER` to `openai` to run live-model processing and evaluation. See [deployment.md](deployment.md).

No OCR, scanned-document interpretation, image extraction, complex table reconstruction, legal/compliance function or tariff/HTS logic is implemented. The synthetic mock intentionally reads truth/golden fixtures. Page-boundary fragments can appear in extractive mock answers. Real model and operational limits must be measured after credentials are supplied.

## Neon/Vercel verification update

49 unit tests, 20 integration tests, lint, typecheck and production build pass. Hosted browser checks cover eight routes at both 1440px and 390px: HTTP 200, no page errors, no horizontal overflow, and successful admin sign-in. A short-lived Blob token successfully uploads a private test object; anonymous access is denied (403), authenticated bytes match, and the test object is removed. A source downloaded through the application matches its stored SHA-256 and has private/no-store and nosniff headers. A production Inngest event completed through the hosted callback and persisted its successful outcome to Neon. Live OpenAI behavior remains unverified.
