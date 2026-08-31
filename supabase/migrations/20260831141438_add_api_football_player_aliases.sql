begin;

create table public.api_football_player_aliases (
  api_football_id bigint primary key,
  player_id bigint not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index api_football_player_aliases_player_idx
  on public.api_football_player_aliases(player_id);

alter table public.api_football_player_aliases enable row level security;
revoke all on public.api_football_player_aliases from public, anon, authenticated;
grant select, insert, update, delete on public.api_football_player_aliases to service_role;

create or replace function public.resolve_api_football_player_mappings(
  p_api_ids bigint[]
) returns table(id bigint, api_football_id bigint)
language sql
stable
security invoker
set search_path = ''
as $function$
  with candidates as (
    select player.id, player.api_football_id, 0 as priority
    from public.players player
    where player.api_football_id = any(p_api_ids)

    union all

    select alias.player_id, alias.api_football_id, 1 as priority
    from public.api_football_player_aliases alias
    where alias.api_football_id = any(p_api_ids)
  )
  select distinct on (candidate.api_football_id)
    candidate.id,
    candidate.api_football_id
  from candidates candidate
  order by candidate.api_football_id, candidate.priority;
$function$;

revoke all on function public.resolve_api_football_player_mappings(bigint[])
  from public, anon, authenticated;
grant execute on function public.resolve_api_football_player_mappings(bigint[])
  to service_role;

-- API-Football's squad feed still identifies Jacquet as 367636, while the
-- fixture-player feed uses 527943. Keep the squad identity canonical and map
-- the fixture identity as an alias so future pool syncs cannot undo the fix.
insert into public.api_football_player_aliases(api_football_id, player_id)
select 527943, player.id
from public.players player
where player.api_football_id = 367636
  and player.full_name ilike '%Jacquet%'
  and player.club = 'Liverpool'
on conflict (api_football_id) do update
set player_id = excluded.player_id,
    updated_at = now();

commit;
