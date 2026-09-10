import postgres from "postgres";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { migrate } from "@/lib/db/migrate";

// Exercise the real migration policies locally with a minimal Supabase auth/storage scaffold.
// The temporary database is created and removed by this script; no application data is reset.
async function main() {
const admin = postgres("postgres://localhost:5432/postgres", { max: 1, onnotice: () => {} });
const database = `evidenceops_rls_${Date.now()}`;
const createdRoles: string[] = [];
let connection: ReturnType<typeof postgres> | null = null;
try {
  for (const role of ["anon", "authenticated"]) {
    const rows = await admin`select 1 from pg_roles where rolname = ${role}`;
    if (!rows.length) { await admin.unsafe(`create role ${role} nologin`); createdRoles.push(role); }
  }
  await admin.unsafe(`create database ${database}`);
  connection = postgres(`postgres://localhost:5432/${database}`, { max: 1, onnotice: () => {} });
  const sql = connection;
  await sql.unsafe(`create schema auth; create schema storage;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    grant usage on schema public, auth to authenticated, anon;`);
  await migrate(sql);
  const user = randomUUID(), first = randomUUID(), second = randomUUID();
  await sql`insert into auth.users values (${user})`;
  await sql`insert into app_users (id, email, display_name) values (${user}, 'policy@example.test', 'Policy test')`;
  await sql`insert into workspaces (id, slug, name) values (${first}, 'first', 'First'), (${second}, 'second', 'Second')`;
  await sql`insert into workspace_members (workspace_id, user_id, role) values (${first}, ${user}, 'viewer')`;
  await sql.begin(async tx => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${user}, true)`;
    const rows = await tx`select id from workspaces`;
    assert.deepEqual(rows.map(r => r.id), [first]);
  });
  await assert.rejects(() => sql.begin(async tx => { await tx.unsafe("set local role authenticated"); await tx`select * from app_users`; }), /permission denied/);
  await assert.rejects(() => sql.begin(async tx => { await tx.unsafe("set local role anon"); await tx`select * from documents`; }), /permission denied/);
  await assert.rejects(() => sql.begin(async tx => { await tx.unsafe("set local role authenticated"); await tx`insert into workspaces (slug, name) values ('forbidden', 'Forbidden')`; }), /permission denied/);
  const unprotected = await sql`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`;
  assert.equal(unprotected.length, 0);
  console.log("RLS PASS: every public table protected; membership isolates workspaces; anonymous reads, credential reads and authenticated writes denied.");
  console.log("Scope: local PostgreSQL policies with a Supabase schema scaffold. Hosted Auth, Storage and API verification is still required.");
} finally {
  await connection?.end();
  await admin.unsafe(`drop database if exists ${database}`);
  for (const role of createdRoles) await admin.unsafe(`drop role ${role}`);
  await admin.end();
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
