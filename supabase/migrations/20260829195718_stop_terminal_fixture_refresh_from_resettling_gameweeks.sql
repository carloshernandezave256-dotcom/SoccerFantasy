begin;

-- Fixture rows use each provider competition's official round number. They must
-- never run fantasy-week settlement directly: Bundesliga round 1 can belong to
-- Fantasy GW2, and replaying a terminal fixture can otherwise target a locked
-- historical week. settle_final_gameweek is the single owner of auto-subs and
-- only runs after every fixture in the fantasy scoring window is terminal.
drop trigger if exists apply_final_fixture_auto_substitutions
  on public.league_headline_fixtures;

drop function if exists private.apply_final_fixture_auto_substitutions();

commit;
