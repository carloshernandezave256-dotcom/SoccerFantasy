-- Restore the season-long fantasy classification that was in effect at the
-- draft. The provider's later squad feed described Ngumoha as a midfielder,
-- which made otherwise like-for-like waiver claims fail roster validation.
update public.players
set position = 'FWD'::public.player_position
where api_football_id = 452685
  and full_name ilike '%Ngumoha%';
