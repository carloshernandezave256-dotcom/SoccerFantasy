alter table public.drafts
  add column if not exists post_draft_finalized_at timestamptz;

create or replace function private.ensure_draft_lineup(
  p_league_id uuid,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starters bigint[];
  v_bench bigint[];
  v_valid boolean;
begin
  select count(*) filter(where lp.is_starter)=11
    and count(*) filter(where lp.is_starter and p.position='GK')=1
    and count(*) filter(where lp.is_starter and p.position='DEF')=4
    and count(*) filter(where lp.is_starter and p.position='MID')=3
    and count(*) filter(where lp.is_starter and p.position='FWD')=3
  into v_valid
  from public.lineup_players lp
  join public.players p on p.id=lp.player_id
  where lp.league_id=p_league_id and lp.user_id=p_user_id;
  if coalesce(v_valid,false) then return; end if;

  with ranked as (
    select dp.player_id,p.position,dp.pick_number,
      row_number() over(partition by p.position order by dp.pick_number) as position_pick
    from public.draft_picks dp
    join public.players p on p.id=dp.player_id
    where dp.league_id=p_league_id and dp.user_id=p_user_id
  )
  select array_agg(player_id order by
    case position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
    position_pick)
  into v_starters
  from ranked
  where (position='GK' and position_pick<=1)
     or (position='DEF' and position_pick<=4)
     or (position='MID' and position_pick<=3)
     or (position='FWD' and position_pick<=3);

  if coalesce(cardinality(v_starters),0)<>11 then return; end if;

  select array_agg(dp.player_id order by
    case p.position when 'GK' then 1 when 'DEF' then 2 when 'MID' then 3 else 4 end,
    dp.pick_number)
  into v_bench
  from public.draft_picks dp
  join public.players p on p.id=dp.player_id
  where dp.league_id=p_league_id and dp.user_id=p_user_id
    and not (dp.player_id=any(v_starters));

  delete from public.lineup_players where league_id=p_league_id and user_id=p_user_id;
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order)
    select p_league_id,p_user_id,player_id,true,false,ordinality
    from unnest(v_starters) with ordinality as starter(player_id,ordinality);
  insert into public.lineup_players(league_id,user_id,player_id,is_starter,is_captain,bench_order)
    select p_league_id,p_user_id,player_id,false,false,ordinality
    from unnest(coalesce(v_bench,array[]::bigint[])) with ordinality as bench(player_id,ordinality);
end
$$;

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
begin
  if exists(select 1 from public.league_matchups where league_id=p_league_id) then return; end if;
  select array_agg(user_id order by draft_slot,joined_at) into v_users
  from public.league_members where league_id=p_league_id;
  if coalesce(cardinality(v_users),0)<2 then return; end if;
  if mod(cardinality(v_users),2)=1 then v_users:=array_append(v_users,null::uuid); end if;
  v_slots:=cardinality(v_users);v_rounds:=v_slots-1;
  for v_round in 1..v_rounds loop
    for v_pair in 1..(v_slots/2) loop
      v_first:=v_users[v_pair];v_second:=v_users[v_slots-v_pair+1];
      if v_first is not null and v_second is not null then
        if mod(v_round+v_pair,2)=0 then
          insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id)
          values(p_league_id,v_round,v_first,v_second),(p_league_id,v_round+v_rounds,v_second,v_first);
        else
          insert into public.league_matchups(league_id,gameweek,home_user_id,away_user_id)
          values(p_league_id,v_round,v_second,v_first),(p_league_id,v_round+v_rounds,v_first,v_second);
        end if;
      end if;
    end loop;
    v_users:=array[v_users[1],v_users[v_slots]]||v_users[2:v_slots-1];
  end loop;
end
$$;

create or replace function private.finalize_draft(
  p_league_id uuid,
  p_randomize_waivers boolean default true
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_member record;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_league_id::text,0));
  select id into v_draft_id from public.drafts
  where league_id=p_league_id and status='complete'
  for update;
  if v_draft_id is null then return; end if;

  if p_randomize_waivers and not exists(
    select 1 from public.drafts where id=v_draft_id and post_draft_finalized_at is not null
  ) then
    with randomized as (
      select user_id,row_number() over(order by random())::integer as priority
      from public.league_members where league_id=p_league_id
    )
    update public.league_members m set waiver_priority=r.priority
    from randomized r where m.league_id=p_league_id and m.user_id=r.user_id;
  end if;

  for v_member in select user_id from public.league_members where league_id=p_league_id loop
    perform private.ensure_draft_lineup(p_league_id,v_member.user_id);
  end loop;
  perform private.ensure_draft_schedule(p_league_id);
  update public.leagues set joining_open=false where id=p_league_id;
  update public.drafts set post_draft_finalized_at=coalesce(post_draft_finalized_at,now()) where id=v_draft_id;
end
$$;

create or replace function private.finish_draft_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status and new.status='complete' then
    perform private.finalize_draft(new.league_id,true);
  end if;
  return new;
end
$$;

drop trigger if exists randomize_initial_waiver_order on public.drafts;
drop trigger if exists finish_draft_transition on public.drafts;
create trigger finish_draft_transition
after update of status on public.drafts
for each row execute function private.finish_draft_transition();

revoke all on function private.ensure_draft_lineup(uuid,uuid),private.ensure_draft_schedule(uuid),private.finalize_draft(uuid,boolean),private.finish_draft_transition() from public,anon,authenticated;

do $$
declare v_draft record;
begin
  for v_draft in
    select d.league_id from public.drafts d
    join public.leagues l on l.id=d.league_id
    where d.status='complete' and l.game_format='draft'
  loop
    perform private.finalize_draft(v_draft.league_id,false);
  end loop;
end
$$;
