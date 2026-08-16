do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='lineup_players'
  ) then
    alter publication supabase_realtime add table public.lineup_players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='pack_cards'
  ) then
    alter publication supabase_realtime add table public.pack_cards;
  end if;
end$$;
