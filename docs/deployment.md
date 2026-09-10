# Deployment runbook

## Hosted architecture

EvidenceOps uses a dedicated Neon PostgreSQL 17 project (`purple-mud-53117871`, US East), database-backed signed sessions, and private Vercel Blob storage (`evidenceops-sources`, iad1). The Vercel project is `essa-arshads-projects/evidenceops`, linked to `essashahid/EvidenceOps`. Supabase is optional legacy support and is not required by this deployment.

Use a **direct Neon connection**, not a `-pooler` hostname: processing steps use session advisory locks. Migrations skip Supabase-specific policies when the Supabase auth schema is absent. Database credentials are server-only; application queries enforce workspace membership. No database API is exposed to browsers.

## Environment

Production, preview and development configuration lives in Vercel. A private, ignored `.data/production.env` holds provisioning credentials locally. Never commit it or copy secrets into chat.

| Variable | Value or purpose |
| --- | --- |
| DATABASE_URL | Direct Neon PostgreSQL URL with TLS |
| AUTH_DRIVER | database |
| AUTH_SECRET | Random server-only session signing secret, at least 48 characters |
| STORAGE_DRIVER | blob |
| BLOB_READ_WRITE_TOKEN | Private store credential, installed by Vercel store linkage |
| JOB_DRIVER | inngest |
| INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY | Required before background mutations are enabled |
| LLM_PROVIDER | mock for the labeled synthetic demo; openai for live processing |
| OPENAI_API_KEY | Required for the openai provider |
| PUBLIC_DEMO_MODE | true for public browsing of synthetic sources only |
| DEMO_MUTATIONS_ENABLED | false; reviewers/viewers remain read-only |
| DEMO_ADMIN_PASSWORD / DEMO_REVIEWER_PASSWORD / DEMO_VIEWER_PASSWORD | Generated strong account passwords in the private environment file |

Model settings use gpt-5.6-luna and text-embedding-3-small with 768 dimensions. Changing models requires reprocessing and re-evaluation; full seeding detects stale model configurations and reprocesses them, and the evaluator rejects mismatched extraction configurations. Mock scores are not evidence of live model quality.

## Provider activation

1. Accept the Inngest free-plan terms in the Vercel Marketplace, then install `inngest/account` into this project. The CLI requires interactive terms acceptance by the account owner.
2. Pull the resulting environment into a private temporary file and merge event/signing keys into `.data/production.env`. Do not overwrite local development configuration.
3. Add OPENAI_API_KEY privately, set LLM_PROVIDER=openai when ready to run the live evaluation, and sync all target environments.
4. Sync the deployed `/api/inngest` endpoint. Expect process-document, retry-document, and evaluate-corpus. Exercise upload, retry, and evaluation through the actual service.
5. Run `pnpm deploy:production` for a fully provisioned live deployment. It validates credentials, migrates, seeds/evaluates, syncs environments and deploys. It never resets production data.

The read-only demo can deploy while Inngest credentials are absent. Job mutations are explicitly rejected before creating uploads or runs; signed-in users see a setup notice. This is not a fully enabled live processing deployment.

## Storage and authentication

Upload authorization issues short-lived Blob client tokens restricted to one random workspace/user path, a maximum size, allowed file types, and no overwrite. Browsers send source bytes directly to Blob, avoiding Vercel's request-body limit. The server checks ownership and actual size before ingestion. Stored sources and QA reports remain private and are served through workspace-scoped application routes.

Database passwords use scrypt. Session cookies are signed, HTTP-only, secure in production, and SameSite=Lax. Login attempts are limited by a shared database counter. Production credentials are never shown on the login page.

## Verification

Run lint, typecheck, unit tests, integration tests, production build, then browser checks against the hosted URL. Verify desktop/mobile routes, anonymous mutation restrictions, authenticated login, private source/report downloads, and no browser errors. Full provider verification additionally requires actual Inngest processing and live OpenAI evaluations.

Preview/development currently share the synthetic production database and store. Provision isolated resources before testing destructive changes or adding private documents. Public demo mode must only be used with material intended for public viewing.
