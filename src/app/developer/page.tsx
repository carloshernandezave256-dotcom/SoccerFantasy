"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiFootballTest } from "@/components/api-football-test";
import { PageShell } from "@/components/page-shell";
import { resolveActiveLeague } from "@/lib/active-league";
import { supabase } from "@/lib/supabase";

type League = {
  league_id: string;
  league_name: string;
  game_format: "draft" | "pack" | "auction";
};

export default function DeveloperPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueId, setLeagueId] = useState("");

  useEffect(() => {
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.replace("/login?next=/developer");
        return;
      }
      const access = await fetch("/api/developer/access", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      if (!access.ok) {
        setLoading(false);
        return;
      }
      const { data } = await supabase.rpc("my_leagues");
      const list = (data ?? []) as League[];
      const active = resolveActiveLeague(list);
      setLeagues(list);
      setLeagueId(active?.league_id ?? list[0]?.league_id ?? "");
      setAllowed(true);
      setLoading(false);
    })();
  }, [router]);

  return (
    <PageShell eyebrow="OWNER TOOLS" title="Developer">
      {loading ? (
        <section className="panel empty-state">Checking developer access…</section>
      ) : !allowed ? (
        <section className="panel empty-state">
          <strong>Developer access only.</strong>
          <p>This page is restricted to the XI Fantasy developer account.</p>
        </section>
      ) : (
        <>
          <section className="panel">
            <p className="eyebrow">TARGET LEAGUE</p>
            <h2>Score synchronization</h2>
            <label className="settings-field">
              <span>
                <strong>League</strong>
                <small>Player and name syncs remain global.</small>
              </span>
              <select
                value={leagueId}
                onChange={(event) => setLeagueId(event.target.value)}
              >
                {leagues.map((league) => (
                  <option key={league.league_id} value={league.league_id}>
                    {league.league_name} · {league.game_format}
                  </option>
                ))}
              </select>
            </label>
            {!leagues.length ? (
              <p className="form-message">
                Create a league before running a score synchronization.
              </p>
            ) : null}
          </section>
          <ApiFootballTest leagueId={leagueId} />
        </>
      )}
    </PageShell>
  );
}
