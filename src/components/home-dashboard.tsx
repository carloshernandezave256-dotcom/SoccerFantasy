"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccountMenu } from "./account-menu";
import { BottomNav } from "./bottom-nav";
import { PlayerStatsDialog } from "./player-stats-dialog";
import { resolveActiveLeague } from "@/lib/active-league";
import { supabase } from "@/lib/supabase";
import { useLanguage } from "@/lib/i18n";
import { loadPlayerSeasonTotals } from "@/lib/player-season-totals";

type League = {
  league_id: string;
  league_name: string;
  league_size: number;
  manager_count: number;
  team_name: string;
  game_format: string;
};
type Draft = {
  status: "waiting" | "live" | "paused" | "complete";
  current_pick: number;
  pick_deadline: string | null;
};
type Manager = { draft_slot: number; user_id: string; team_name: string };
type Pick = {
  id: number;
  pick_number: number;
  user_id: string;
  auto_picked: boolean;
  players?: { full_name: string; position: string; club: string } | null;
};
type Matchup = {
  id: string;
  gameweek: number;
  home_user_id: string;
  away_user_id: string;
  home_score: number | string;
  away_score: number | string;
  status: "scheduled" | "live" | "final";
};
type Standing = {
  rank: number;
  user_id: string;
  team_name: string;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};
type WindowState = { gameweek: number; phase: string };
type ScoreRow = {
  player_id: number;
  points: number;
  latest_gameweek: number | null;
  latest_status: string | null;
  goals: number;
  assists: number;
};
type PlayerPulse = {
  id: number;
  name: string;
  club: string;
  position: string;
  competition: string;
  photo_url: string | null;
  gameweek: number;
  points: number;
  goals: number;
  assists: number;
  status: string;
};
type RealFixture = {
  fixture_id: number;
  gameweek: number;
  competition: string;
  round_name: string;
  kickoff: string;
  status: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
};

const headlineClubWeights: Array<[string, number]> = [
  ["real madrid", 10],
  ["barcelona", 10],
  ["manchester city", 10],
  ["liverpool", 10],
  ["bayern", 10],
  ["paris saint germain", 10],
  ["psg", 10],
  ["inter", 9],
  ["ac milan", 9],
  ["juventus", 9],
  ["arsenal", 9],
  ["manchester united", 9],
  ["atletico madrid", 9],
  ["atlético madrid", 9],
  ["borussia dortmund", 8],
  ["napoli", 8],
  ["chelsea", 8],
  ["tottenham", 8],
  ["marseille", 8],
  ["roma", 7],
  ["lazio", 7],
  ["lyon", 7],
  ["monaco", 7],
  ["bayer leverkusen", 7],
];

function headlineWeight(name: string) {
  const normalized = name.toLowerCase();
  return (
    headlineClubWeights.find(([club]) => normalized.includes(club))?.[1] ?? 0
  );
}
function fixtureHasStarted(status: string) {
  return !["TBD", "NS", "PST", "CANC", "ABD", "AWD", "WO"].includes(status);
}
function fixtureIsFinal(status: string) {
  return ["FT", "AET", "PEN"].includes(status);
}
function fixtureDisplayPriority(status: string) {
  if (fixtureHasStarted(status) && !fixtureIsFinal(status)) return 0;
  if (!fixtureHasStarted(status)) return 1;
  return 2;
}
function pulseStatus(status: string) {
  const normalized = status.toLowerCase().replaceAll("_", " ");
  if (normalized.includes("pending"))
    return { label: "STATS PENDING", tone: "pending" };
  if (["final", "ft", "aet", "pen"].includes(normalized))
    return { label: "FT", tone: "final" };
  if (["not started", "scheduled", "ns", "tbd"].includes(normalized))
    return { label: "UPCOMING", tone: "scheduled" };
  return { label: "LIVE", tone: "live" };
}

function managerAtPick(order: Manager[], pickNumber: number) {
  if (!order.length) return undefined;
  const round = Math.floor((pickNumber - 1) / order.length) + 1,
    index = (pickNumber - 1) % order.length,
    slot = round % 2 ? index + 1 : order.length - index;
  return order.find((manager) => manager.draft_slot === slot);
}

export function HomeDashboard() {
  const { t } = useLanguage();
  const [league, setLeague] = useState<League | null>(null),
    [draft, setDraft] = useState<Draft | null>(null),
    [order, setOrder] = useState<Manager[]>([]),
    [picks, setPicks] = useState<Pick[]>([]),
    [matchup, setMatchup] = useState<Matchup | null>(null),
    [playerPulse, setPlayerPulse] = useState<PlayerPulse[]>([]),
    [statsPlayer, setStatsPlayer] = useState<PlayerPulse | null>(null),
    [headlineFixtures, setHeadlineFixtures] = useState<RealFixture[]>([]),
    [standings, setStandings] = useState<Standing[]>([]),
    [windowState, setWindowState] = useState<WindowState | null>(null);
  const [lineupCount, setLineupCount] = useState(0),
    [hasCaptain, setHasCaptain] = useState(false),
    [rosterCount, setRosterCount] = useState(0),
    [unreadTrades, setUnreadTrades] = useState(0);
  const [userId, setUserId] = useState<string | null>(null),
    [name, setName] = useState("Manager"),
    [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false),
    [signedIn, setSignedIn] = useState(true),
    [now, setNow] = useState(Date.now());
  const refreshTimer = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSignedIn(false);
      setLoading(false);
      return;
    }
    setUserId(user.id);
    setName(
      String(
        user.user_metadata?.display_name ??
          user.email?.split("@")[0] ??
          "Manager",
      ),
    );
    const { data: leagueData } = await supabase.rpc("my_leagues");
    const active =
      resolveActiveLeague(
        (leagueData ?? []) as League[],
        new URLSearchParams(window.location.search).get("league"),
      ) ?? null;
    setLeague(active);
    if (!active) {
      setLoading(false);
      return;
    }
    const today = new Date(),
      dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()),
      dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const [d, o, p, t, l, c, w, s, m, scoreResult, fixtureResult] =
      await Promise.all([
        supabase
          .from("drafts")
          .select("status,current_pick,pick_deadline")
          .eq("league_id", active.league_id)
          .maybeSingle(),
        supabase.rpc("draft_order", { p_league_id: active.league_id }),
        supabase
          .from("draft_picks")
          .select(
            "id,pick_number,user_id,auto_picked,players(full_name,position,club)",
          )
          .eq("league_id", active.league_id)
          .order("pick_number", { ascending: false }),
        supabase.rpc("unread_trade_count", { p_league_id: active.league_id }),
        supabase
          .from("lineup_players")
          .select("is_starter,is_captain")
          .eq("league_id", active.league_id)
          .eq("user_id", user.id),
        supabase
          .from("pack_cards")
          .select("id", { count: "exact", head: true })
          .eq("league_id", active.league_id)
          .eq("user_id", user.id)
          .not("active_slot", "is", null),
        supabase.rpc("transaction_window", { p_league_id: active.league_id }),
        supabase.rpc("league_standings", { p_league_id: active.league_id }),
        supabase
          .from("league_matchups")
          .select(
            "id,gameweek,home_user_id,away_user_id,home_score,away_score,status",
          )
          .eq("league_id", active.league_id)
          .order("gameweek", { ascending: false }),
        loadPlayerSeasonTotals(),
        supabase
          .from("league_headline_fixtures")
          .select(
            "fixture_id,gameweek,competition,round_name,kickoff,status,home_team,away_team,home_score,away_score",
          )
          .eq("league_id", active.league_id)
          .gte("kickoff", dayStart.toISOString())
          .lt("kickoff", dayEnd.toISOString())
          .order("kickoff", { ascending: true }),
      ]);
    const pickData = (p.data ?? []) as unknown as Pick[],
      lineup = (l.data ?? []) as { is_starter: boolean; is_captain: boolean }[],
      matches = (m.data ?? []) as Matchup[],
      transactionWindow =
        ((w.data ?? [])[0] as WindowState | undefined) ?? null,
      scoreRows = (scoreResult.data ?? []) as unknown as ScoreRow[],
      nonzeroScoreRows = scoreRows.filter(row=>Number(row.points)!==0),
      scoredPlayerIds = nonzeroScoreRows.map(row=>row.player_id),
      {data:pulsePlayers}=scoredPlayerIds.length?await supabase.from("players").select("id,full_name,position,club,competition,photo_url").in("id",scoredPlayerIds):{data:[]},
      pulsePlayerMap=new Map((pulsePlayers??[]).map(player=>[player.id,player])),
      pulse = nonzeroScoreRows
        .filter((row) => pulsePlayerMap.has(row.player_id))
        .map((row) => {
          const player=pulsePlayerMap.get(row.player_id)!;
          return {
          id: player.id,
          name: player.full_name,
          club: player.club,
          position: player.position,
          competition: player.competition,
          photo_url: player.photo_url,
          gameweek: row.latest_gameweek??0,
          goals: row.goals,
          assists: row.assists,
          status: row.latest_status??"NS",
          points: Number(row.points),
        }})
        .sort((a, b) => b.points - a.points)
        .slice(0, 5);
    setDraft((d.data as Draft | null) ?? null);
    setOrder((o.data ?? []) as Manager[]);
    setPicks(pickData);
    setUnreadTrades(Number(t.data ?? 0));
    setLineupCount(lineup.filter((row) => row.is_starter).length);
    setHasCaptain(lineup.some((row) => row.is_captain));
    setRosterCount(
      active.game_format === "pack"
        ? Number(c.count ?? 0)
        : pickData.filter((row) => row.user_id === user.id).length,
    );
    setWindowState(transactionWindow);
    setStandings((s.data ?? []) as Standing[]);
    setPlayerPulse(pulse);
    setHeadlineFixtures((fixtureResult.data ?? []) as RealFixture[]);
    const myMatches = matches.filter(
      (x) => x.home_user_id === user.id || x.away_user_id === user.id,
    );
    const nextScheduledMatch = [...myMatches]
      .filter((x) => x.status === "scheduled")
      .sort((a, b) => a.gameweek - b.gameweek)[0];
    setMatchup(
      (transactionWindow
        ? myMatches.find((x) => x.gameweek === transactionWindow.gameweek)
        : null) ??
        myMatches.find((x) => x.status === "live") ??
        nextScheduledMatch ??
        myMatches[0] ??
        null,
    );
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!league) return;
    const refresh = () => {
      setRefreshing(true);
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        void load().finally(() => setRefreshing(false));
      }, 400);
    };
    const channel = supabase
      .channel(`home:${league.league_id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "drafts",
          filter: `league_id=eq.${league.league_id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_picks",
          filter: `league_id=eq.${league.league_id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_matchups",
          filter: `league_id=eq.${league.league_id}`,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_player_scores",
          filter: `league_id=eq.${league.league_id}`,
        },
        refresh,
      )
      .subscribe();
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 15000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(heartbeat);
      window.clearTimeout(refreshTimer.current);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void supabase.removeChannel(channel);
    };
  }, [league, load]);

  const current = draft ? managerAtPick(order, draft.current_pick) : undefined,
    isMyTurn = draft?.status === "live" && current?.user_id === userId,
    seconds = draft?.pick_deadline
      ? Math.max(
          0,
          Math.ceil((new Date(draft.pick_deadline).getTime() - now) / 1000),
        )
      : 0,
    totalPicks = Math.max(1, order.length * 18),
    progress = draft
      ? Math.min(100, ((draft.current_pick - 1) / totalPicks) * 100)
      : 0;
  const opponentId = matchup
      ? matchup.home_user_id === userId
        ? matchup.away_user_id
        : matchup.home_user_id
      : null,
    opponent =
      order.find((x) => x.user_id === opponentId)?.team_name ?? "Opponent",
    myScore = matchup
      ? Number(
          matchup.home_user_id === userId
            ? matchup.home_score
            : matchup.away_score,
        )
      : 0,
    opponentScore = matchup
      ? Number(
          matchup.home_user_id === userId
            ? matchup.away_score
            : matchup.home_score,
        )
      : 0,
    myStanding = standings.find((x) => x.user_id === userId),
    lineupReady = lineupCount === 11 && hasCaptain,
    draftReady = draft?.status === "complete" || league?.game_format === "pack";
  const action = useMemo(() => {
    if (!league) return null;
    if (draft?.status === "live")
      return {
        eyebrow:
          league.game_format === "auction"
            ? "LIVE AUCTION"
            : isMyTurn
              ? "YOUR TURN"
              : "LIVE DRAFT",
        title:
          league.game_format === "auction"
            ? "The bidding room is open."
            : isMyTurn
              ? "You’re on the clock."
              : `${current?.team_name ?? "A manager"} is picking.`,
        copy:
          league.game_format === "auction"
            ? "Track the current player, every manager’s budget and the live leading bid."
            : isMyTurn
              ? "Your queue is ready. Make the next selection before time expires."
              : `Pick ${draft.current_pick} of ${totalPicks} is underway.`,
        href:
          league.game_format === "auction"
            ? `/auction?league=${league.league_id}`
            : `/draft?league=${league.league_id}`,
        label:
          league.game_format === "auction"
            ? "Enter auction room"
            : isMyTurn
              ? "Make my pick"
              : "Enter draft room",
      };
    if (league.game_format === "draft" && draft?.status !== "complete")
      return {
        eyebrow: "DRAFT LOBBY",
        title: "Your Draft Room is ready.",
        copy: "Set your player queue, meet the other managers and wait for the commissioner to begin the draft.",
        href: `/draft?league=${league.league_id}`,
        label: "Open Draft Room",
      };
    if (league.game_format === "auction" && !draft)
      return {
        eyebrow: "AUCTION LOBBY",
        title: "The $2B auction is waiting.",
        copy: "Join the room before the commissioner randomizes the nomination order and starts live bidding.",
        href: `/auction?league=${league.league_id}`,
        label: "Open auction lobby",
      };
    if (league.game_format === "pack" && rosterCount === 0)
      return {
        eyebrow: "WELCOME PACK",
        title: "Build your first squad.",
        copy: "Open your starter bundle and reveal your captain, superstar and regular players.",
        href: `/packs?league=${league.league_id}`,
        label: "Open my packs",
      };
    if (draftReady && !lineupReady)
      return {
        eyebrow: "LINEUP NEEDED",
        title: "Finish your Starting XI.",
        copy: `${lineupCount}/11 starters selected${hasCaptain ? "" : " · captain still needed"}.`,
        href: `/team?league=${league.league_id}`,
        label: "Set my lineup",
      };
    if (unreadTrades)
      return {
        eyebrow: "NEW TRADE OFFER",
        title: `${unreadTrades} offer${unreadTrades === 1 ? " is" : "s are"} waiting.`,
        copy: "Review, accept, decline or send a counteroffer.",
        href: `/trades?league=${league.league_id}`,
        label: "Review trades",
      };
    if (matchup) return null;
    return {
      eyebrow: "LEAGUE READY",
      title: "Your season command center.",
      copy: "Set your lineup, watch the market and prepare for the next matchweek.",
      href: `/team?league=${league.league_id}`,
      label: "Open my team",
    };
  }, [
    current?.team_name,
    draft?.current_pick,
    draft?.status,
    draftReady,
    hasCaptain,
    isMyTurn,
    league,
    lineupCount,
    lineupReady,
    matchup,
    rosterCount,
    totalPicks,
    unreadTrades,
  ]);
  const standingsPreview =
      standings.length <= 5
      ? standings
      : myStanding && myStanding.rank > 5
        ? [...standings.slice(0, 4), myStanding]
        : standings.slice(0, 5),
    featuredWeek = Math.max(0, ...headlineFixtures.map((item) => item.gameweek)),
    todaysGames = [...headlineFixtures]
      .sort(
        (a, b) =>
          fixtureDisplayPriority(a.status) - fixtureDisplayPriority(b.status) ||
          headlineWeight(b.home_team) +
            headlineWeight(b.away_team) -
            (headlineWeight(a.home_team) + headlineWeight(a.away_team)) ||
          new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime(),
      )
      .slice(0, 3);

  return (
    <main className="app-shell home-dashboard">
      <header className="topbar home-topbar">
        <div>
          <p className="eyebrow">MY FANTASY XI</p>
          <h1>{loading ? "Loading dashboard…" : `Welcome, ${name}`}</h1>
          {league ? (
            <Link
              className="home-league-switcher"
              href={`/league?league=${league.league_id}`}
            >
              <span>
                <strong>{league.league_name}</strong>
                <small>
                  {league.team_name} · {league.game_format}
                </small>
              </span>
              <b>Switch</b>
            </Link>
          ) : null}
        </div>
        <AccountMenu />
      </header>
      {!loading && !signedIn ? (
        <section className="match-card home-empty">
          <p className="eyebrow">YOUR SEASON</p>
          <h2>Sign in to open your dashboard.</h2>
          <p>Your leagues, lineup and matchup will appear here.</p>
          <Link className="primary-button" href="/login?next=/">
            Log in
          </Link>
        </section>
      ) : null}
      {!loading && signedIn && !league ? (
        <section className="match-card home-empty">
          <p className="eyebrow">START HERE</p>
          <h2>Create or join your first league.</h2>
          <p>Once you join, Home becomes your season command center.</p>
          <Link className="primary-button" href="/league">
            Open leagues
          </Link>
        </section>
      ) : null}
      {league?.game_format === "draft" && !draftReady ? (
        <section className="panel home-matchup-card">
          <p className="eyebrow">MATCHUPS</p>
          <h2>Schedule pending</h2>
          <p>Your randomized matchups will generate when the draft is complete.</p>
        </section>
      ) : null}
      {league && matchup && draftReady ? (
        <section className="panel home-matchup-card">
          <div className="section-row">
            <div>
              <p className="eyebrow">GAMEWEEK {matchup.gameweek}</p>
              <h2>
                {matchup.status === "final" ? "Final score" : "Head to head"}
              </h2>
            </div>
            <span className={`home-status ${matchup.status}`}>
              {refreshing ? "updating" : matchup.status}
            </span>
          </div>
          <div className="home-scoreboard">
            <div className="home-score-team mine">
              <span>{league.team_name}</span>
              <strong>{myScore}</strong>
            </div>
            <b>VS</b>
            <div className="home-score-team">
              <span>{opponent}</span>
              <strong>{opponentScore}</strong>
            </div>
          </div>
          <Link
            className="home-card-link"
            href={`/matchup?league=${league.league_id}`}
          >
            View matchup and player scores <span>→</span>
          </Link>
          <div className="home-season-strip home-season-strip-embedded">
            <div>
              <span>RANK</span>
              <strong>{myStanding ? `#${myStanding.rank}` : "—"}</strong>
            </div>
            <div>
              <span>RECORD</span>
              <strong>
                {myStanding
                  ? `${myStanding.wins}-${myStanding.draws}-${myStanding.losses}`
                  : "0-0-0"}
              </strong>
            </div>
            <div>
              <span>LINEUP</span>
              <strong className={lineupReady ? "ready" : "attention"}>
                {lineupReady ? "READY" : `${lineupCount}/11`}
              </strong>
            </div>
          </div>
        </section>
      ) : null}
      {league && !matchup ? (
        <section className="home-season-strip">
          <div>
            <span>RANK</span>
            <strong>{myStanding ? `#${myStanding.rank}` : "—"}</strong>
          </div>
          <div>
            <span>RECORD</span>
            <strong>
              {myStanding
                ? `${myStanding.wins}-${myStanding.draws}-${myStanding.losses}`
                : "0-0-0"}
            </strong>
          </div>
          <div>
            <span>LINEUP</span>
            <strong className={lineupReady ? "ready" : "attention"}>
              {lineupReady ? "READY" : `${lineupCount}/11`}
            </strong>
          </div>
        </section>
      ) : null}
      {league && action ? (
        <section
          className={`match-card home-command-card ${isMyTurn ? "my-turn" : ""}`}
        >
          <div className="home-command-head">
            <div>
              <p className="eyebrow">{action.eyebrow}</p>
              <h2>{action.title}</h2>
            </div>
            {draft?.status === "live" ? (
              <span className="live-pill">
                <span />LIVE
              </span>
            ) : null}
          </div>
          <p>{action.copy}</p>
          {draft?.status === "live" ? (
            <>
              <div className="home-clock">
                <strong>
                  {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                  {String(seconds % 60).padStart(2, "0")}
                </strong>
                <small>Pick {draft.current_pick} of {totalPicks}</small>
              </div>
              <div className="progress">
                <span style={{ width: `${progress}%` }} />
              </div>
            </>
          ) : null}
          <Link
            className="primary-button home-primary-link"
            href={action.href}
          >
            {action.label} →
          </Link>
        </section>
      ) : null}
      {league ? (
        <>
          <section className="home-section">
            <div className="section-row">
              <div>
                <p className="eyebrow">MANAGE</p>
                <h2>League actions</h2>
              </div>
            </div>
            <div className="home-action-grid">
              <Link href={`/team?league=${league.league_id}`}>
                <span>◎</span>
                <div>
                  <strong>My Team</strong>
                  <small>
                    {lineupReady ? "Lineup & captain ready" : "Action required"}
                  </small>
                </div>
                {!lineupReady && draftReady ? (
                  <b className="home-action-alert">!</b>
                ) : null}
              </Link>
              <Link href={`/players?league=${league.league_id}`}>
                <span>⌕</span>
                <div>
                  <strong>Players</strong>
                  <small>
                    {league.game_format === "pack"
                      ? "Collection & market"
                      : "Free agents & stats"}
                  </small>
                </div>
              </Link>
              <Link
                href={
                  league.game_format === "pack"
                    ? `/packs?league=${league.league_id}#auction`
                    : `/waivers?league=${league.league_id}`
                }
              >
                <span>↻</span>
                <div>
                  <strong>
                    {league.game_format === "pack"
                      ? "Auction"
                      : league.game_format === "auction"
                        ? "Contracts"
                        : "Waivers"}
                  </strong>
                  <small>
                    {league.game_format === "pack"
                      ? "League card market"
                      : league.game_format === "auction"
                        ? windowState
                          ? `GW ${windowState.gameweek} · ${windowState.phase === "waivers" ? "blind offers" : windowState.phase === "free_agency" ? "window executed" : "locked"}`
                          : "Blind offers & signings"
                      : windowState
                        ? `GW ${windowState.gameweek} · ${windowState.phase.replace("_", " ")}`
                        : "Claims & priority"}
                  </small>
                </div>
              </Link>
              <Link href={`/trades?league=${league.league_id}`}>
                <span>⇄</span>
                <div>
                  <strong>Trades</strong>
                  <small>
                    {unreadTrades
                      ? `${unreadTrades} new offer${unreadTrades === 1 ? "" : "s"}`
                      : "Offers & history"}
                  </small>
                </div>
                {unreadTrades ? (
                  <b className="home-action-alert red">{unreadTrades}</b>
                ) : null}
              </Link>
            </div>
          </section>
          <div className="home-live-grid">
          <section className="panel home-big-games">
            <div className="section-row">
              <div>
                <p className="eyebrow">
                  {t("home.realFootball", "REAL FOOTBALL · TODAY")}
                </p>
                <h2>{t("home.todaysMatches", "Today's matches")}</h2>
              </div>
              <span className="muted-chip">GW {featuredWeek || "—"}</span>
            </div>
            {todaysGames.map((game) => (
              <article className="home-big-game" key={game.fixture_id}>
                <span>
                  <strong>{game.home_team}</strong>
                  <small>
                    vs {game.away_team} ·{" "}
                    {new Date(game.kickoff).toLocaleString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </small>
                </span>
                <b>
                  {fixtureHasStarted(game.status)
                    ? `${game.home_score ?? 0}–${game.away_score ?? 0}`
                    : "VS"}
                </b>
                <em
                  className={
                    fixtureHasStarted(game.status)
                      ? fixtureIsFinal(game.status)
                        ? "final"
                        : "live"
                      : "scheduled"
                  }
                >
                  {fixtureIsFinal(game.status)
                    ? t("home.final", "FINAL")
                    : fixtureHasStarted(game.status)
                      ? t("home.live", "LIVE")
                      : t("home.scheduled", "SCHEDULED")}
                </em>
              </article>
            ))}
            {!todaysGames.length ? (
              <p className="empty-state">
                {t("home.noMatches", "No matches are scheduled for today.")}
              </p>
            ) : null}
          </section>
          <section className="home-player-news">
            <div className="section-row">
              <div>
                <p className="eyebrow">PLAYER NEWS</p>
                <h2>Fantasy pulse</h2>
              </div>
              <span className="muted-chip">
                GW {playerPulse[0]?.gameweek ?? "—"}
              </span>
            </div>
            <div className="home-news-scroll">
              {playerPulse.map((player, index) => (
                <article
                  key={player.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open stats for ${player.name}`}
                  onClick={() => setStatsPlayer(player)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      setStatsPlayer(player);
                    }
                  }}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{player.name}</strong>
                    <small>{player.club} · {player.competition}</small>
                    <em className={`pulse-status ${pulseStatus(player.status).tone}`}>{pulseStatus(player.status).label}</em>
                    <p>
                      {player.goals || player.assists
                        ? `${player.goals ? `${player.goals} goal${player.goals === 1 ? "" : "s"}` : ""}${player.goals && player.assists ? " · " : ""}${player.assists ? `${player.assists} assist${player.assists === 1 ? "" : "s"}` : ""}`
                        : player.status === "live"
                          ? "Currently scoring live"
                          : "Top fantasy performance"}
                    </p>
                  </div>
                  <b>{player.points} FP</b>
                </article>
              ))}
              {!playerPulse.length ? (
                <article className="home-news-empty">
                  <div>
                    <strong>Player news is warming up</strong>
                    <p>
                      Top performances will appear automatically after
                      synchronized match statistics arrive.
                    </p>
                  </div>
                </article>
              ) : null}
            </div>
          </section>
          </div>
          <section className="panel home-table-card">
            <div className="section-row">
              <div>
                <p className="eyebrow">{t("home.standings", "STANDINGS")}</p>
                <h2>{t("home.leagueTable", "League table")}</h2>
              </div>
              <span className="muted-chip">
                {standings.length} {t("home.teams", "teams")}
              </span>
            </div>
            <div className="home-table-head">
              <span>#</span>
              <span>Club</span>
              <span>W-D-L</span>
              <span>Pts</span>
            </div>
            {standingsPreview.map((row) => (
              <div
                className={`home-table-row ${row.user_id === userId ? "mine" : ""}`}
                key={row.user_id}
              >
                <span>{row.rank}</span>
                <strong>{row.team_name}</strong>
                <span>
                  {row.wins}-{row.draws}-{row.losses}
                </span>
                <b>{row.points}</b>
              </div>
            ))}
            {!standings.length ? (
              <p className="empty-state">
                Standings begin after the first matchup.
              </p>
            ) : null}
            {standings.length > standingsPreview.length ? <Link className="home-card-link" href={`/league?league=${league.league_id}`}>View full table <span>→</span></Link> : null}
          </section>
          {draft?.status !== "complete" && picks.length ? (
            <section className="panel home-activity">
              <div className="section-row">
                <div>
                  <p className="eyebrow">LEAGUE ACTIVITY</p>
                  <h2>Recent picks</h2>
                </div>
                <Link
                  className="text-button"
                  href={`/draft?league=${league.league_id}`}
                >
                  Draft room
                </Link>
              </div>
              {picks.slice(0, 4).map((pick) => (
                <div className="home-pick-row" key={pick.id}>
                  <b>#{pick.pick_number}</b>
                  <span>
                    <strong>{pick.players?.full_name ?? "Player"}</strong>
                    <small>
                      {order.find((manager) => manager.user_id === pick.user_id)
                        ?.team_name ?? "Manager"}
                    </small>
                  </span>
                  {pick.auto_picked ? <em>AUTO</em> : null}
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
      {statsPlayer && league ? (
        <PlayerStatsDialog
          leagueId={league.league_id}
          player={{
            id: statsPlayer.id,
            full_name: statsPlayer.name,
            position: statsPlayer.position,
            club: statsPlayer.club,
            competition: statsPlayer.competition,
            photo_url: statsPlayer.photo_url,
          }}
          onClose={() => setStatsPlayer(null)}
        />
      ) : null}
      <BottomNav />
    </main>
  );
}

