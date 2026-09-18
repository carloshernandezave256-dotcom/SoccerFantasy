create or replace function public.lineup_player_lock_state(p_league_id uuid)
returns table(player_id bigint,locks_at timestamptz,locked boolean,rolling boolean,server_time timestamptz)
language plpgsql stable security definer set search_path='' as $$
declare v_week smallint;
begin
 if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then raise exception 'League membership required';end if;
 v_week:=private.lineup_exception_week(p_league_id);
 return query
 select p.id,
  case when v_week is not null then (
   select min(least(m.original_kickoff,f.kickoff)) from private.gameweek_fixture_members m
   join public.football_fixture_cache f using(fixture_id)
   where m.league_id=p_league_id and m.gameweek=v_week and f.competition=p.competition and p.club in(f.home_team,f.away_team)
  ) else (select w.roster_lock_at from public.league_transaction_windows w where w.league_id=p_league_id order by w.gameweek desc limit 1) end,
  case when v_week is not null then private.exception_player_locked(p_league_id,v_week,p.id) else private.lineup_changes_locked(p_league_id) end,
  v_week is not null,statement_timestamp()
 from public.players p where p.id in (
  select l.player_id from public.lineup_players l where l.league_id=p_league_id
  union select d.player_id from public.draft_picks d where d.league_id=p_league_id
  union select c.player_id from public.pack_cards c where c.league_id=p_league_id and c.active_slot is not null
 );
end $$;
revoke all on function public.lineup_player_lock_state(uuid) from public,anon;
grant execute on function public.lineup_player_lock_state(uuid) to authenticated;
