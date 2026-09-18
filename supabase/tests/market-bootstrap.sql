-- Focused PostgreSQL harness: synthetic data only, not a full schema replay.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE TABLE public.leagues(id uuid primary key, game_format text);
CREATE TABLE public.league_members(league_id uuid,user_id uuid,draft_slot int);
CREATE TABLE public.profiles(id uuid primary key);
CREATE TYPE public.draft_status AS ENUM ('waiting','live','complete');
CREATE TABLE public.drafts(id uuid primary key,league_id uuid,status public.draft_status,current_pick int,pick_deadline timestamptz,pick_seconds int,updated_at timestamptz);
CREATE TABLE public.players(id bigint primary key,active boolean,position text,club text);
CREATE TABLE public.draft_picks(id bigint generated always as identity primary key,draft_id uuid,league_id uuid,pick_number int,round int,user_id uuid,player_id bigint,picked_at timestamptz,auto_picked boolean,unique(league_id,player_id));
CREATE TABLE public.league_transaction_windows(league_id uuid,gameweek int,processed_at timestamptz,waiver_process_at timestamptz,player_market_lock_at timestamptz,roster_lock_at timestamptz);
CREATE TABLE public.lineup_players(league_id uuid,user_id uuid,player_id bigint);
CREATE TABLE public.waiver_claims(id uuid default gen_random_uuid(),league_id uuid,user_id uuid,add_player_id bigint,drop_player_id bigint,gameweek int,claim_rank int,status text default 'pending');

-- Auction tables copied from 20260816223926_auction_league_core.sql.
create table public.auction_sessions(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null unique references public.leagues(id) on delete cascade,
  draft_id uuid not null unique references public.drafts(id) on delete cascade,
  style text not null check(style in('nomination','mystery')),
  status text not null default 'waiting' check(status in('waiting','nomination','reveal','bidding','complete')),
  starting_budget bigint not null default 2000000000 check(starting_budget>0),
  minimum_bid bigint not null default 1000000 check(minimum_bid>0),
  bid_increment bigint not null default 1000000 check(bid_increment>0),
  bid_seconds smallint not null default 20 check(bid_seconds between 10 and 120),
  current_nominator_slot smallint not null default 1,
  current_lot_id uuid,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.auction_budgets(
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  remaining_budget bigint not null default 2000000000 check(remaining_budget>=0),
  primary key(league_id,user_id)
);

create table public.auction_lots(
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  sequence_no smallint not null,
  player_id bigint not null references public.players(id),
  nominated_by uuid references public.profiles(id),
  current_bid bigint,
  current_bidder_id uuid references public.profiles(id),
  status text not null default 'open' check(status in('open','sold','unsold')),
  closes_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(session_id,sequence_no)
);
alter table public.auction_sessions add constraint auction_sessions_current_lot_fkey
  foreign key(current_lot_id) references public.auction_lots(id) on delete set null;

create table public.auction_bids(
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  lot_id uuid not null references public.auction_lots(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount bigint not null check(amount>0),
  created_at timestamptz not null default now()
);


-- Baseline database helper, retained verbatim.
CREATE OR REPLACE FUNCTION private.is_league_member(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.league_members
    where league_id = p_league_id
      and user_id = (select auth.uid())
  );
$function$;

-- Baseline database helper, retained verbatim.
CREATE OR REPLACE FUNCTION private.draft_pick_is_valid(p_league_id uuid, p_user_id uuid, p_player_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_player public.players%rowtype;
  v_total integer;
  v_gk integer;
  v_def integer;
  v_mid integer;
  v_fwd integer;
  v_club integer;
  v_remaining integer;
  v_missing integer;
begin
  select * into v_player from public.players where id = p_player_id and active;
  if not found then return false; end if;

  if exists(select 1 from public.draft_picks where league_id = p_league_id and player_id = p_player_id) then
    return false;
  end if;

  select
    count(*),
    count(*) filter(where p.position = 'GK'),
    count(*) filter(where p.position = 'DEF'),
    count(*) filter(where p.position = 'MID'),
    count(*) filter(where p.position = 'FWD'),
    count(*) filter(where p.club = v_player.club)
  into v_total,v_gk,v_def,v_mid,v_fwd,v_club
  from public.draft_picks dp
  join public.players p on p.id = dp.player_id
  where dp.league_id = p_league_id and dp.user_id = p_user_id;

  if v_total >= 18 or v_club >= 4 then return false; end if;
  if (v_player.position = 'GK' and v_gk >= 2)
    or (v_player.position = 'DEF' and v_def >= 6)
    or (v_player.position = 'MID' and v_mid >= 5)
    or (v_player.position = 'FWD' and v_fwd >= 5) then
    return false;
  end if;

  v_gk := v_gk + case when v_player.position = 'GK' then 1 else 0 end;
  v_def := v_def + case when v_player.position = 'DEF' then 1 else 0 end;
  v_mid := v_mid + case when v_player.position = 'MID' then 1 else 0 end;
  v_fwd := v_fwd + case when v_player.position = 'FWD' then 1 else 0 end;
  v_remaining := 18 - (v_total + 1);
  v_missing := greatest(0,2-v_gk) + greatest(0,6-v_def) + greatest(0,5-v_mid) + greatest(0,5-v_fwd);
  return v_missing <= v_remaining;
end
$function$;

-- Baseline database helper, retained verbatim.
CREATE OR REPLACE FUNCTION private.auction_max_bid(p_league_id uuid, p_user_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
select greatest(0,b.remaining_budget-(greatest(0,18-count(dp.id)-1)*s.minimum_bid))::bigint
from public.auction_budgets b join public.auction_sessions s on s.league_id=b.league_id
left join public.draft_picks dp on dp.league_id=b.league_id and dp.user_id=b.user_id
where b.league_id=p_league_id and b.user_id=p_user_id group by b.remaining_budget,s.minimum_bid
$function$;

-- Baseline database helper, retained verbatim.
CREATE OR REPLACE FUNCTION private.roster_is_legal(p_league_id uuid, p_user_id uuid, p_remove bigint[] DEFAULT '{}'::bigint[], p_add bigint[] DEFAULT '{}'::bigint[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with current_roster as (
    select dp.player_id
    from public.draft_picks dp
    where dp.league_id = p_league_id
      and dp.user_id = p_user_id
  ), projected_roster as (
    select player_id
    from current_roster
    where not (player_id = any(coalesce(p_remove, '{}'::bigint[])))
    union all
    select unnest(coalesce(p_add, '{}'::bigint[]))
  ), current_counts as (
    select
      count(*) total,
      count(*) filter (where p.position = 'GK') gk,
      count(*) filter (where p.position = 'DEF') def,
      count(*) filter (where p.position = 'MID') mid,
      count(*) filter (where p.position = 'FWD') fwd
    from current_roster r
    join public.players p on p.id = r.player_id
  ), projected_counts as (
    select
      count(*) total,
      count(*) filter (where p.position = 'GK') gk,
      count(*) filter (where p.position = 'DEF') def,
      count(*) filter (where p.position = 'MID') mid,
      count(*) filter (where p.position = 'FWD') fwd,
      coalesce(max(club_count), 0) max_club
    from projected_roster r
    join public.players p on p.id = r.player_id
    left join lateral (
      select count(*) club_count
      from projected_roster r2
      join public.players p2 on p2.id = r2.player_id
      where p2.club = p.club
    ) clubs on true
  )
  select
    projected.total = 18
    and projected.max_club <= 4
    and (
      (
        current.total = 18
        and current.gk = 2
        and current.def = 6
        and current.mid = 5
        and current.fwd = 5
        and projected.gk = 2
        and projected.def = 6
        and projected.mid = 5
        and projected.fwd = 5
      )
      or (
        not (
          current.total = 18
          and current.gk = 2
          and current.def = 6
          and current.mid = 5
          and current.fwd = 5
        )
        and abs(projected.gk - 2) <= abs(current.gk - 2)
        and abs(projected.def - 6) <= abs(current.def - 6)
        and abs(projected.mid - 5) <= abs(current.mid - 5)
        and abs(projected.fwd - 5) <= abs(current.fwd - 5)
      )
    )
  from current_counts current
  cross join projected_counts projected
$function$;
