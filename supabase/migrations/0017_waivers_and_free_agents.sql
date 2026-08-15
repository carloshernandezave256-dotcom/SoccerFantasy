create type public.waiver_status as enum ('pending','successful','unsuccessful','cancelled');

alter table public.league_members add column waiver_priority integer;
update public.league_members set waiver_priority = coalesce(draft_slot, 999) where waiver_priority is null;
alter table public.league_members alter column waiver_priority set not null;

create table public.waiver_claims(
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  add_player_id bigint not null references public.players(id),
  drop_player_id bigint references public.players(id),
  status public.waiver_status not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  note text,
  check(add_player_id is distinct from drop_player_id)
);

create index waiver_claims_process_idx on public.waiver_claims(league_id,status,created_at);
create index waiver_claims_user_idx on public.waiver_claims(user_id,created_at desc);
alter table public.waiver_claims enable row level security;
grant select on public.waiver_claims to authenticated;

create policy "managers read own waiver claims"
on public.waiver_claims for select to authenticated
using ((select auth.uid()) = user_id or exists(
  select 1 from public.leagues l where l.id = waiver_claims.league_id and l.commissioner_id = (select auth.uid())
));

create or replace function public.submit_waiver_claim(p_league_id uuid,p_add_player_id bigint,p_drop_player_id bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_claim uuid; v_roster_count integer;
begin
  if v_user is null or not private.is_league_member(p_league_id) then raise exception 'League membership required'; end if;
  if not exists(select 1 from public.drafts where league_id=p_league_id and status='complete') then raise exception 'Waivers open after the draft is complete'; end if;
  if not exists(select 1 from public.players where id=p_add_player_id and active) then raise exception 'Player is unavailable'; end if;
  if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=p_add_player_id) then raise exception 'That player is already owned'; end if;
  select count(*) into v_roster_count from public.draft_picks where league_id=p_league_id and user_id=v_user;
  if v_roster_count>=18 and p_drop_player_id is null then raise exception 'Select a player to drop'; end if;
  if p_drop_player_id is not null and not exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_user and player_id=p_drop_player_id) then raise exception 'You do not own the selected drop player'; end if;
  if exists(select 1 from public.waiver_claims where league_id=p_league_id and user_id=v_user and add_player_id=p_add_player_id and status='pending') then raise exception 'You already claimed this player'; end if;
  insert into public.waiver_claims(league_id,user_id,add_player_id,drop_player_id) values(p_league_id,v_user,p_add_player_id,p_drop_player_id) returning id into v_claim;
  return v_claim;
end$$;

create or replace function public.cancel_waiver_claim(p_claim_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.waiver_claims set status='cancelled',processed_at=now()
  where id=p_claim_id and user_id=(select auth.uid()) and status='pending';
  if not found then raise exception 'Pending claim not found'; end if;
end$$;

create or replace function public.process_waivers(p_league_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_claim public.waiver_claims%rowtype; v_success integer:=0; v_max integer;
begin
  if not exists(select 1 from public.leagues where id=p_league_id and commissioner_id=v_user) then raise exception 'Only the commissioner can process waivers'; end if;
  for v_claim in
    select c.* from public.waiver_claims c join public.league_members m on m.league_id=c.league_id and m.user_id=c.user_id
    where c.league_id=p_league_id and c.status='pending'
    order by m.waiver_priority,c.created_at
    for update of c
  loop
    if exists(select 1 from public.draft_picks where league_id=p_league_id and player_id=v_claim.add_player_id) then
      update public.waiver_claims set status='unsuccessful',processed_at=now(),note='Player was claimed earlier' where id=v_claim.id;
      continue;
    end if;
    if v_claim.drop_player_id is not null and exists(select 1 from public.draft_picks where league_id=p_league_id and user_id=v_claim.user_id and player_id=v_claim.drop_player_id) then
      delete from public.lineup_players where league_id=p_league_id and user_id=v_claim.user_id and player_id=v_claim.drop_player_id;
      update public.draft_picks set player_id=v_claim.add_player_id,picked_at=now(),auto_picked=false
      where league_id=p_league_id and user_id=v_claim.user_id and player_id=v_claim.drop_player_id;
    elsif (select count(*) from public.draft_picks where league_id=p_league_id and user_id=v_claim.user_id)<18 then
      insert into public.draft_picks(draft_id,league_id,pick_number,round,user_id,player_id)
      select d.id,p_league_id,coalesce((select max(pick_number)+1 from public.draft_picks where draft_id=d.id),1),18,v_claim.user_id,v_claim.add_player_id from public.drafts d where d.league_id=p_league_id;
    else
      update public.waiver_claims set status='unsuccessful',processed_at=now(),note='Drop player is no longer owned' where id=v_claim.id;
      continue;
    end if;
    update public.waiver_claims set status='successful',processed_at=now() where id=v_claim.id;
    select coalesce(max(waiver_priority),0)+1 into v_max from public.league_members where league_id=p_league_id;
    update public.league_members set waiver_priority=v_max where league_id=p_league_id and user_id=v_claim.user_id;
    v_success:=v_success+1;
  end loop;
  return v_success;
end$$;

create or replace function public.waiver_priority(p_league_id uuid)
returns table(rank bigint,user_id uuid,team_name text) language sql security definer set search_path='' stable as $$
  select row_number() over(order by m.waiver_priority,m.draft_slot),m.user_id,m.team_name
  from public.league_members m
  where m.league_id=p_league_id and private.is_league_member(p_league_id)
  order by m.waiver_priority,m.draft_slot
$$;

revoke all on function public.submit_waiver_claim(uuid,bigint,bigint),public.cancel_waiver_claim(uuid),public.process_waivers(uuid),public.waiver_priority(uuid) from public,anon;
grant execute on function public.submit_waiver_claim(uuid,bigint,bigint),public.cancel_waiver_claim(uuid),public.process_waivers(uuid),public.waiver_priority(uuid) to authenticated;
