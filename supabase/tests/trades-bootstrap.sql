alter table public.leagues add column trades_enabled boolean;
create type public.trade_status as enum('pending','accepted','declined','cancelled','expired');
create table public.trades(id uuid primary key,league_id uuid,proposer_id uuid,recipient_id uuid,status public.trade_status,expires_at timestamptz,responded_at timestamptz,seen_at timestamptz);
create table public.trade_players(trade_id uuid,player_id bigint,from_user_id uuid,pack_card_id uuid,primary key(trade_id,player_id));
create table public.pack_cards(id uuid primary key,league_id uuid,user_id uuid,player_id bigint,active_slot int,acquired_via text);
CREATE OR REPLACE FUNCTION private.trade_roster_is_legal(p_league_id uuid, p_user_id uuid, p_remove bigint[], p_add bigint[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with projected as (
    select dp.player_id from public.draft_picks dp
    where dp.league_id=p_league_id and dp.user_id=p_user_id
      and not(dp.player_id=any(coalesce(p_remove,'{}'::bigint[])))
    union all select unnest(coalesce(p_add,'{}'::bigint[]))
  ), position_counts as (
    select count(*) total,
      count(*) filter(where p.position='GK') gk,
      count(*) filter(where p.position='DEF') def,
      count(*) filter(where p.position='MID') mid,
      count(*) filter(where p.position='FWD') fwd
    from projected r join public.players p on p.id=r.player_id
  ), club_counts as (
    select coalesce(max(c),0) max_club from (
      select count(*) c from projected r join public.players p on p.id=r.player_id group by p.club
    ) clubs
  )
  select case when pc.total<18 then cc.max_club<=4
    else pc.total=18 and pc.gk=2 and pc.def=6 and pc.mid=5 and pc.fwd=5 and cc.max_club<=4 end
  from position_counts pc cross join club_counts cc
$function$;
