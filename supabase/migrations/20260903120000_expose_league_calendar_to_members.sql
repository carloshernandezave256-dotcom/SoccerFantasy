create or replace function public.league_calendar_competition(p_league_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select league.calendar_competition
  from public.leagues as league
  where league.id = p_league_id
    and (select private.is_league_member(p_league_id));
$$;

revoke all on function public.league_calendar_competition(uuid) from public, anon;
grant execute on function public.league_calendar_competition(uuid) to authenticated, service_role;

comment on function public.league_calendar_competition(uuid) is
  'Returns the fantasy calendar competition only when the caller belongs to the league.';
