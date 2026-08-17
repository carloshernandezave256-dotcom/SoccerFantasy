"use client";

import { useEffect, useState } from "react";
import { AuctionRoom } from "./auction-room";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";

export function ActiveAuctionRoom({
  requestedLeagueId,
}: {
  requestedLeagueId?: string;
}) {
  const [leagueId, setLeagueId] = useState("");
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.rpc("my_leagues");
      const active = resolveActiveLeague(
        (data ?? []) as { league_id: string; game_format: string }[],
        requestedLeagueId,
      );
      if (active?.game_format !== "auction") {
        window.location.replace(`/league?league=${active?.league_id ?? ""}`);
        return;
      }
      setLeagueId(active.league_id);
    })();
  }, [requestedLeagueId]);
  if (!leagueId) return <main className="app-shell">Loading auction…</main>;
  return <AuctionRoom leagueId={leagueId} />;
}
