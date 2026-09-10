alter table public.review_items drop constraint if exists review_items_status_check;
alter table public.review_items add constraint review_items_status_check check (status in ('open','resolved','rejected','needs_source','superseded'));
