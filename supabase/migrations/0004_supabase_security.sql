-- requires: supabase
-- The server enforces roles; direct API clients get no write access, even if a future
-- permissive policy is added. Never expose password hashes or shared model caches.
create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;
revoke all on function public.is_workspace_member(uuid) from public;
grant execute on function public.is_workspace_member(uuid) to authenticated;

do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
    execute format('revoke all on table public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;
grant select on workspaces, workspace_members, documents, document_versions, chunks, processing_runs, review_items, rag_queries, eval_runs to authenticated;
-- Supabase Auth owns identity; local development retains app_users as its adapter.
alter table workspace_members add constraint membership_auth_user foreign key (user_id) references auth.users(id) on delete cascade;
