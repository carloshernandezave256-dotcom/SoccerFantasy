begin;

create or replace function private.randomize_gameweek_waiver_priority(
  p_league_id uuid,
  p_gameweek integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_window_id uuid;
begin
  select transaction_window.id
  into v_window_id
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
    and transaction_window.gameweek = p_gameweek
    and transaction_window.processed_at is null
    and transaction_window.priority_randomized_at is null
  for update;

  if v_window_id is null then
    return false;
  end if;

  update public.league_members member
  set waiver_priority = randomized.priority
  from (
    select
      league_member.user_id,
      row_number() over (order by random())::integer as priority
    from public.league_members league_member
    where league_member.league_id = p_league_id
  ) randomized
  where member.league_id = p_league_id
    and member.user_id = randomized.user_id;

  update public.league_transaction_windows
  set priority_randomized_at = now(),
      updated_at = now()
  where id = v_window_id;

  return true;
end;
$function$;

revoke all on function private.randomize_gameweek_waiver_priority(uuid, integer)
from public, anon, authenticated;

create or replace function private.open_next_gameweek(
  p_league_id uuid,
  p_completed_gameweek smallint
) returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_next_gameweek integer;
begin
  if not private.gameweek_scoring_fixtures_final(
    p_league_id,
    p_completed_gameweek
  ) then
    return null;
  end if;

  perform private.refresh_league_calendar(p_league_id);

  select transaction_window.gameweek
  into v_next_gameweek
  from public.league_transaction_windows transaction_window
  where transaction_window.league_id = p_league_id
  order by transaction_window.gameweek desc
  limit 1;

  if v_next_gameweek is null
    or v_next_gameweek <= p_completed_gameweek
  then
    return null;
  end if;

  insert into public.league_player_scores (
    league_id,
    gameweek,
    player_id,
    status,
    source,
    source_updated_at,
    updated_at
  )
  select
    league.id,
    v_next_gameweek,
    player.id,
    'not_started',
    'gameweek-rollover',
    now(),
    now()
  from public.leagues league
  join public.players player
    on player.active
   and (
     (
       league.player_pool = 'All Top Five'
       and player.competition in (
         'Premier League',
         'La Liga',
         'Serie A',
         'Bundesliga',
         'Ligue 1'
       )
     )
     or player.competition = league.player_pool
   )
  where league.id = p_league_id
  on conflict (league_id, gameweek, player_id) do nothing;

  perform private.randomize_gameweek_waiver_priority(
    p_league_id,
    v_next_gameweek
  );

  return v_next_gameweek;
end;
$function$;

revoke all on function private.open_next_gameweek(uuid, smallint)
from public, anon, authenticated;

-- The order is now established when the week opens. Thursday processes claims
-- using that published order and must never silently redraw it.
create or replace function private.process_due_waivers()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  w public.league_transaction_windows%rowtype;
  c record;
  v_success integer := 0;
  v_max integer;
  v_budget bigint;
begin
  for w in
    select transaction_window.*
    from public.league_transaction_windows transaction_window
    where transaction_window.processed_at is null
      and transaction_window.waiver_process_at <= now()
    order by transaction_window.waiver_process_at
    for update skip locked
  loop
    perform pg_advisory_xact_lock(hashtextextended(w.league_id::text, 0));

    if w.priority_randomized_at is null then
      perform private.randomize_gameweek_waiver_priority(
        w.league_id,
        w.gameweek
      );
    end if;

    if exists (
      select 1
      from public.leagues
      where id = w.league_id and game_format = 'auction'
    ) then
      loop
        select offer.* into c
        from public.auction_contract_offers offer
        join public.league_members member
          on member.league_id = offer.league_id
         and member.user_id = offer.user_id
        where offer.league_id = w.league_id
          and offer.gameweek = w.gameweek
          and offer.status = 'pending'
        order by
          offer.amount desc,
          member.waiver_priority,
          offer.offer_rank,
          offer.created_at
        limit 1
        for update of offer skip locked;

        exit when not found;

        select remaining_budget into v_budget
        from public.auction_budgets
        where league_id = w.league_id and user_id = c.user_id
        for update;

        if exists (
          select 1 from public.draft_picks
          where league_id = w.league_id and player_id = c.add_player_id
        ) then
          update public.auction_contract_offers
          set status = 'unsuccessful', processed_at = now(),
              note = 'Player signed through an earlier offer'
          where id = c.id;
        elsif coalesce(v_budget, 0) < c.amount then
          update public.auction_contract_offers
          set status = 'unsuccessful', processed_at = now(),
              note = 'Insufficient contract budget when processed'
          where id = c.id;
        elsif not exists (
          select 1 from public.draft_picks
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.release_player_id
        ) then
          update public.auction_contract_offers
          set status = 'unsuccessful', processed_at = now(),
              note = 'Release player is no longer under contract'
          where id = c.id;
        elsif not private.roster_is_legal(
          w.league_id,
          c.user_id,
          array[c.release_player_id],
          array[c.add_player_id]
        ) then
          update public.auction_contract_offers
          set status = 'unsuccessful', processed_at = now(),
              note = 'Roster limits would be exceeded'
          where id = c.id;
        else
          delete from public.lineup_players
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.release_player_id;

          update public.draft_picks
          set player_id = c.add_player_id,
              picked_at = now(),
              auto_picked = false,
              auction_price = c.amount
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.release_player_id;

          update public.auction_budgets
          set remaining_budget = remaining_budget - c.amount
          where league_id = w.league_id and user_id = c.user_id;

          update public.auction_contract_offers
          set status = 'awarded', processed_at = now(), note = 'Contract awarded'
          where id = c.id;

          update public.auction_contract_offers
          set status = 'unsuccessful', processed_at = now(),
              note = 'Player signed by another manager'
          where league_id = w.league_id
            and gameweek = w.gameweek
            and add_player_id = c.add_player_id
            and status = 'pending';

          select coalesce(max(waiver_priority), 0) + 1 into v_max
          from public.league_members where league_id = w.league_id;
          update public.league_members
          set waiver_priority = v_max
          where league_id = w.league_id and user_id = c.user_id;
          v_success := v_success + 1;
        end if;
      end loop;
    else
      loop
        select claim.* into c
        from public.waiver_claims claim
        join public.league_members member
          on member.league_id = claim.league_id
         and member.user_id = claim.user_id
        where claim.league_id = w.league_id
          and claim.gameweek = w.gameweek
          and claim.status = 'pending'
        order by
          member.waiver_priority,
          claim.claim_rank,
          claim.created_at
        limit 1
        for update of claim skip locked;

        exit when not found;

        if exists (
          select 1 from public.draft_picks
          where league_id = w.league_id and player_id = c.add_player_id
        ) then
          update public.waiver_claims
          set status = 'unsuccessful', processed_at = now(),
              note = 'Player was claimed earlier'
          where id = c.id;
        elsif not exists (
          select 1 from public.draft_picks
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.drop_player_id
        ) then
          update public.waiver_claims
          set status = 'unsuccessful', processed_at = now(),
              note = 'Drop player is no longer owned'
          where id = c.id;
        elsif not private.roster_is_legal(
          w.league_id,
          c.user_id,
          array[c.drop_player_id],
          array[c.add_player_id]
        ) then
          update public.waiver_claims
          set status = 'unsuccessful', processed_at = now(),
              note = 'Roster limits would be exceeded'
          where id = c.id;
        else
          delete from public.lineup_players
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.drop_player_id;

          update public.draft_picks
          set player_id = c.add_player_id,
              picked_at = now(),
              auto_picked = false
          where league_id = w.league_id
            and user_id = c.user_id
            and player_id = c.drop_player_id;

          update public.waiver_claims
          set status = 'successful', processed_at = now()
          where id = c.id;

          select coalesce(max(waiver_priority), 0) + 1 into v_max
          from public.league_members where league_id = w.league_id;
          update public.league_members
          set waiver_priority = v_max
          where league_id = w.league_id and user_id = c.user_id;
          v_success := v_success + 1;
        end if;
      end loop;
    end if;

    update public.league_transaction_windows
    set processed_at = now(), updated_at = now()
    where id = w.id;
  end loop;

  return v_success;
end;
$function$;

revoke all on function private.process_due_waivers()
from public, anon, authenticated;

-- Establish the visible order for any unprocessed window that opened before
-- this migration, including the live Gameweek 2 waiver period.
do $function$
declare
  transaction_window record;
begin
  for transaction_window in
    select league_id, gameweek
    from public.league_transaction_windows
    where processed_at is null
      and priority_randomized_at is null
      and now() < roster_lock_at
  loop
    perform private.randomize_gameweek_waiver_priority(
      transaction_window.league_id,
      transaction_window.gameweek
    );
  end loop;
end;
$function$;

commit;
