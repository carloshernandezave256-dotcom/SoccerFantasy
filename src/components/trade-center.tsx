"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageShell } from "./page-shell";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague } from "@/lib/active-league";
import { PlayerHeadshot } from "./player-headshot";

type League = {
  league_id: string;
  league_name: string;
  team_name: string;
  game_format: "draft" | "pack" | "auction";
};
type Manager = { draft_slot: number; user_id: string; team_name: string };
type Player = {
  id: number;
  asset_id: string;
  full_name: string;
  position: string;
  club: string;
  photo_url?: string | null;
};
type Pick = { user_id: string; players: Player | null };
type TradePlayer = {
  player_id: number;
  pack_card_id: string | null;
  from_user_id: string;
  players: Player | null;
};
type TradeStatus =
  "pending" | "accepted" | "declined" | "cancelled" | "expired";
type Trade = {
  id: string;
  league_id: string;
  proposer_id: string;
  recipient_id: string;
  status: TradeStatus;
  note: string | null;
  created_at: string;
  responded_at: string | null;
  seen_at: string | null;
  expires_at: string;
  counter_of: string | null;
  trade_players: TradePlayer[];
};
type TradeTab = "build" | "received" | "sent" | "history";

export function TradeCenter() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [league, setLeague] = useState("");
  const [gameFormat, setGameFormat] = useState<
    "draft" | "pack" | "auction"
  >("draft");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [userId, setUserId] = useState("");
  const [partner, setPartner] = useState("");
  const [picks, setPicks] = useState<Pick[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [offered, setOffered] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<TradeTab>("build");
  const [buildStep, setBuildStep] = useState<1 | 2 | 3 | 4>(1);
  const [counterOf, setCounterOf] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadLeague = useCallback(
    async (
      id: string,
      currentUser: string,
      format: "draft" | "pack" | "auction",
    ) => {
      setLoading(true);
      const [orderResult, pickResult, cardResult, tradeResult] =
        await Promise.all([
          supabase.rpc("draft_order", { p_league_id: id }),
          supabase
            .from("draft_picks")
            .select("user_id,players(id,full_name,position,club,photo_url)")
            .eq("league_id", id),
          supabase
            .from("pack_cards")
            .select("id,user_id,players(id,full_name,position,club,photo_url)")
            .eq("league_id", id),
          supabase
            .from("trades")
            .select(
              "id,league_id,proposer_id,recipient_id,status,note,created_at,responded_at,seen_at,expires_at,counter_of,trade_players(player_id,pack_card_id,from_user_id,players(id,full_name,position,club,photo_url))",
            )
            .eq("league_id", id)
            .order("created_at", { ascending: false }),
        ]);
      const error =
        orderResult.error ??
        pickResult.error ??
        (format === "pack" ? cardResult.error : null) ??
        tradeResult.error;
      if (error) setMessage(error.message);
      const managerList = (orderResult.data ?? []) as Manager[];
      setManagers(managerList);
      setPartner((old) =>
        managerList.some(
          (manager) => manager.user_id === old && old !== currentUser,
        )
          ? old
          : (managerList.find((manager) => manager.user_id !== currentUser)
              ?.user_id ?? ""),
      );
      const roster =
        format === "pack"
          ? (cardResult.data ?? []).map((card: any) => ({
              user_id: card.user_id,
              players: card.players
                ? { ...card.players, asset_id: `c:${card.id}` }
                : null,
            }))
          : (pickResult.data ?? []).map((pick: any) => ({
              user_id: pick.user_id,
              players: pick.players
                ? { ...pick.players, asset_id: `p:${pick.players.id}` }
                : null,
            }));
      setPicks(roster as Pick[]);
      setTrades((tradeResult.data ?? []) as unknown as Trade[]);
      setOffered([]);
      setRequested([]);
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoading(false);
        return;
      }
      setUserId(user.id);
      const { data, error } = await supabase.rpc("my_leagues");
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }
      const list = (data ?? []) as League[];
      setLeagues(list);
      const active = resolveActiveLeague(
        list,
        new URLSearchParams(window.location.search).get("league"),
      );
      if (active) {
        setLeague(active.league_id);
        setGameFormat(active.game_format);
        await loadLeague(active.league_id, user.id, active.game_format);
      } else setLoading(false);
    })();
  }, [loadLeague]);

  const myRoster = useMemo(
    () =>
      picks
        .filter((pick) => pick.user_id === userId && pick.players)
        .map((pick) => pick.players as Player),
    [picks, userId],
  );
  const partnerRoster = useMemo(
    () =>
      picks
        .filter((pick) => pick.user_id === partner && pick.players)
        .map((pick) => pick.players as Player),
    [picks, partner],
  );
  const managerMap = useMemo(
    () =>
      new Map(managers.map((manager) => [manager.user_id, manager.team_name])),
    [managers],
  );
  const selectedOffered = useMemo(
    () => myRoster.filter((player) => offered.includes(player.asset_id)),
    [myRoster, offered],
  );
  const selectedRequested = useMemo(
    () => partnerRoster.filter((player) => requested.includes(player.asset_id)),
    [partnerRoster, requested],
  );
  const incomingCount = trades.filter(
    (trade) =>
      trade.status === "pending" &&
      trade.recipient_id === userId &&
      new Date(trade.expires_at).getTime() > Date.now(),
  ).length;
  const canPropose =
    offered.length > 0 && offered.length === requested.length && !busy;

  function toggle(id: string, side: "offer" | "request") {
    const setter = side === "offer" ? setOffered : setRequested;
    setter((current) =>
      current.includes(id)
        ? current.filter((playerId) => playerId !== id)
        : [...current, id],
    );
  }

  async function propose() {
    if (!league || !partner || !canPropose) return;
    setBusy(true);
    setMessage("");
    const offeredIds = selectedOffered.map((player) => player.id),
      requestedIds = selectedRequested.map((player) => player.id);
    const request = counterOf
      ? gameFormat === "pack"
        ? supabase.rpc("create_pack_trade_counter", {
            p_trade_id: counterOf,
            p_offered_cards: offered.map((id) => id.slice(2)),
            p_requested_cards: requested.map((id) => id.slice(2)),
            p_note: note,
          })
        : supabase.rpc("create_trade_counter", {
            p_trade_id: counterOf,
            p_offered: offeredIds,
            p_requested: requestedIds,
            p_note: note,
          })
      : gameFormat === "pack"
        ? supabase.rpc("create_pack_trade_offer", {
            p_league_id: league,
            p_recipient_id: partner,
            p_offered_cards: offered.map((id) => id.slice(2)),
            p_requested_cards: requested.map((id) => id.slice(2)),
            p_note: note,
          })
        : supabase.rpc("create_trade_offer", {
            p_league_id: league,
            p_recipient_id: partner,
            p_offered: offeredIds,
            p_requested: requestedIds,
            p_note: note,
          });
    const { error } = await request;
    if (error) setMessage(error.message);
    else {
      setMessage(
        counterOf
          ? "Counteroffer sent."
          : `Trade offer sent to ${managerMap.get(partner)}.`,
      );
      setNote("");
      setCounterOf("");
      setBuildStep(1);
      setTab("sent");
      await loadLeague(league, userId, gameFormat);
    }
    setBusy(false);
  }

  async function respond(id: string, accept: boolean) {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("respond_to_trade", {
      p_trade_id: id,
      p_accept: accept,
    });
    if (error) setMessage(error.message);
    else {
      setMessage(
        accept
          ? "Trade accepted. Both rosters were updated."
          : "Trade declined.",
      );
      await loadLeague(league, userId, gameFormat);
    }
    setBusy(false);
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("cancel_trade", { p_trade_id: id });
    if (error) setMessage(error.message);
    else {
      setMessage("Trade offer cancelled.");
      await loadLeague(league, userId, gameFormat);
    }
    setBusy(false);
  }

  async function openTab(next: TradeTab) {
    setTab(next);
    if (next === "received" && league) {
      await supabase.rpc("mark_trade_offers_seen", { p_league_id: league });
      setTrades((current) =>
        current.map((trade) =>
          trade.recipient_id === userId && trade.status === "pending"
            ? { ...trade, seen_at: new Date().toISOString() }
            : trade,
        ),
      );
    }
  }

  function counter(trade: Trade) {
    const asset = (item: TradePlayer) =>
      item.pack_card_id ? `c:${item.pack_card_id}` : `p:${item.player_id}`;
    const give = trade.trade_players
      .filter((item) => item.from_user_id === userId)
      .map(asset);
    const receive = trade.trade_players
      .filter((item) => item.from_user_id === trade.proposer_id)
      .map(asset);
    setPartner(trade.proposer_id);
    setOffered(give);
    setRequested(receive);
    setCounterOf(trade.id);
    setNote("");
    setMessage("Counteroffer started. Adjust what you want from their team.");
    setBuildStep(2);
    setTab("build");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <PageShell eyebrow="LEAGUE TRANSACTIONS" title="Trade Center">
      {!userId && !loading ? (
        <section className="panel empty-feature">
          <span>⇄</span>
          <h2>Sign in to trade</h2>
          <p>Trade offers are available to managers inside the same league.</p>
          <Link className="primary-button" href="/login?next=/trades">
            Log in
          </Link>
        </section>
      ) : leagues.length === 0 && !loading ? (
        <section className="panel empty-feature">
          <span>＋</span>
          <h2>Join a league first</h2>
          <p>
            Your real roster and league opponents will appear here after you
            draft.
          </p>
          <Link className="primary-button" href="/league">
            Open leagues
          </Link>
        </section>
      ) : (
        <>
          <nav className="trade-tabs">
            <button
              className={tab === "build" ? "active" : ""}
              onClick={() => void openTab("build")}
            >
              Build
            </button>
            <button
              className={tab === "received" ? "active" : ""}
              onClick={() => void openTab("received")}
            >
              Received{" "}
              {incomingCount ? (
                <span className="trade-alert-badge">{incomingCount}</span>
              ) : null}
            </button>
            <button
              className={tab === "sent" ? "active" : ""}
              onClick={() => void openTab("sent")}
            >
              Sent
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => void openTab("history")}
            >
              History
            </button>
          </nav>
          {message ? <p className="panel trade-message">{message}</p> : null}
          {tab === "build" ? (
            <>
              {loading ? (
                <section className="panel empty-state">
                  Loading league rosters…
                </section>
              ) : managers.filter((manager) => manager.user_id !== userId)
                  .length ? (
                <>
                  <div className="trade-step-progress">
                    <span className={buildStep >= 1 ? "active" : ""}>1</span>
                    <i />
                    <span className={buildStep >= 2 ? "active" : ""}>2</span>
                    <i />
                    <span className={buildStep >= 3 ? "active" : ""}>3</span>
                    <i />
                    <span className={buildStep >= 4 ? "active" : ""}>4</span>
                  </div>
                  {buildStep > 1 ? (
                    <section className="trade-summary trade-summary-sticky">
                      <div>
                        <small>YOU SEND</small>
                        <strong>{offered.length}</strong>
                      </div>
                      <span>⇄</span>
                      <div>
                        <small>YOU RECEIVE</small>
                        <strong>{requested.length}</strong>
                      </div>
                      <p>
                        {counterOf ? "COUNTEROFFER · " : ""}
                        {managerMap.get(partner)}
                      </p>
                    </section>
                  ) : null}
                  {buildStep === 1 ? (
                    <section className="panel trade-manager-step">
                      <div className="section-row">
                        <div>
                          <p className="eyebrow">STEP 1 OF 4</p>
                          <h2>Who do you want to trade with?</h2>
                        </div>
                      </div>
                      <div className="trade-manager-list">
                        {managers
                          .filter((manager) => manager.user_id !== userId)
                          .map((manager) => (
                            <button
                              key={manager.user_id}
                              className={
                                partner === manager.user_id ? "selected" : ""
                              }
                              onClick={() => {
                                setPartner(manager.user_id);
                                setRequested([]);
                                setOffered([]);
                                setCounterOf("");
                              }}
                            >
                              <span>{manager.draft_slot}</span>
                              <strong>{manager.team_name}</strong>
                              <i>{partner === manager.user_id ? "✓" : "›"}</i>
                            </button>
                          ))}
                      </div>
                      <button
                        className="primary-button full-button"
                        disabled={!partner}
                        onClick={() => setBuildStep(2)}
                      >
                        Next: choose their players
                      </button>
                    </section>
                  ) : null}
                  {buildStep === 2 ? (
                    <>
                      <TradeRoster
                        title={managerMap.get(partner) ?? "Their team"}
                        instruction="Choose the players you want from them"
                        roster={partnerRoster}
                        selected={requested}
                        onToggle={(id) => toggle(id, "request")}
                      />
                      <WizardActions
                        back={() => setBuildStep(1)}
                        next={() => setBuildStep(3)}
                        nextLabel="Next: choose who you send"
                        nextDisabled={!requested.length}
                      />
                    </>
                  ) : null}
                  {buildStep === 3 ? (
                    <>
                      <TradeRoster
                        title="Your team"
                        instruction={`Choose ${requested.length} player${requested.length === 1 ? "" : "s"} to send`}
                        roster={myRoster}
                        selected={offered}
                        onToggle={(id) => toggle(id, "offer")}
                      />
                      <WizardActions
                        back={() => setBuildStep(2)}
                        next={() => setBuildStep(4)}
                        nextLabel="Next: review offer"
                        nextDisabled={offered.length !== requested.length}
                      />
                    </>
                  ) : null}
                  {buildStep === 4 ? (
                    <>
                      <section className="panel trade-compose trade-final-review">
                        <div>
                          <small>YOU SEND</small>
                          <strong>
                            {selectedOffered
                              .map((player) => player.full_name)
                              .join(", ")}
                          </strong>
                        </div>
                        <span>for</span>
                        <div>
                          <small>YOU RECEIVE</small>
                          <strong>
                            {selectedRequested
                              .map((player) => player.full_name)
                              .join(", ")}
                          </strong>
                        </div>
                        <label>
                          Message (optional)
                          <textarea
                            maxLength={280}
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            placeholder="Add a message to the other manager"
                          />
                        </label>
                      </section>
                      <div className="trade-wizard-actions">
                        <button
                          className="secondary-button"
                          onClick={() => setBuildStep(3)}
                        >
                          Back
                        </button>
                        <button
                          className="primary-button"
                          onClick={() => void propose()}
                          disabled={!canPropose}
                        >
                          {busy
                            ? "Sending…"
                            : counterOf
                              ? "Send counteroffer"
                              : "Send trade offer"}
                        </button>
                      </div>
                    </>
                  ) : null}
                </>
              ) : (
                <section className="panel empty-state">
                  Another manager must join this league before you can trade.
                </section>
              )}
            </>
          ) : (
            <TradeOffers
              trades={trades.filter((trade) =>
                tab === "received"
                  ? trade.recipient_id === userId && trade.status === "pending"
                  : tab === "sent"
                    ? trade.proposer_id === userId && trade.status === "pending"
                    : trade.status !== "pending",
              )}
              userId={userId}
              managerMap={managerMap}
              busy={busy}
              onRespond={respond}
              onCancel={cancel}
              onCounter={counter}
            />
          )}
        </>
      )}
    </PageShell>
  );
}

function WizardActions({
  back,
  next,
  nextLabel,
  nextDisabled,
}: {
  back: () => void;
  next: () => void;
  nextLabel: string;
  nextDisabled: boolean;
}) {
  return (
    <div className="trade-wizard-actions">
      <button className="secondary-button" onClick={back}>
        Back
      </button>
      <button className="primary-button" disabled={nextDisabled} onClick={next}>
        {nextLabel}
      </button>
    </div>
  );
}

function TradeRoster({
  title,
  instruction,
  roster,
  selected,
  onToggle,
}: {
  title: string;
  instruction: string;
  roster: Player[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <section className="panel trade-roster">
      <div className="section-row">
        <div>
          <h2>{title}</h2>
          <small>{instruction}</small>
        </div>
        <span className="muted-chip">{selected.length}</span>
      </div>
      {roster.map((player) => (
        <button
          key={player.asset_id}
          className={selected.includes(player.asset_id) ? "selected" : ""}
          onClick={() => onToggle(player.asset_id)}
        >
          <PlayerHeadshot
            name={player.full_name}
            position={player.position}
            photoUrl={player.photo_url}
          />
          <span>
            <strong>{player.full_name}</strong>
            <small>{player.club}</small>
          </span>
          <i>{selected.includes(player.asset_id) ? "✓" : "+"}</i>
        </button>
      ))}
    </section>
  );
}

function TradeOffers({
  trades,
  userId,
  managerMap,
  busy,
  onRespond,
  onCancel,
  onCounter,
}: {
  trades: Trade[];
  userId: string;
  managerMap: Map<string, string>;
  busy: boolean;
  onRespond: (id: string, accept: boolean) => void;
  onCancel: (id: string) => void;
  onCounter: (trade: Trade) => void;
}) {
  if (!trades.length)
    return (
      <section className="panel empty-state">
        No trade offers yet. Build the first offer for your league.
      </section>
    );
  return (
    <section className="trade-offer-list">
      {trades.map((trade) => {
        const incoming = trade.recipient_id === userId;
        const mine = incoming ? trade.recipient_id : trade.proposer_id;
        const theirs = incoming ? trade.proposer_id : trade.recipient_id;
        const give = trade.trade_players.filter(
          (item) => item.from_user_id === mine,
        );
        const receive = trade.trade_players.filter(
          (item) => item.from_user_id === theirs,
        );
        const expired =
          trade.status === "pending" &&
          new Date(trade.expires_at).getTime() <= Date.now();
        const status = expired ? "expired" : trade.status;
        return (
          <article className="panel trade-offer-card" key={trade.id}>
            <div className="section-row">
              <div>
                <p className="eyebrow">
                  {incoming
                    ? `FROM ${managerMap.get(trade.proposer_id) ?? "MANAGER"}`
                    : `TO ${managerMap.get(trade.recipient_id) ?? "MANAGER"}`}
                </p>
                <h2>
                  {trade.counter_of
                    ? "Counteroffer"
                    : incoming
                      ? "Trade received"
                      : "Trade sent"}
                </h2>
              </div>
              <span className={`trade-status ${status}`}>{status}</span>
            </div>
            <div className="offer-sides">
              <div>
                <small>{incoming ? "YOU SEND" : "YOU OFFERED"}</small>
                {give.map((item) =>
                  item.players ? (
                    <span className="offer-player" key={item.player_id}>
                      <PlayerHeadshot
                        name={item.players.full_name}
                        position={item.players.position}
                        photoUrl={item.players.photo_url}
                      />
                      <strong>{item.players.full_name}</strong>
                    </span>
                  ) : (
                    <strong key={item.player_id}>Player</strong>
                  ),
                )}
              </div>
              <span>⇄</span>
              <div>
                <small>{incoming ? "YOU RECEIVE" : "YOU REQUESTED"}</small>
                {receive.map((item) =>
                  item.players ? (
                    <span className="offer-player" key={item.player_id}>
                      <PlayerHeadshot
                        name={item.players.full_name}
                        position={item.players.position}
                        photoUrl={item.players.photo_url}
                      />
                      <strong>{item.players.full_name}</strong>
                    </span>
                  ) : (
                    <strong key={item.player_id}>Player</strong>
                  ),
                )}
              </div>
            </div>
            {trade.note ? <p className="trade-note">“{trade.note}”</p> : null}
            <small className="trade-date">
              Sent {new Date(trade.created_at).toLocaleString()} ·{" "}
              {status === "pending"
                ? `expires ${new Date(trade.expires_at).toLocaleString()}`
                : status}
            </small>
            {status === "pending" && incoming ? (
              <div className="trade-actions trade-actions-three">
                <button
                  className="decline-button"
                  disabled={busy}
                  onClick={() => onRespond(trade.id, false)}
                >
                  Decline
                </button>
                <button
                  className="counter-button"
                  disabled={busy}
                  onClick={() => onCounter(trade)}
                >
                  Counter
                </button>
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => onRespond(trade.id, true)}
                >
                  Accept
                </button>
              </div>
            ) : null}
            {status === "pending" && !incoming ? (
              <button
                className="cancel-trade-button"
                disabled={busy}
                onClick={() => onCancel(trade.id)}
              >
                Cancel offer
              </button>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
