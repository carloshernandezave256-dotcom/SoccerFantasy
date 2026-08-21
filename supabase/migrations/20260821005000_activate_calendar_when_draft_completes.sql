-- Draft completion is the single activation point for the league's selected
-- real-world calendar. This keeps Home, Matchup, transactions, and scoring on
-- the same gameweek without requiring a commissioner or developer refresh.
create or replace function private.activate_calendar_after_draft_complete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'complete'
    and old.status is distinct from new.status
  then
    perform private.refresh_league_calendar(new.league_id);
  end if;
  return new;
end
$$;

drop trigger if exists activate_calendar_after_draft_complete on public.drafts;
create trigger activate_calendar_after_draft_complete
after update of status on public.drafts
for each row execute function private.activate_calendar_after_draft_complete();

-- Repair already-completed leagues that finished before the activation trigger
-- existed. The calendar function is idempotent and selects the first upcoming
-- gameweek of each league's chosen competition.
do $$
declare
  draft_row record;
begin
  for draft_row in
    select draft.league_id
    from public.drafts draft
    where draft.status = 'complete'
      and not exists (
        select 1
        from public.league_transaction_windows transaction_window
        where transaction_window.league_id = draft.league_id
      )
  loop
    perform private.refresh_league_calendar(draft_row.league_id);
  end loop;
end
$$;

revoke all on function private.activate_calendar_after_draft_complete()
from public, anon, authenticated;
