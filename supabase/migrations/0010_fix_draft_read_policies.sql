create or replace function private.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members
    where league_id = p_league_id
      and user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_league_member(uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_league_member(uuid) to authenticated;

drop policy if exists "league members read drafts" on public.drafts;
create policy "league members read drafts"
on public.drafts
for select
to authenticated
using ((select private.is_league_member(drafts.league_id)));

drop policy if exists "league members read picks" on public.draft_picks;
create policy "league members read picks"
on public.draft_picks
for select
to authenticated
using ((select private.is_league_member(draft_picks.league_id)));
