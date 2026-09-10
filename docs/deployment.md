# Deployment: Supabase + Inngest + Vercel

## 1. Supabase

1. Create a project. In the SQL editor run `create extension if not exists vector;` (or enable *vector* under Database > Extensions).
2. Apply migrations with the Supabase CLI (`supabase link --project-ref <ref>` then `supabase db push`) or run `DATABASE_URL=<pooler connection string> pnpm db:migrate`. The second migration (`0002_supabase_rls.sql`) only applies when the `auth` schema exists; it enables row level security for direct PostgREST access and creates the private `sources` bucket.
3. Auth: enable Email provider. Create the first users in Authentication > Users; on their first sign-in the app mirrors them into `app_users` and adds them to the `default` workspace as `viewer`. Promote roles in `workspace_members` (`admin`, `reviewer`, `viewer`).
4. Storage: the `sources` bucket is private; the server uses the service role key.

Environment variables for production:

```
DATABASE_URL=postgres://...            # Supabase pooler (transaction mode is fine; prepare=false is set)
AUTH_DRIVER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
STORAGE_DRIVER=supabase
SUPABASE_STORAGE_BUCKET=sources
```

Failure behaviour: if Supabase is unavailable no processing continues; Inngest retries the database-dependent step. There is no local shadow database in production.

## 2. Inngest

1. Create an Inngest Cloud app (Hobby tier is sufficient for the demo volume).
2. Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in Vercel, plus `JOB_DRIVER=inngest`.
3. After the first deploy, sync the app from the Inngest dashboard using `https://<your-domain>/api/inngest`. The functions `process-document` and `retry-document` appear with 3 retries (2 s, 8 s, 30 s via `RetryAfterError`) and concurrency 4.

## 3. OpenAI

```
LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_EXTRACTOR_MODEL=gpt-5.6-luna
OPENAI_VERIFIER_MODEL=gpt-5.6-luna
OPENAI_ANSWER_MODEL=gpt-5.6-luna
OPENAI_JUDGE_MODEL=gpt-5.6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=768
```

Changing any model or prompt version changes the model config hash, so reprocessing creates new extraction runs instead of reusing cached step outputs.

## 4. Vercel

1. Import the repository; framework Next.js; install command `pnpm install`; build `pnpm build`.
2. Add the environment variables above and `AUTH_SECRET` (any long random string; used only by the local auth driver but required by env parsing).
3. Server actions accept uploads up to 12 MB (`next.config.ts`); the product limit is 10 MB per file and 50 pages.
4. Deploy, then sync Inngest (step 2.3) and run `pnpm ingest:corpus` / `pnpm eval` locally against the production `DATABASE_URL` if you want the demo corpus and a baseline in place.

## 5. Local verification of the production drivers

You can point a local checkout at the hosted Supabase project (`AUTH_DRIVER=supabase`, `STORAGE_DRIVER=supabase`) while keeping `JOB_DRIVER=inline` to verify auth and storage before enabling Inngest.
