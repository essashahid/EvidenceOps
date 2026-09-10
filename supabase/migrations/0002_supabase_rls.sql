-- requires: supabase
-- Row level security for direct Supabase client access (PostgREST). The application server
-- uses the service connection and enforces workspace membership in code; these policies make
-- workspace data unreadable through the anon/authenticated API roles unless the caller is a member.
create or replace function public.is_workspace_member(ws uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = auth.uid());
$$;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table documents enable row level security;
alter table document_versions enable row level security;
alter table chunks enable row level security;
alter table processing_runs enable row level security;
alter table review_items enable row level security;
alter table rag_queries enable row level security;
alter table eval_runs enable row level security;

create policy ws_read on workspaces for select using (public.is_workspace_member(id));
create policy wm_read on workspace_members for select using (public.is_workspace_member(workspace_id));
create policy doc_read on documents for select using (public.is_workspace_member(workspace_id));
create policy dv_read on document_versions for select using (public.is_workspace_member(workspace_id));
create policy chunk_read on chunks for select using (public.is_workspace_member(workspace_id));
create policy run_read on processing_runs for select using (public.is_workspace_member(workspace_id));
create policy review_read on review_items for select using (public.is_workspace_member(workspace_id));
create policy rag_read on rag_queries for select using (public.is_workspace_member(workspace_id));
create policy eval_read on eval_runs for select using (public.is_workspace_member(workspace_id));

-- Private storage buckets used by STORAGE_DRIVER=supabase (source files and generated QA reports).
insert into storage.buckets (id, name, public) values ('sources', 'sources', false) on conflict (id) do nothing;
