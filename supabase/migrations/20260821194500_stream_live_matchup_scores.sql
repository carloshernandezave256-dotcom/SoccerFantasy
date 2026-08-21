-- Matchup clients listen for score changes instead of requiring a page reload.
-- Keep the existing RLS policies in force; Realtime only delivers rows that the
-- authenticated league member is already allowed to select.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_player_scores'
  ) then
    alter publication supabase_realtime add table public.league_player_scores;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'league_matchups'
  ) then
    alter publication supabase_realtime add table public.league_matchups;
  end if;
end
$$;
