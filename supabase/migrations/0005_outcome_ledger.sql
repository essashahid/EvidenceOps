-- Idempotent per-run outcomes prevent duplicate deliveries from inflating counters.
create table if not exists public.processing_run_documents (
  processing_run_id uuid not null references public.processing_runs(id) on delete cascade,
  document_version_id uuid not null references public.document_versions(id) on delete cascade,
  outcome text not null check (outcome in ('completed','completed_with_review','failed','unsupported')),
  primary key (processing_run_id, document_version_id)
);
insert into public.processing_run_documents (processing_run_id, document_version_id, outcome)
select distinct on (processing_run_id, document_version_id) processing_run_id, document_version_id, payload_json->>'outcome'
from public.run_events where event_type = 'document.finished' and document_version_id is not null
  and payload_json->>'outcome' in ('completed','completed_with_review','failed','unsupported')
order by processing_run_id, document_version_id, created_at desc
on conflict do nothing;
alter table public.processing_run_documents enable row level security;
