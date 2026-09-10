# Deployment runbook

## Current status — 2026-09-10

- Vercel project: `evidenceops`, team `essa-arshads-projects`.
- Git repository connected: `essashahid/EvidenceOps`.
- Framework: Next.js; Node 22; install `pnpm install --frozen-lockfile`; build `pnpm build`.
- Production and preview environments contain the configured drivers, model names, embedding dimensions, demo flags, storage bucket and generated strong demo passwords.
- Supabase CLI is authenticated. Creating a dedicated EvidenceOps project was rejected because the account has reached its free-project limit. No unrelated project was paused, deleted, reused or changed.
- Hosted database/Auth/Storage provisioning is incomplete. OpenAI and Inngest credentials are missing. There is no working hosted deployment URL yet.
- Local production build and synthetic demo work. This does not verify the hosted providers.

## What is needed

Make a Supabase project slot available, or identify a dedicated project authorized for EvidenceOps. For a new project the connected CLI can provision it and retrieve its URL/API keys. An existing project also needs its database connection credentials. Do not reuse an application database containing unrelated tables: these migrations establish application-wide RLS and permissions.

Add the OpenAI key and Inngest event/signing keys to the private `.data/production.env` file. The file is mode 600 and git-ignored; it already contains the generated demo passwords. Do not paste keys into issue comments or commit them.

## Required environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Supabase direct Postgres connection or **session pooler, port 5432**, including password |
| `NEXT_PUBLIC_SUPABASE_URL` | Project API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Auth administration and private Storage |
| `OPENAI_API_KEY` | Server-only structured generation and embeddings |
| `INNGEST_EVENT_KEY` | Dispatch document/evaluation events |
| `INNGEST_SIGNING_KEY` | Authenticate Inngest delivery |
| `AUTH_DRIVER` / `STORAGE_DRIVER` | Both `supabase` |
| `JOB_DRIVER` | `inngest` |
| `LLM_PROVIDER` | `openai` for measured live results; `mock` is an explicit synthetic test mode |
| `PUBLIC_DEMO_MODE` | `true` allows anonymous browsing of the default workspace |
| `DEMO_MUTATIONS_ENABLED` | `false` makes reviewer/viewer demo sessions read-only; authenticated admins may manage it |
| `SUPABASE_STORAGE_BUCKET` | `sources`, private |
| `DEMO_ADMIN_PASSWORD`, `DEMO_REVIEWER_PASSWORD`, `DEMO_VIEWER_PASSWORD` | Unique strong seed passwords; at least 16 characters |

Models: `OPENAI_EXTRACT_MODEL`, `OPENAI_VERIFY_MODEL`, `OPENAI_RAG_MODEL`, `OPENAI_EVAL_MODEL` default to `gpt-5.6-luna`; `OPENAI_EMBED_MODEL=text-embedding-3-small`; `OPENAI_EMBED_DIMENSIONS=768`. Pricing is configurable in `src/lib/config.ts`. The current Luna model supports structured output; see [official model documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna). Recheck pricing before changing providers/models.

Transaction pooling on port 6543 is rejected because pipeline advisory locks need session affinity. Use Supabase's IPv4-compatible session pooler if the workstation cannot reach its direct IPv6 host. Never expose the service-role key in `NEXT_PUBLIC_*` variables.

## Finish deployment

1. Provision/link the dedicated Supabase project and fill the seven missing connection/service values in `.data/production.env`.
2. Run `pnpm deploy:production`. It validates all inputs before changes, applies migrations, creates Supabase Auth users and workspace memberships, ingests and evaluates the demo using hosted Storage/DB and local inline orchestration, synchronizes environment variables, and deploys to Vercel. It stops if seeding/evaluation fails. It never resets the production database.
3. Configure the Supabase Auth site URL and allowed redirects for the deployment domain. Password-based login does not use an OAuth callback, but these settings should match the application.
4. Sync `https://<deployment-domain>/api/inngest` in Inngest Cloud. Expect `process-document`, `retry-document`, and `evaluate-corpus`. Each evaluation case uses a durable `step.run` checkpoint; see [Inngest's step documentation](https://www.inngest.com/docs/reference/typescript/v4/functions/step-run).
5. Test hosted anonymous browsing, admin/reviewer login, a direct signed upload, extraction/verification, a duplicate, a corrected source, human correction, a cited answer, refusal, a failed step retry, a background evaluation and report download. Inspect Inngest and Vercel logs and the database rows. Confirm no service keys are in client bundles.

Sources and reports use private Supabase Storage. The browser sends large source bytes directly to a signed upload URL; the server validates the resulting object before registering it. Vercel's 4.5 MB request limit cannot be raised by the Next server-action body-size setting, so production must use this direct flow. Hosted signed upload behavior is not yet verified.

The Vercel function handling Inngest has `maxDuration=300`. Model requests have explicit timeouts, and pipeline retries are owned by the workflow rather than multiplied by SDK retries. Verification batches persist progress in the database. Larger live workloads may need smaller batches or separate draft jobs after measurement.

## Local checks and limits

`pnpm verify:rls` creates a temporary local PostgreSQL database with minimal Supabase-compatible `auth` and `storage` schemas, applies the real migrations, checks isolation/denied writes/credential protection, then removes the database and any roles it created. This validates SQL policies; it does not substitute for hosted Supabase Auth, Storage or PostgREST testing.

Preview currently has the same known configuration as production. Use separate Supabase/Inngest resources before introducing destructive preview fixtures or real private documents. The public default workspace must contain only material intended for public viewing.

GitHub linkage is configured, but the unfinished deployment has not been represented as live. Production secrets, migrations and provider validation must be finished before publishing a working deployment.
