-- Do not publish fantasy matchups until the snake draft is complete.
-- The final manager list is shuffled once when the completed draft triggers
-- private.finalize_draft, then a complete double round-robin is generated.
create or replace function private.ensure_draft_schedule(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_slots integer;
  v_rounds integer;
  v_round integer;
  v_pair integer;
  v_first uuid;
  v_second uuid;
  v_start_gameweek integer;
  v_last_gameweek integer;
  v_calendar text;
  v_home_gameweek integer;
  v_away_gameweek integer;
begin
  if exists (
    select 1
    from public.leagues l
    where l.id = p_league_id
      and l.game_format = 'draft'
      and not exists (
        select 1 from public.drafts d
        where d.league_id = p_league_id and d.status = 'complete'
      )
  ) then
    return;
  end if;

  if exists (
    select 1 from public.league_matchups where league_id = p_league_id
  ) then
    return;
  end if;

  select calendar_competition
  into v_calendar
  from public.leagues
  where id = p_league_id;

  select gameweek
  into v_start_gameweek
  from public.league_transaction_windows
  where league_id = p_league_id and roster_lock_at > now()
  order by roster_lock_at
  limit 1;

  if v_start_gameweek is null then
    select fixture.gameweek
    into v_start_gameweek
    from public.league_headline_fixtures fixture
    where fixture.league_id = p_league_id
      and fixture.competition = v_calendar
    group by fixture.gameweek
    having min(fixture.kickoff) > now()
    order by min(fixture.kickoff)
    limit 1;
  end if;

  v_start_gameweek := coalesce(v_start_gameweek, 1);
  select coalesce(max(gameweek), 50)
  into v_last_gameweek
  from public.league_headline_fixtures
  where league_id = p_league_id and competition = v_calendar;

  select array_agg(user_id order by random())
  into v_users
  from public.league_members
  where league_id = p_league_id;

  if coalesce(cardinality(v_users), 0) < 2 then return; end if;
  if mod(cardinality(v_users), 2) = 1 then
    v_users := array_append(v_users, null::uuid);
  end if;
  v_slots := cardinality(v_users);
  v_rounds := v_slots - 1;

  for v_round in 1..v_rounds loop
    v_home_gameweek := v_start_gameweek + v_round - 1;
    v_away_gameweek := v_home_gameweek + v_rounds;
    for v_pair in 1..(v_slots / 2) loop
      v_first := v_users[v_pair];
      v_second := v_users[v_slots - v_pair + 1];
      if v_first is not null and v_second is not null then
        if mod(v_round + v_pair, 2) = 0 then
          if v_home_gameweek <= v_last_gameweek then
            insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
            values (p_league_id, v_home_gameweek, v_first, v_second);
          end if;
          if v_away_gameweek <= v_last_gameweek then
            insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
            values (p_league_id, v_away_gameweek, v_second, v_first);
          end if;
        else
          if v_home_gameweek <= v_last_gameweek then
            insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
            values (p_league_id, v_home_gameweek, v_second, v_first);
          end if;
          if v_away_gameweek <= v_last_gameweek then
            insert into public.league_matchups(league_id, gameweek, home_user_id, away_user_id)
            values (p_league_id, v_away_gameweek, v_first, v_second);
          end if;
        end if;
      end if;
    end loop;
    v_users := array[v_users[1], v_users[v_slots]] || v_users[2:v_slots - 1];
  end loop;
end
$$;

-- Remove schedules that were generated from a partial join list. They will be
-- rebuilt automatically by the existing draft-completion trigger.
delete from public.league_matchups matchup
using public.leagues league
where matchup.league_id = league.id
  and league.game_format = 'draft'
  and not exists (
    select 1 from public.drafts draft
    where draft.league_id = league.id and draft.status = 'complete'
  );

revoke all on function private.ensure_draft_schedule(uuid)
from public, anon, authenticated;
