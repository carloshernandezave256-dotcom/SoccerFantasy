-- Every packed card is permanently stored in the collection. While an active
-- squad has room, newly packed unique players also enter My Team automatically.
create or replace function private.assign_pack_card_active_slot()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_slot smallint;
begin
  if new.active_slot is null
    and not exists(
      select 1 from public.pack_cards
      where league_id=new.league_id and user_id=new.user_id
        and player_id=new.player_id and active_slot is not null
    ) then
    select s::smallint into v_slot
    from generate_series(1,18) s
    where not exists(
      select 1 from public.pack_cards
      where league_id=new.league_id and user_id=new.user_id and active_slot=s
    )
    order by s limit 1;
    new.active_slot:=v_slot;
  end if;
  return new;
end$$;

drop trigger if exists assign_pack_card_active_slot on public.pack_cards;
create trigger assign_pack_card_active_slot
before insert on public.pack_cards
for each row execute function private.assign_pack_card_active_slot();

-- Bring existing collections that never chose an active squad into My Team.
with unique_cards as (
  select distinct on(pc.league_id,pc.user_id,pc.player_id)
    pc.id,pc.league_id,pc.user_id,pc.acquired_at
  from public.pack_cards pc
  where not exists(
    select 1 from public.pack_cards active
    where active.league_id=pc.league_id and active.user_id=pc.user_id
      and active.active_slot is not null
  )
  order by pc.league_id,pc.user_id,pc.player_id,pc.acquired_at,pc.id
), ranked as (
  select id,row_number() over(partition by league_id,user_id order by acquired_at,id)::smallint as slot
  from unique_cards
)
update public.pack_cards card set active_slot=ranked.slot
from ranked where card.id=ranked.id and ranked.slot<=18;

create or replace function public.set_pack_active_squad(p_league_id uuid,p_card_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_owned int;v_unique int;
begin
  if cardinality(p_card_ids)>18 then raise exception 'Active squad is limited to 18 cards';end if;
  select count(*),count(distinct player_id) into v_owned,v_unique
  from public.pack_cards
  where league_id=p_league_id and user_id=v_user and id=any(p_card_ids);
  if v_owned<>cardinality(p_card_ids) then raise exception 'One or more cards are not yours';end if;
  if v_unique<>v_owned then raise exception 'Only one copy of a player can be active';end if;

  update public.pack_cards set active_slot=null where league_id=p_league_id and user_id=v_user;
  update public.pack_cards c set active_slot=x.ord
  from unnest(p_card_ids) with ordinality x(id,ord)
  where c.id=x.id and c.league_id=p_league_id and c.user_id=v_user;

  -- A changed roster needs a fresh valid XI; packed cards remain untouched.
  delete from public.lineup_players where league_id=p_league_id and user_id=v_user;
  return v_owned;
end$$;

revoke all on function private.assign_pack_card_active_slot() from public,anon,authenticated;
revoke all on function public.set_pack_active_squad(uuid,uuid[]) from public,anon;
grant execute on function public.set_pack_active_squad(uuid,uuid[]) to authenticated;
