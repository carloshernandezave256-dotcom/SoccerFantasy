alter table public.leagues
  add column if not exists joining_open boolean not null default true,
  add column if not exists draft_pick_seconds smallint not null default 90,
  add column if not exists trades_enabled boolean not null default true,
  add column if not exists lineup_lock_minutes smallint not null default 0,
  add column if not exists motm_manual boolean not null default true;

alter table public.leagues drop constraint if exists leagues_draft_pick_seconds_check;
alter table public.leagues add constraint leagues_draft_pick_seconds_check check (draft_pick_seconds in (30,60,90,120));
alter table public.leagues drop constraint if exists leagues_lineup_lock_minutes_check;
alter table public.leagues add constraint leagues_lineup_lock_minutes_check check (lineup_lock_minutes in (0,15,30,60));

create or replace function public.league_settings(p_league_id uuid)
returns table(
  league_name text,
  joining_open boolean,
  draft_pick_seconds smallint,
  trades_enabled boolean,
  lineup_lock_minutes smallint,
  motm_manual boolean
)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then
    raise exception 'League membership required';
  end if;
  return query select l.name,l.joining_open,l.draft_pick_seconds,l.trades_enabled,l.lineup_lock_minutes,l.motm_manual
  from public.leagues l where l.id=p_league_id;
end$$;

create or replace function public.update_league_settings(
  p_league_id uuid,
  p_name text,
  p_joining_open boolean,
  p_draft_pick_seconds smallint,
  p_trades_enabled boolean,
  p_lineup_lock_minutes smallint
) returns void
language plpgsql security definer set search_path='' as $$
declare v_draft_started boolean;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=(select auth.uid())) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if char_length(trim(p_name))<2 or char_length(trim(p_name))>60 then raise exception 'League name must be 2 to 60 characters'; end if;
  if p_draft_pick_seconds not in (30,60,90,120) then raise exception 'Choose a 30, 60, 90 or 120 second draft clock'; end if;
  if p_lineup_lock_minutes not in (0,15,30,60) then raise exception 'Choose a valid lineup lock time'; end if;
  select exists(select 1 from public.drafts where league_id=p_league_id) into v_draft_started;
  update public.leagues set
    name=trim(p_name),
    joining_open=case when v_draft_started then false else p_joining_open end,
    draft_pick_seconds=case when v_draft_started then draft_pick_seconds else p_draft_pick_seconds end,
    trades_enabled=p_trades_enabled,
    lineup_lock_minutes=p_lineup_lock_minutes
  where id=p_league_id;
end$$;

create or replace function public.join_league(p_invite_code text,p_team_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_league public.leagues%rowtype;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select * into v_league from public.leagues where invite_code=upper(trim(p_invite_code)) for update;
  if not found then raise exception 'Invite code not found';end if;
  if not v_league.joining_open then raise exception 'This league is no longer accepting managers';end if;
  if exists(select 1 from public.drafts where league_id=v_league.id) then raise exception 'This league draft has already started';end if;
  select count(*) into v_count from public.league_members where league_id=v_league.id;
  if v_count>=v_league.size then raise exception 'League is full';end if;
  insert into public.league_members(league_id,user_id,team_name,draft_slot) values(v_league.id,v_user,trim(p_team_name),v_count+1);
  return v_league.id;
end$$;

create or replace function public.start_draft(p_league_id uuid,p_pick_seconds smallint default 90)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_count int;v_id uuid;v_seconds smallint;
begin
  select draft_pick_seconds into v_seconds from public.leagues where id=p_league_id and commissioner_id=v_user for update;
  if not found then raise exception 'Only the commissioner can start this draft';end if;
  select count(*) into v_count from public.league_members where league_id=p_league_id;
  if v_count<3 then raise exception 'At least 3 managers are required before drafting';end if;
  update public.leagues set joining_open=false where id=p_league_id;
  insert into public.drafts(league_id,status,pick_seconds,current_pick,pick_deadline,started_at)
  values(p_league_id,'live',v_seconds,1,now()+make_interval(secs=>v_seconds),now())
  on conflict(league_id) do update set status='live',pick_seconds=v_seconds,current_pick=1,pick_deadline=now()+make_interval(secs=>v_seconds),started_at=now(),updated_at=now()
  returning id into v_id;
  return v_id;
end$$;

create or replace function public.create_trade_offer(p_league_id uuid,p_recipient_id uuid,p_offered bigint[],p_requested bigint[],p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_trade uuid;v_count int;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if not coalesce((select trades_enabled from public.leagues where id=p_league_id),false) then raise exception 'Trading is disabled in this league';end if;
  if p_recipient_id=v_user then raise exception 'Choose another manager';end if;
  if cardinality(p_offered)<1 or cardinality(p_requested)<1 then raise exception 'Select at least one player from each team';end if;
  if cardinality(p_offered)<>cardinality(array(select distinct unnest(p_offered))) or cardinality(p_requested)<>cardinality(array(select distinct unnest(p_requested))) then raise exception 'Duplicate players are not allowed';end if;
  if p_offered&&p_requested then raise exception 'A player cannot appear on both sides';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=v_user) then raise exception 'League membership required';end if;
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=p_recipient_id) then raise exception 'Recipient is not in this league';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=any(p_offered);
  if v_count<>cardinality(p_offered) then raise exception 'You no longer own every offered player';end if;
  select count(*) into v_count from public.draft_picks where league_id=p_league_id and user_id=p_recipient_id and player_id=any(p_requested);
  if v_count<>cardinality(p_requested) then raise exception 'The recipient no longer owns every requested player';end if;
  insert into public.trades(league_id,proposer_id,recipient_id,note) values(p_league_id,v_user,p_recipient_id,nullif(trim(p_note),'')) returning id into v_trade;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,v_user from unnest(p_offered)x;
  insert into public.trade_players(trade_id,player_id,from_user_id) select v_trade,x,p_recipient_id from unnest(p_requested)x;
  return v_trade;
end$$;

revoke all on function public.league_settings(uuid) from public,anon;
revoke all on function public.update_league_settings(uuid,text,boolean,smallint,boolean,smallint) from public,anon;
grant execute on function public.league_settings(uuid) to authenticated;
grant execute on function public.update_league_settings(uuid,text,boolean,smallint,boolean,smallint) to authenticated;

