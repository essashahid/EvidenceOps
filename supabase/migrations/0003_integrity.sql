-- Additive upgrade for checkouts that applied the earlier schema.
alter table field_values add column if not exists verifier_reason text;
alter table field_values add column if not exists ambiguity text;
create table if not exists mutation_limits (
  key text primary key,
  window_start timestamptz not null,
  hits integer not null
);
alter table mutation_limits enable row level security;
create unique index if not exists one_current_source on document_versions(document_id) where is_current;
create unique index if not exists one_current_record on record_versions(document_version_id) where is_current;
