begin;

create table public.draft_room_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300 and body = btrim(body)),
  created_at timestamptz not null default now()
);

create index draft_room_messages_league_created_idx
  on public.draft_room_messages (league_id, created_at desc);

alter table public.draft_room_messages enable row level security;

create policy "league members read draft chat"
on public.draft_room_messages for select to authenticated
using (
  exists (
    select 1 from public.league_members member
    where member.league_id = draft_room_messages.league_id
      and member.user_id = (select auth.uid())
  )
);

create policy "league members send draft chat"
on public.draft_room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.league_members member
    where member.league_id = draft_room_messages.league_id
      and member.user_id = (select auth.uid())
  )
);

revoke all on table public.draft_room_messages from anon;
grant select, insert on table public.draft_room_messages to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'draft_room_messages'
  ) then
    alter publication supabase_realtime add table public.draft_room_messages;
  end if;
end
$$;

commit;
