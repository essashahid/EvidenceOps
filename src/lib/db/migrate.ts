import fs from "node:fs";
import path from "node:path";
import type postgres from "postgres";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

/** Apply pending SQL migrations from supabase/migrations in filename order. */
export async function migrate(sql: postgres.Sql, opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const hasSupabase = (await sql<{ n: string }[]>`select nspname as n from pg_namespace where nspname = 'auth'`).length > 0;
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (/^--\s*requires:\s*supabase/m.test(body) && !hasSupabase) {
      log(`skip ${file} (requires supabase auth schema)`);
      continue;
    }
    log(`apply ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
  }
}

/** Drop everything in public and re-apply migrations. Used for tests only. */
export async function resetDatabase(sql: postgres.Sql) {
  await sql.unsafe(`drop schema public cascade; create schema public; create extension if not exists vector;`);
  await migrate(sql);
}
