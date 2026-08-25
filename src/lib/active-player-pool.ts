import { supabase } from "@/lib/supabase";

export type ActivePoolPlayer = {
  id: number;
  full_name: string;
  position: string;
  club: string;
  competition: string;
  draft_rank: number | null;
  photo_url?: string | null;
  injured?: boolean;
  injury_type?: string | null;
  injury_reason?: string | null;
  expected_return?: string | null;
  fotmob_expected_return?: string | null;
};

const PAGE_SIZE = 1000;

export async function loadActivePlayerPool(competition?: string) {
  const players: ActivePoolPlayer[] = [];
  let offset = 0;

  while (true) {
    let request = supabase
      .from("players")
      .select("id,full_name,position,club,competition,draft_rank,photo_url,injured,injury_type,injury_reason,expected_return,fotmob_expected_return")
      .eq("active", true)
      .order("draft_rank", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (competition && competition !== "All Top Five") {
      request = request.eq("competition", competition);
    }

    const { data, error } = await request;
    if (error) return { data: players, error };

    const page = (data ?? []) as ActivePoolPlayer[];
    players.push(...page);
    if (page.length < PAGE_SIZE) return { data: players, error: null };
    offset += PAGE_SIZE;
  }
}
