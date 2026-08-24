import { supabase } from "@/lib/supabase";

export type PlayerSeasonTotal = {
  player_id: number;
  points: number;
  appearances: number;
  minutes: number;
  goals: number;
  assists: number;
  shots_on_target: number;
  completed_passes: number;
  tackles_won: number;
  saves: number;
  clean_sheets: number;
  yellow_cards: number;
  red_cards: number;
  latest_gameweek: number | null;
  latest_status: string | null;
};

const PAGE_SIZE = 1000;

export async function loadPlayerSeasonTotals() {
  const totals: PlayerSeasonTotal[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .rpc("player_season_totals")
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) return { data: totals, error };

    const page = (data ?? []) as PlayerSeasonTotal[];
    totals.push(...page);
    if (page.length < PAGE_SIZE) return { data: totals, error: null };
  }
}
