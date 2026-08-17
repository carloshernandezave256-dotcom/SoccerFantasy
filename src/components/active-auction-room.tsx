"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuctionRoom } from "./auction-room";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague, setActiveLeagueId } from "@/lib/active-league";

export function ActiveAuctionRoom({
  requestedLeagueId,
}: {
  requestedLeagueId?: string;
}) {
  const [leagueId, setLeagueId] = useState("");
  const [error, setError] = useState("");
  const searchParams = useSearchParams();
  const urlLeagueId = searchParams.get("league") ?? requestedLeagueId ?? "";

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setError("");
      const { data, error: leagueError } = await supabase.rpc("my_leagues");
      if (cancelled) return;
      if (leagueError) {
        setError(`The Auction Room could not load: ${leagueError.message}`);
        return;
      }
      const leagues = (data ?? []) as {
        league_id: string;
        game_format: string;
      }[];
      const active = urlLeagueId
        ? leagues.find((league) => league.league_id === urlLeagueId)
        : resolveActiveLeague(leagues);
      if (!active) {
        setError("This league is not available to your account.");
        return;
      }
      if (active.game_format !== "auction") {
        setError("The selected league is not an Auction League.");
        return;
      }
      setActiveLeagueId(active.league_id);
      setLeagueId(active.league_id);
    })();
    return () => {
      cancelled = true;
    };
  }, [urlLeagueId]);

  if (error)
    return (
      <main className="app-shell">
        <section className="panel empty-state">
          <p className="eyebrow">AUCTION ROOM</p>
          <h2>We kept you on the right page</h2>
          <p>{error}</p>
          <Link className="primary-button full-button" href="/league">
            Choose a league
          </Link>
        </section>
      </main>
    );
  if (!leagueId) return <main className="app-shell">Loading auction…</main>;
  return <AuctionRoom leagueId={leagueId} />;
}
