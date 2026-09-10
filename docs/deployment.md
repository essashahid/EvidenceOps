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

Inngest Marketplace activation is complete. The Production event/signing keys are installed, `/api/inngest` is synced, six functions are registered (including failure handlers), and a real document-processing event completed through the hosted callback and Neon.

To activate OpenAI, add `OPENAI_API_KEY` privately, set `LLM_PROVIDER=openai`, and run `pnpm deploy:production`. The command validates credentials, migrates, seeds/evaluates, synchronizes Vercel variables and deploys. It never resets production data. Re-run live processing and evaluation after changing providers.

The public synthetic demo remains read-only. Signed-in authorized workflows can use the configured Inngest background processor. Live model calls remain disabled while `LLM_PROVIDER=mock`.

## Storage and authentication

Upload authorization issues short-lived Blob client tokens restricted to one random workspace/user path, a maximum size, allowed file types, and no overwrite. Browsers send source bytes directly to Blob, avoiding Vercel's request-body limit. The server checks ownership and actual size before ingestion. Stored sources and QA reports remain private and are served through workspace-scoped application routes.

Database passwords use scrypt. Session cookies are signed, HTTP-only, secure in production, and SameSite=Lax. Login attempts are limited by a shared database counter. Production credentials are never shown on the login page.

## Verification

Run lint, typecheck, unit tests, integration tests, production build, then browser checks against the hosted URL. Verify desktop/mobile routes, anonymous mutation restrictions, authenticated login, private source/report downloads, Inngest processing and no browser errors. Full OpenAI provider verification additionally requires live model processing and evaluation.

Preview/development currently share the synthetic production database and store. Provision isolated resources before testing destructive changes or adding private documents. Public demo mode must only be used with material intended for public viewing.
