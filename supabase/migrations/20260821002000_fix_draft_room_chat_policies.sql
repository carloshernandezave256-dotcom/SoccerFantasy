begin;

drop policy if exists "league members read draft chat"
on public.draft_room_messages;

create policy "league members read draft chat"
on public.draft_room_messages
for select
to authenticated
using ((select private.is_league_member(league_id)));

drop policy if exists "league members send draft chat"
on public.draft_room_messages;

create policy "league members send draft chat"
on public.draft_room_messages
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_league_member(league_id))
);

commit;
