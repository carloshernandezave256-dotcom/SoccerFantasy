begin;

alter table public.draft_queue
  drop constraint if exists draft_queue_priority_check;

alter table public.draft_queue
  add constraint draft_queue_priority_check
  check (priority >= 1 and priority <= 100);

commit;
