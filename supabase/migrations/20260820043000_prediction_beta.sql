create table public.prediction_wallets (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  last_refill_week date,
  lifetime_won integer not null default 0 check (lifetime_won >= 0),
  updated_at timestamptz not null default now(),
  primary key (league_id,user_id),
  foreign key (league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);

create table public.prediction_markets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  fixture_id bigint not null,
  gameweek integer not null check (gameweek > 0),
  market_type text not null check (market_type in ('match_winner','player_to_score','over_under_2_5')),
  question text not null check (char_length(question) between 5 and 120),
  locks_at timestamptz not null,
  status text not null default 'open' check (status in ('open','settled','void')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  foreign key (league_id,fixture_id) references public.league_headline_fixtures(league_id,fixture_id) on delete cascade
);

create table public.prediction_options (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.prediction_markets(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  outcome_key text not null check (char_length(outcome_key) between 1 and 80),
  decimal_odds numeric(6,2) not null check (decimal_odds between 1.01 and 20.00),
  result text not null default 'pending' check (result in ('pending','won','lost','void')),
  unique (market_id,outcome_key)
);

create table public.prediction_bets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  market_id uuid not null references public.prediction_markets(id) on delete cascade,
  option_id uuid not null references public.prediction_options(id),
  stake integer not null check (stake between 1 and 100),
  decimal_odds numeric(6,2) not null,
  potential_payout integer not null check (potential_payout >= stake),
  payout integer not null default 0 check (payout >= 0),
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (market_id,user_id),
  foreign key (league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);

create table public.prediction_token_ledger (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount <> 0),
  reason text not null check (reason in ('weekly_refill','stake','win','void_refund')),
  reference_id uuid not null,
  created_at timestamptz not null default now(),
  unique (league_id,user_id,reason,reference_id),
  foreign key (league_id,user_id) references public.league_members(league_id,user_id) on delete cascade
);

create index prediction_markets_league_lock_idx on public.prediction_markets(league_id,status,locks_at);
create index prediction_options_market_idx on public.prediction_options(market_id);
create index prediction_bets_user_idx on public.prediction_bets(league_id,user_id,placed_at desc);
create index prediction_bets_market_status_idx on public.prediction_bets(market_id,status);
create index prediction_ledger_user_idx on public.prediction_token_ledger(league_id,user_id,created_at desc);

alter table public.prediction_wallets enable row level security;
alter table public.prediction_markets enable row level security;
alter table public.prediction_options enable row level security;
alter table public.prediction_bets enable row level security;
alter table public.prediction_token_ledger enable row level security;

grant select on public.prediction_wallets,public.prediction_markets,public.prediction_options,public.prediction_bets,public.prediction_token_ledger to authenticated;
grant all on public.prediction_wallets,public.prediction_markets,public.prediction_options,public.prediction_bets,public.prediction_token_ledger to service_role;

create policy "Members view their prediction wallet" on public.prediction_wallets for select to authenticated
using (user_id=(select auth.uid()) and (select private.is_league_member(league_id)));
create policy "Members view league prediction markets" on public.prediction_markets for select to authenticated
using ((select private.is_league_member(league_id)));
create policy "Members view league prediction options" on public.prediction_options for select to authenticated
using (exists(select 1 from public.prediction_markets m where m.id=market_id and (select private.is_league_member(m.league_id))));
create policy "Members view their prediction bets" on public.prediction_bets for select to authenticated
using (user_id=(select auth.uid()) and (select private.is_league_member(league_id)));
create policy "Members view their prediction ledger" on public.prediction_token_ledger for select to authenticated
using (user_id=(select auth.uid()) and (select private.is_league_member(league_id)));

create or replace function public.claim_prediction_refill(p_league_id uuid)
returns table(balance integer,granted integer,next_refill_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_week date := date_trunc('week',now() at time zone 'UTC')::date;
  v_granted integer := 0;
  v_balance integer;
  v_last_refill date;
begin
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'Join this league before making predictions';end if;
  insert into public.prediction_wallets(league_id,user_id,balance,last_refill_week)
  values(p_league_id,v_user,0,null)
  on conflict(league_id,user_id) do nothing;
  select w.balance,w.last_refill_week into v_balance,v_last_refill from public.prediction_wallets w
  where w.league_id=p_league_id and w.user_id=v_user for update;
  if v_last_refill is null or v_last_refill<v_week then
    v_granted:=greatest(0,least(100,300-v_balance));
    update public.prediction_wallets set balance=balance+v_granted,last_refill_week=v_week,updated_at=now()
    where league_id=p_league_id and user_id=v_user returning balance into v_balance;
  end if;
  if v_granted>0 then
    insert into public.prediction_token_ledger(league_id,user_id,amount,reason,reference_id)
    values(p_league_id,v_user,v_granted,'weekly_refill',gen_random_uuid());
  end if;
  return query select v_balance,v_granted,(v_week+7)::timestamp at time zone 'UTC';
end;$$;

create or replace function public.place_prediction(p_option_id uuid,p_stake integer)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_market public.prediction_markets%rowtype;
  v_option public.prediction_options%rowtype;
  v_bet uuid := gen_random_uuid();
  v_payout integer;
begin
  if v_user is null then raise exception 'Sign in to make a prediction';end if;
  if p_stake<1 or p_stake>100 then raise exception 'Choose a stake from 1 to 100 Prediction Tokens';end if;
  select * into v_option from public.prediction_options where id=p_option_id;
  select * into v_market from public.prediction_markets where id=v_option.market_id for update;
  if v_market.id is null or not private.is_league_member(v_market.league_id) then raise exception 'Prediction market not found';end if;
  if v_market.status<>'open' or now()>=v_market.locks_at then raise exception 'This prediction market is locked';end if;
  if exists(select 1 from public.prediction_bets where market_id=v_market.id and user_id=v_user) then raise exception 'You already made a prediction on this market';end if;
  update public.prediction_wallets set balance=balance-p_stake,updated_at=now()
  where league_id=v_market.league_id and user_id=v_user and balance>=p_stake;
  if not found then raise exception 'Not enough Prediction Tokens';end if;
  v_payout:=floor(p_stake*v_option.decimal_odds);
  insert into public.prediction_bets(id,league_id,user_id,market_id,option_id,stake,decimal_odds,potential_payout)
  values(v_bet,v_market.league_id,v_user,v_market.id,v_option.id,p_stake,v_option.decimal_odds,v_payout);
  insert into public.prediction_token_ledger(league_id,user_id,amount,reason,reference_id)
  values(v_market.league_id,v_user,-p_stake,'stake',v_bet);
  return v_bet;
end;$$;

create or replace function public.create_prediction_market(p_league_id uuid,p_fixture_id bigint,p_market_type text,p_question text,p_options jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());v_market uuid;v_fixture public.league_headline_fixtures%rowtype;v_option jsonb;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=v_user) then raise exception 'Only the commissioner can create prediction markets';end if;
  if p_market_type not in('match_winner','player_to_score','over_under_2_5') then raise exception 'Unsupported prediction type';end if;
  select * into v_fixture from public.league_headline_fixtures where league_id=p_league_id and fixture_id=p_fixture_id;
  if v_fixture.fixture_id is null or v_fixture.kickoff<=now() then raise exception 'Choose an upcoming fixture';end if;
  if jsonb_typeof(p_options)<>'array' or jsonb_array_length(p_options)<2 or jsonb_array_length(p_options)>10 then raise exception 'Add between 2 and 10 outcomes';end if;
  insert into public.prediction_markets(league_id,fixture_id,gameweek,market_type,question,locks_at,created_by)
  values(p_league_id,p_fixture_id,v_fixture.gameweek,p_market_type,trim(p_question),v_fixture.kickoff,v_user) returning id into v_market;
  for v_option in select * from jsonb_array_elements(p_options) loop
    insert into public.prediction_options(market_id,label,outcome_key,decimal_odds)
    values(v_market,trim(v_option->>'label'),lower(regexp_replace(trim(v_option->>'label'),'[^a-zA-Z0-9]+','_','g')),(v_option->>'odds')::numeric);
  end loop;
  return v_market;
end;$$;

create or replace function public.settle_prediction_market(p_market_id uuid,p_winning_option_id uuid default null,p_void boolean default false)
returns integer language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());v_market public.prediction_markets%rowtype;v_paid integer:=0;v_bet record;
begin
  select * into v_market from public.prediction_markets where id=p_market_id for update;
  if v_market.id is null then raise exception 'Prediction market not found';end if;
  if not exists(select 1 from public.leagues where id=v_market.league_id and commissioner_id=v_user) then raise exception 'Only the commissioner can settle prediction markets';end if;
  if v_market.status<>'open' then return 0;end if;
  if not p_void and not exists(select 1 from public.prediction_options where id=p_winning_option_id and market_id=p_market_id) then raise exception 'Choose the winning outcome';end if;
  if not p_void and not exists(select 1 from public.league_headline_fixtures where league_id=v_market.league_id and fixture_id=v_market.fixture_id and status in('FT','AET','PEN')) then raise exception 'The fixture must be final before settlement';end if;
  update public.prediction_markets set status=case when p_void then 'void' else 'settled' end,settled_at=now() where id=p_market_id;
  update public.prediction_options set result=case when p_void then 'void' when id=p_winning_option_id then 'won' else 'lost' end where market_id=p_market_id;
  for v_bet in select * from public.prediction_bets where market_id=p_market_id and status='pending' for update loop
    if p_void or v_bet.option_id=p_winning_option_id then
      update public.prediction_wallets set balance=balance+case when p_void then v_bet.stake else v_bet.potential_payout end,
        lifetime_won=lifetime_won+case when p_void then 0 else v_bet.potential_payout end,updated_at=now()
      where league_id=v_bet.league_id and user_id=v_bet.user_id;
      update public.prediction_bets set status=case when p_void then 'void' else 'won' end,payout=case when p_void then v_bet.stake else v_bet.potential_payout end,settled_at=now() where id=v_bet.id;
      insert into public.prediction_token_ledger(league_id,user_id,amount,reason,reference_id)
      values(v_bet.league_id,v_bet.user_id,case when p_void then v_bet.stake else v_bet.potential_payout end,case when p_void then 'void_refund' else 'win' end,v_bet.id);
      v_paid:=v_paid+1;
    else
      update public.prediction_bets set status='lost',settled_at=now() where id=v_bet.id;
    end if;
  end loop;
  return v_paid;
end;$$;

revoke all on function public.claim_prediction_refill(uuid),public.place_prediction(uuid,integer),public.create_prediction_market(uuid,bigint,text,text,jsonb),public.settle_prediction_market(uuid,uuid,boolean) from public,anon;
grant execute on function public.claim_prediction_refill(uuid),public.place_prediction(uuid,integer),public.create_prediction_market(uuid,bigint,text,text,jsonb),public.settle_prediction_market(uuid,uuid,boolean) to authenticated;
