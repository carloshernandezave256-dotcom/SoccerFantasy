"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiFootballTest } from "@/components/api-football-test";
import { FinalizedGameweekControls } from "@/components/finalized-gameweek-controls";
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
          <FinalizedGameweekControls leagueId={leagueId} />
          <section className="panel settings-form">
            <div className="section-row"><div><p className="eyebrow">ALTERNATIVE DATA TEST</p><h2>Provider Lab</h2></div><span className="muted-chip">READ ONLY</span></div>
            <p>Run FotMob match payloads through the real My Fantasy XI calculator without updating production scores or player records.</p>
            <Link className="secondary-button full-button" href="/provider-lab">Open isolated Provider Lab</Link>
          </section>
        </>
      )}
    </PageShell>
  );
}
