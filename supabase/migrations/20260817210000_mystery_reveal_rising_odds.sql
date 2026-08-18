-- Mystery Reveal pity system. The odds belong to the shared auction session,
-- rise after lower-tier reveals, and reset when a Star or Superstar appears.
alter table public.auction_sessions
  add column if not exists star_drought smallint not null default 0,
  add column if not exists superstar_drought smallint not null default 0;

alter table public.auction_sessions
  drop constraint if exists auction_sessions_star_drought_check,
  add constraint auction_sessions_star_drought_check
    check (star_drought between 0 and 1000),
  drop constraint if exists auction_sessions_superstar_drought_check,
  add constraint auction_sessions_superstar_drought_check
    check (superstar_drought between 0 and 1000);

create or replace function public.reveal_auction_player(p_league_id uuid)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_session public.auction_sessions%rowtype;
  v_player bigint;
  v_rank integer;
  v_roll numeric;
  v_superstar_chance numeric;
  v_star_chance numeric;
  v_target_tier text;
begin
  if v_user is null or not exists(
    select 1
    from public.league_members
    where league_id=p_league_id and user_id=v_user
  ) then
    raise exception 'League membership required';
  end if;

  select * into v_session
  from public.auction_sessions
  where league_id=p_league_id
  for update;

  if not found then raise exception 'Auction session not found'; end if;
  if v_session.style<>'mystery' or v_session.status<>'reveal' then
    raise exception 'Mystery Reveal is not ready';
  end if;

  v_superstar_chance := least(15, 5 + v_session.superstar_drought);
  v_star_chance := least(45, 15 + (v_session.star_drought * 5));
  v_roll := random() * 100;
  v_target_tier := case
    when v_roll < v_superstar_chance then 'superstar'
    when v_roll < v_superstar_chance + v_star_chance then 'star'
    else 'regular'
  end;

  with candidates as (
    select
      p.id,
      p.draft_rank,
      case
        when p.draft_rank between 1 and 50 then 'superstar'
        when p.draft_rank between 51 and 150 then 'star'
        else 'regular'
      end as tier
    from public.players p
    join public.leagues l on l.id=p_league_id
    where p.active
      and (l.player_pool='All Top Five' or p.competition=l.player_pool)
      and not exists(
        select 1 from public.auction_lots x
        where x.league_id=p_league_id
          and x.player_id=p.id
          and x.status in('open','sold')
      )
      and exists(
        select 1 from public.league_members m
        where m.league_id=p_league_id
          and private.draft_pick_is_valid(p_league_id,m.user_id,p.id)
      )
  )
  select id,draft_rank into v_player,v_rank
  from candidates
  order by case when tier=v_target_tier then 0 else 1 end,random()
  limit 1;

  if v_player is null then
    raise exception 'No eligible mystery players remain';
  end if;

  update public.auction_sessions
  set
    star_drought=case
      when v_rank between 1 and 150 then 0
      else least(1000,star_drought+1)
    end,
    superstar_drought=case
      when v_rank between 1 and 50 then 0
      else least(1000,superstar_drought+1)
    end,
    updated_at=now()
  where id=v_session.id;

  return private.open_auction_lot(p_league_id,v_player,null,null);
end
$$;

revoke all on function public.reveal_auction_player(uuid) from public,anon;
grant execute on function public.reveal_auction_player(uuid) to authenticated;
