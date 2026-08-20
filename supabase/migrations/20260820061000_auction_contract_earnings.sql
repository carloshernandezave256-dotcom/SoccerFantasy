create table public.auction_contract_earnings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  gameweek integer not null check (gameweek > 0),
  user_id uuid not null references auth.users(id) on delete cascade,
  matchup_id uuid not null references public.league_matchups(id) on delete cascade,
  result text not null check (result in ('win','draw','loss')),
  weekly_amount bigint not null default 3000000 check (weekly_amount = 3000000),
  result_amount bigint not null check (result_amount in (1000000,3000000,5000000)),
  total_amount bigint generated always as (weekly_amount + result_amount) stored,
  awarded_at timestamptz not null default now(),
  unique (league_id,gameweek,user_id)
);

create index auction_contract_earnings_user_idx
  on public.auction_contract_earnings(league_id,user_id,gameweek desc);

alter table public.auction_contract_earnings enable row level security;
grant select on public.auction_contract_earnings to authenticated;
grant all on public.auction_contract_earnings to service_role;

create policy "Managers view their contract earnings"
on public.auction_contract_earnings for select to authenticated
using (user_id=(select auth.uid()) and (select private.is_league_member(league_id)));

create or replace function private.award_auction_contract_earnings()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_side record;
  v_result text;
  v_bonus bigint;
  v_total bigint;
begin
  if new.status <> 'final' then return new; end if;
  if not exists(select 1 from public.leagues where id=new.league_id and game_format='auction') then return new; end if;
  if exists(select 1 from public.league_matchups where league_id=new.league_id and gameweek=new.gameweek and status<>'final') then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(new.league_id::text||':'||new.gameweek::text,0));

  for v_side in
    select m.id as matchup_id,m.home_user_id as user_id,m.home_score as scored,m.away_score as conceded
    from public.league_matchups m where m.league_id=new.league_id and m.gameweek=new.gameweek
    union all
    select m.id,m.away_user_id,m.away_score,m.home_score
    from public.league_matchups m where m.league_id=new.league_id and m.gameweek=new.gameweek
  loop
    v_result:=case when v_side.scored>v_side.conceded then 'win' when v_side.scored=v_side.conceded then 'draw' else 'loss' end;
    v_bonus:=case v_result when 'win' then 5000000 when 'draw' then 3000000 else 1000000 end;

    insert into public.auction_contract_earnings(league_id,gameweek,user_id,matchup_id,result,result_amount)
    values(new.league_id,new.gameweek,v_side.user_id,v_side.matchup_id,v_result,v_bonus)
    on conflict(league_id,gameweek,user_id) do nothing
    returning total_amount into v_total;

    if found then
      update public.auction_budgets
      set remaining_budget=remaining_budget+v_total
      where league_id=new.league_id and user_id=v_side.user_id;
    end if;
  end loop;

  return new;
end;
$$;

create trigger award_auction_contract_earnings_after_matchup
after insert or update of status,home_score,away_score on public.league_matchups
for each row execute function private.award_auction_contract_earnings();

revoke all on function private.award_auction_contract_earnings() from public,anon,authenticated;
