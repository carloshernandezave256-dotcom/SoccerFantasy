"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageShell } from "./page-shell";
import { PlayerHeadshot } from "./player-headshot";
import { supabase } from "@/lib/supabase";

type League = {
  league_id: string;
  league_name: string;
  team_name: string;
  is_commissioner: boolean;
  game_format: string;
  player_pool: string;
};
type Session = {
  id: string;
  style: "nomination" | "mystery";
  status: "waiting" | "nomination" | "reveal" | "bidding" | "complete";
  starting_budget: number;
  minimum_bid: number;
  bid_increment: number;
  bid_seconds: number;
  current_nominator_slot: number;
  current_lot_id: string | null;
  star_drought: number;
  superstar_drought: number;
  updated_at: string;
};
type Manager = { draft_slot: number; user_id: string; team_name: string };
type Budget = { user_id: string; remaining_budget: number };
type Player = {
  id: number;
  full_name: string;
  position: string;
  club: string;
  competition: string;
  draft_rank: number | null;
  photo_url?: string | null;
};
type Lot = {
  id: string;
  sequence_no: number;
  player_id: number;
  current_bid: number | null;
  current_bidder_id: string | null;
  status: string;
  closes_at: string;
  players?: Player | null;
};
type Pick = {
  id: number;
  user_id: string;
  player_id: number;
  auction_price: number | null;
  players?: Player | null;
};

const money = (amount: number | null | undefined) =>
  `$${Math.round(Number(amount ?? 0) / 1000000).toLocaleString()}M`;

const rosterTargets = [
  { position: "GK", target: 2 },
  { position: "DEF", target: 6 },
  { position: "MID", target: 5 },
  { position: "FWD", target: 5 },
] as const;

export function AuctionRoom({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const loadSequence = useRef(0);
  const sessionUpdatedAt = useRef("");
  const [league, setLeague] = useState<League | null>(null),
    [session, setSession] = useState<Session | null>(null),
    [managers, setManagers] = useState<Manager[]>([]),
    [budgets, setBudgets] = useState<Budget[]>([]),
    [players, setPlayers] = useState<Player[]>([]),
    [lots, setLots] = useState<Lot[]>([]),
    [picks, setPicks] = useState<Pick[]>([]);
  const [userId, setUserId] = useState(""),
    [query, setQuery] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [now, setNow] = useState(Date.now()),
    [opening, setOpening] = useState(1),
    [customBid, setCustomBid] = useState("");

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    const [
      auth,
      leagueResult,
      sessionResult,
      orderResult,
      budgetResult,
      lotResult,
      pickResult,
    ] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("my_leagues"),
      supabase
        .from("auction_sessions")
        .select(
          "id,style,status,starting_budget,minimum_bid,bid_increment,bid_seconds,current_nominator_slot,current_lot_id,star_drought,superstar_drought,updated_at",
        )
        .eq("league_id", leagueId)
        .maybeSingle(),
      supabase.rpc("draft_order", { p_league_id: leagueId }),
      supabase
        .from("auction_budgets")
        .select("user_id,remaining_budget")
        .eq("league_id", leagueId),
      supabase
        .from("auction_lots")
        .select(
          "id,sequence_no,player_id,current_bid,current_bidder_id,status,closes_at,players(id,full_name,position,club,competition,draft_rank,photo_url)",
        )
        .eq("league_id", leagueId)
        .order("sequence_no", { ascending: false }),
      supabase
        .from("draft_picks")
        .select(
          "id,user_id,player_id,auction_price,players(id,full_name,position,club,competition,draft_rank,photo_url)",
        )
        .eq("league_id", leagueId)
        .order("pick_number"),
    ]);
    const active =
      ((leagueResult.data ?? []) as League[]).find(
        (item) => item.league_id === leagueId,
      ) ?? null;
    if (sequence !== loadSequence.current) return;
    const nextSession = (sessionResult.data as Session | null) ?? null;
    setUserId(auth.data.user?.id ?? "");
    setLeague(active);
    setSession(nextSession);
    sessionUpdatedAt.current = nextSession?.updated_at ?? "";
    setManagers((orderResult.data ?? []) as Manager[]);
    setBudgets((budgetResult.data ?? []) as Budget[]);
    setLots((lotResult.data ?? []) as unknown as Lot[]);
    setPicks((pickResult.data ?? []) as unknown as Pick[]);
    if (active) {
      const pool = active.player_pool ?? "All Top Five";
      let request = supabase
        .from("players")
        .select("id,full_name,position,club,competition,draft_rank,photo_url")
        .eq("active", true)
        .order("draft_rank", { ascending: true, nullsFirst: false })
        .limit(1000);
      if (pool !== "All Top Five") request = request.eq("competition", pool);
      const { data } = await request;
      if (sequence !== loadSequence.current) return;
      setPlayers((data ?? []) as Player[]);
    }
  }, [leagueId]);

  useEffect(() => {
    void load();
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    const heartbeat = window.setInterval(async () => {
      const { data } = await supabase
        .from("auction_sessions")
        .select("updated_at")
        .eq("league_id", leagueId)
        .maybeSingle();
      const updatedAt = data?.updated_at ?? "";
      if (updatedAt && updatedAt !== sessionUpdatedAt.current) void load();
    }, 8000);
    const refreshVisibleRoom = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("focus", refreshVisibleRoom);
    document.addEventListener("visibilitychange", refreshVisibleRoom);
    const channel = supabase
      .channel(`auction:${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_sessions",
          filter: `league_id=eq.${leagueId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_lots",
          filter: `league_id=eq.${leagueId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "auction_bids",
          filter: `league_id=eq.${leagueId}`,
        },
        () => void load(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "auction_budgets",
          filter: `league_id=eq.${leagueId}`,
        },
        () => void load(),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void load();
      });
    return () => {
      window.clearInterval(clock);
      window.clearInterval(heartbeat);
      window.removeEventListener("focus", refreshVisibleRoom);
      document.removeEventListener("visibilitychange", refreshVisibleRoom);
      void supabase.removeChannel(channel);
    };
  }, [leagueId, load]);

  const currentLot =
    lots.find((lot) => lot.id === session?.current_lot_id) ?? null;
  const seconds = currentLot
    ? Math.max(
        0,
        Math.ceil((new Date(currentLot.closes_at).getTime() - now) / 1000),
      )
    : 0;
  useEffect(() => {
    if (session?.status !== "bidding" || seconds !== 0) return;
    const timeout = window.setTimeout(async () => {
      await supabase.rpc("settle_auction_lot", { p_league_id: leagueId });
      await load();
    }, 350);
    return () => window.clearTimeout(timeout);
  }, [leagueId, load, seconds, session?.status]);
  useEffect(() => {
    if (session?.status === "complete")
      router.replace(`/team?league=${leagueId}`);
  }, [leagueId, router, session?.status]);

  const soldIds = useMemo(
    () =>
      new Set(
        lots
          .filter((lot) => lot.status === "open" || lot.status === "sold")
          .map((lot) => lot.player_id),
      ),
    [lots],
  );
  const available = useMemo(
    () =>
      players
        .filter(
          (player) =>
            !soldIds.has(player.id) &&
            `${player.full_name} ${player.club}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .slice(0, 60),
    [players, query, soldIds],
  );
  const nominator = managers.find(
    (manager) => manager.draft_slot === session?.current_nominator_slot,
  );
  const leader = managers.find(
    (manager) => manager.user_id === currentLot?.current_bidder_id,
  );
  const canReveal =
    nominator?.user_id === userId || Boolean(league?.is_commissioner);
  const myBudget =
    budgets.find((item) => item.user_id === userId)?.remaining_budget ??
    session?.starting_budget ??
    2000000000;
  const myRoster = picks.filter((pick) => pick.user_id === userId);
  const rosterNeeds = rosterTargets.map(({ position, target }) => {
    const current = myRoster.filter(
      (pick) => pick.players?.position === position,
    ).length;
    return { position, target, current, needed: Math.max(0, target - current) };
  });
  const myMax = Math.max(
    0,
    myBudget -
      Math.max(0, 18 - myRoster.length - 1) * (session?.minimum_bid ?? 1000000),
  );
  const nextBid =
    (currentLot?.current_bid ?? 0) + (session?.bid_increment ?? 1000000);
  const superstarChance = Math.min(
    15,
    5 + (session?.superstar_drought ?? 0),
  );
  const starChance = Math.min(45, 15 + (session?.star_drought ?? 0) * 5);

  async function act(
    name: string,
    args: Record<string, unknown>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc(name, args);
    setMessage(error?.message ?? success);
    await load();
    setBusy(false);
    return !error;
  }
  async function bid(amount: number, clearManualBid = false) {
    if (!currentLot || amount < nextBid) return;
    const succeeded = await act(
      "place_auction_bid",
      { p_league_id: leagueId, p_amount: amount },
      `You lead at ${money(amount)}.`,
    );
    if (succeeded && clearManualBid) setCustomBid("");
  }

  if (!league)
    return (
      <PageShell eyebrow="LIVE AUCTION" title="Auction room">
        <section className="panel empty-state">
          Loading this Auction League…
        </section>
      </PageShell>
    );
  if (session?.status === "complete")
    return (
      <main className="app-shell" aria-busy="true">
        Opening My Team…
      </main>
    );
  return (
    <PageShell
      leagueId={leagueId}
      eyebrow={
        session
          ? `${session.style === "mystery" ? "MYSTERY REVEAL" : "MANAGER NOMINATION"} · LIVE AUCTION`
          : "AUCTION LEAGUE"
      }
      title={league.league_name}
    >
      {!session ? (
        <section className="panel auction-lobby">
          <p className="eyebrow">$2 BILLION PER MANAGER</p>
          <h2>
            {league.is_commissioner
              ? "Start the live auction"
              : "Waiting for the commissioner"}
          </h2>
          <p>
            The order is randomized once. Every manager can bid on every
            eligible player, while the server reserves enough money to complete
            all 18 roster spots.
          </p>
          {league.is_commissioner && managers.length === 1 ? (
            <p className="auction-rule">
              Beta test mode: you can start alone to preview the complete live
              auction flow.
            </p>
          ) : null}
          {league.is_commissioner ? (
            <button
              className="primary-button full-button"
              disabled={busy}
              onClick={() =>
                void act(
                  "start_auction",
                  { p_league_id: leagueId },
                  "Auction started.",
                )
              }
            >
              {busy ? "Starting auction…" : "Randomize order and start"}
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <section className="auction-budget-strip">
            <span>
              <small>YOUR BUDGET</small>
              <strong>{money(myBudget)}</strong>
            </span>
            <span>
              <small>MAX BID</small>
              <strong>{money(myMax)}</strong>
            </span>
            <span>
              <small>ROSTER</small>
              <strong>{myRoster.length}/18</strong>
            </span>
          </section>
          <section
            className="auction-roster-needs"
            aria-label="Your remaining roster requirements"
          >
            <div className="auction-roster-needs-heading">
              <span>
                <small>YOUR POSITION NEEDS</small>
                <strong>{Math.max(0, 18 - myRoster.length)} spots left</strong>
              </span>
              <small>18-player target</small>
            </div>
            <div className="auction-roster-needs-grid">
              {rosterNeeds.map(({ position, target, current, needed }) => (
                <span className={needed === 0 ? "complete" : ""} key={position}>
                  <small>{position}</small>
                  <strong>
                    {current}/{target}
                  </strong>
                  <em>{needed === 0 ? "Complete" : `Need ${needed}`}</em>
                </span>
              ))}
            </div>
          </section>
          <section
            className="draft-order"
            aria-label="Auction nomination order"
          >
            {managers.map((manager) => (
              <span
                className={
                  manager.user_id === nominator?.user_id &&
                  session.status !== "bidding"
                    ? "active"
                    : ""
                }
                key={manager.user_id}
              >
                {manager.draft_slot}. {manager.team_name} ·{" "}
                {money(
                  budgets.find((item) => item.user_id === manager.user_id)
                    ?.remaining_budget,
                )}
              </span>
            ))}
          </section>
          {session.status === "bidding" && currentLot ? (
            <section className="panel auction-stage">
              <div className="auction-timer">
                <span>
                  <small>{leader ? "CURRENT LEADER" : "OPEN BIDDING"}</small>
                  <strong>{leader?.team_name ?? "No bids yet"}</strong>
                </span>
                <b>{seconds}s</b>
              </div>
              <PlayerHeadshot
                name={currentLot.players?.full_name ?? "Player"}
                position={currentLot.players?.position ?? "FWD"}
                photoUrl={currentLot.players?.photo_url}
              />
              <p className="eyebrow">
                {currentLot.players?.position} ·{" "}
                {currentLot.players?.competition}
              </p>
              <h2>{currentLot.players?.full_name}</h2>
              <p>{currentLot.players?.club}</p>
              <strong className="auction-price">
                {money(currentLot.current_bid)}
              </strong>
              <div className="auction-quick-bids">
                {[1, 5, 10, 25].map((step) => (
                  <button
                    key={step}
                    disabled={busy || nextBid + (step - 1) * 1000000 > myMax}
                    onClick={() =>
                      void bid(nextBid + (step - 1) * 1000000)
                    }
                  >
                    +{step}M
                  </button>
                ))}
              </div>
              <div className="auction-custom-bid">
                <input
                  inputMode="numeric"
                  value={customBid}
                  onChange={(event) =>
                    setCustomBid(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="Custom bid in millions"
                />
                <button
                  disabled={
                    busy ||
                    !customBid ||
                    Number(customBid) * 1000000 < nextBid ||
                    Number(customBid) * 1000000 > myMax
                  }
                  onClick={() =>
                    void bid(Number(customBid) * 1000000, true)
                  }
                >
                  Bid
                </button>
              </div>
              <small className="auction-rule">
                Bids inside the final 6 seconds reset the clock to 6 seconds.
              </small>
            </section>
          ) : session.status === "reveal" ? (
            <section className="panel auction-reveal">
              <span>?</span>
              <p className="eyebrow">MYSTERY PLAYER</p>
              <h2>Who enters the room next?</h2>
              <p>
                {nominator?.user_id === userId
                  ? "It’s your turn to reveal the next mystery player."
                  : `${nominator?.team_name ?? "The active manager"} reveals next. Everyone sees the same player and can bid.`}
              </p>
              <div
                className="auction-mystery-odds"
                aria-label="Mystery reveal odds"
              >
                <span>
                  <small>SUPERSTAR</small>
                  <strong>{superstarChance}%</strong>
                </span>
                <span>
                  <small>STAR</small>
                  <strong>{starChance}%</strong>
                </span>
                <span>
                  <small>REGULAR</small>
                  <strong>{100 - superstarChance - starChance}%</strong>
                </span>
              </div>
              {session.star_drought > 0 || session.superstar_drought > 0 ? (
                <p className="auction-odds-rising">
                  Star odds rising · {session.star_drought} regular reveal
                  {session.star_drought === 1 ? "" : "s"} in a row
                </p>
              ) : null}
              <button
                className="primary-button full-button"
                disabled={busy || !canReveal}
                onClick={() =>
                  void act(
                    "reveal_auction_player",
                    { p_league_id: leagueId },
                    "Mystery player revealed.",
                  )
                }
              >
                {nominator?.user_id === userId
                  ? "Reveal next player"
                  : league?.is_commissioner
                    ? "Commissioner reveal override"
                    : `Waiting for ${nominator?.team_name ?? "manager"}`}
              </button>
            </section>
          ) : (
            <>
              <section className="panel auction-nomination">
                <p className="eyebrow">NOW NOMINATING</p>
                <h2>{nominator?.team_name}</h2>
                <p>
                  {nominator?.user_id === userId
                    ? "Choose any eligible player and place the opening bid."
                    : "Everyone can bid as soon as their player enters the room."}
                </p>
                {nominator?.user_id === userId ? (
                  <label>
                    Opening bid (millions)
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={opening}
                      onChange={(event) =>
                        setOpening(Number(event.target.value))
                      }
                    />
                  </label>
                ) : null}
              </section>
              <div className="search-box">
                ⌕
                <input
                  placeholder="Search player or club"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <section className="panel player-list auction-player-list">
                {available.map((player) => (
                  <article key={player.id}>
                    <PlayerHeadshot
                      name={player.full_name}
                      position={player.position}
                      photoUrl={player.photo_url}
                    />
                    <div>
                      <strong>{player.full_name}</strong>
                      <small>
                        #{player.draft_rank ?? "—"} · {player.club} ·{" "}
                        {player.position}
                      </small>
                    </div>
                    <button
                      disabled={
                        busy ||
                        nominator?.user_id !== userId ||
                        opening * 1000000 > myMax
                      }
                      onClick={() =>
                        void act(
                          "nominate_auction_player",
                          {
                            p_league_id: leagueId,
                            p_player_id: player.id,
                            p_opening_bid: opening * 1000000,
                          },
                          `${player.full_name} entered the auction.`,
                        )
                      }
                    >
                      Nominate
                    </button>
                  </article>
                ))}
              </section>
            </>
          )}
          {message ? <p className="form-message">{message}</p> : null}
          <section className="panel auction-results">
            <div className="section-row">
              <div>
                <p className="eyebrow">RECENT SALES</p>
                <h2>Auction board</h2>
              </div>
              <span className="muted-chip">{picks.length}</span>
            </div>
            {lots
              .filter((lot) => lot.status !== "open")
              .slice(0, 10)
              .map((lot) => (
                <article key={lot.id}>
                  <span>{lot.status === "sold" ? "✓" : "—"}</span>
                  <div>
                    <strong>{lot.players?.full_name}</strong>
                    <small>
                      {lot.status === "sold"
                        ? managers.find(
                            (manager) =>
                              manager.user_id === lot.current_bidder_id,
                          )?.team_name
                        : "No bids"}
                    </small>
                  </div>
                  <b>
                    {lot.status === "sold" ? money(lot.current_bid) : "UNSOLD"}
                  </b>
                </article>
              ))}
            {lots.length === 0 ? (
              <p className="empty-state">The auction board is empty.</p>
            ) : null}
          </section>
        </>
      )}
    </PageShell>
  );
}
