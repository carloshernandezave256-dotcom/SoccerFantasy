"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PageShell } from "@/components/page-shell";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague, setActiveLeagueId } from "@/lib/active-league";
import { ApiFootballTest } from "@/components/api-football-test";

type League = {
  league_id: string;
  league_name: string;
  invite_code: string;
  league_size: number;
  manager_count: number;
  team_name: string;
  is_commissioner: boolean;
  game_format: "draft" | "pack" | "auction";
  auction_style: "nomination" | "mystery" | null;
};
type Manager = { draft_slot: number; user_id: string; team_name: string };
type Draft = { status: "waiting" | "live" | "paused" | "complete" } | null;
type Settings = {
  league_name: string;
  joining_open: boolean;
  draft_pick_seconds: number;
  trades_enabled: boolean;
  lineup_lock_minutes: number;
  motm_manual: boolean;
  calendar_competition: string;
  player_pool: string;
};
type TransactionWindow = {
  gameweek: number;
  waiver_process_at: string;
  roster_lock_at: string;
  phase: string;
};

type GameFormat = "draft" | "pack" | "auction";

const GAME_FORMATS: Array<{
  id: GameFormat;
  icon: string;
  title: string;
  kicker: string;
  description: string;
  details: string[];
}> = [
  {
    id: "draft",
    icon: "⇄",
    title: "Draft League",
    kicker: "Classic fantasy",
    description:
      "Managers take turns building exclusive squads in a live snake draft.",
    details: [
      "Only one manager can own each player",
      "Randomized order reverses every round",
      "Best for a competitive, traditional draft night",
    ],
  },
  {
    id: "pack",
    icon: "▣",
    title: "Pack League",
    kicker: "Collect and trade",
    description:
      "Open packs, build a card collection and trade in a shared league economy.",
    details: [
      "Different managers can own the same player",
      "Starter packs, pack tokens and a 50-card limit",
      "Includes trading and the league auction house",
    ],
  },
  {
    id: "auction",
    icon: "◉",
    title: "Auction League",
    kicker: "Live open bidding",
    description:
      "Every manager receives a $2B budget and can bid live for exclusive players.",
    details: [
      "Every manager can bid on every player",
      "Highest bid wins one exclusive copy",
      "Choose nominations or mystery reveals in settings",
    ],
  },
];

function withTimeout<T>(
  request: PromiseLike<T>,
  milliseconds = 12000,
): Promise<T> {
  return Promise.race([
    Promise.resolve(request),
    new Promise<T>((_, reject) =>
      window.setTimeout(
        () => reject(new Error("The request timed out. Please try again.")),
        milliseconds,
      ),
    ),
  ]);
}

export default function LeaguePage() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [activeId, setActiveId] = useState("");
  const [managers, setManagers] = useState<Manager[]>([]);
  const [draft, setDraft] = useState<Draft>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [leagueView, setLeagueView] = useState<"data" | "settings">("data");
  const [transactionWindow, setTransactionWindow] =
    useState<TransactionWindow | null>(null);
  const [showMembership, setShowMembership] = useState(false);
  const [tab, setTab] = useState<"create" | "join">("create");
  const [creationStep, setCreationStep] = useState<"format" | "settings">(
    "format",
  );
  const [gameFormat, setGameFormat] = useState<GameFormat>("draft");
  const [auctionStyle, setAuctionStyle] = useState<"nomination" | "mystery">(
    "nomination",
  );
  const [playerPool, setPlayerPool] = useState("All Top Five");
  const [calendarCompetition, setCalendarCompetition] =
    useState("Premier League");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const active =
    leagues.find((league) => league.league_id === activeId) ??
    leagues[0] ??
    null;
  const selectedFormat =
    GAME_FORMATS.find((format) => format.id === gameFormat) ?? GAME_FORMATS[0];

  async function loadDetails(id: string) {
    const [orderResult, draftResult, settingsResult, windowResult] =
      await Promise.all([
        supabase.rpc("draft_order", { p_league_id: id }),
        supabase
          .from("drafts")
          .select("status")
          .eq("league_id", id)
          .maybeSingle(),
        supabase.rpc("league_settings", { p_league_id: id }),
        supabase.rpc("transaction_window", { p_league_id: id }),
      ]);
    if (orderResult.error) setMessage(orderResult.error.message);
    else setManagers((orderResult.data ?? []) as Manager[]);
    setDraft((draftResult.data as Draft) ?? null);
    if (settingsResult.error) setMessage(settingsResult.error.message);
    else setSettings(((settingsResult.data ?? [])[0] as Settings) ?? null);
    if (!windowResult.error)
      setTransactionWindow(
        ((windowResult.data ?? [])[0] as TransactionWindow) ?? null,
      );
  }

  async function load(preferred?: string) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setSignedIn(Boolean(user));
    if (!user) return;
    const { data, error } = await supabase.rpc("my_leagues");
    if (error) {
      setMessage(error.message);
      return;
    }
    const list = (data ?? []) as League[];
    const selected = resolveActiveLeague(list, preferred);
    const id = selected?.league_id ?? "";
    setLeagues(
      id
        ? [...list].sort(
            (a, b) => Number(b.league_id === id) - Number(a.league_id === id),
          )
        : list,
    );
    setActiveId(id);
    if (id) await loadDetails(id);
    else {
      setManagers([]);
      setDraft(null);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search),
      inviteCode = params.get("invite"),
      requested = params.get("league") ?? undefined;
    if (inviteCode) {
      setCode(inviteCode.toUpperCase());
      setTab("join");
      setShowMembership(true);
    }
    void load(requested);
  }, []);

  function openMembership() {
    setTab("create");
    setCreationStep("format");
    setShowMembership(true);
    setMessage("");
    window.requestAnimationFrame(() =>
      window.scrollTo({ top: 0, behavior: "smooth" }),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const formElement = event.currentTarget;
    if (!signedIn) {
      setSignedIn(false);
      setMessage("Log in first so this league can be saved to your account.");
      return;
    }
    setBusy(true);
    const form = new FormData(formElement);
    const args =
      tab === "create"
        ? {
            p_name: String(form.get("league")),
            p_team_name: String(form.get("team")),
            p_size: Number(form.get("size")),
            p_draft_pick_seconds: Number(form.get("draft_pick_seconds") ?? 90),
            p_trades_enabled: form.get("trades_enabled") === "on",
            p_lineup_lock_minutes: Number(form.get("lineup_lock_minutes")),
            p_game_format: gameFormat,
            p_calendar_competition:
              playerPool === "All Top Five" ? calendarCompetition : playerPool,
            p_player_pool: playerPool,
            p_auction_style: gameFormat === "auction" ? auctionStyle : null,
          }
        : {
            p_invite_code: code.toUpperCase(),
            p_team_name: String(form.get("team")),
          };
    try {
      const { data, error } = await withTimeout(
        supabase.rpc(tab === "create" ? "create_league" : "join_league", args),
      );
      if (error) setMessage(error.message);
      else {
        const id = String(data ?? "");
        setActiveLeagueId(id);
        formElement.reset();
        setCode("");
        if (tab === "create") {
          window.location.assign(`/?league=${encodeURIComponent(id)}`);
          return;
        }
        setMessage("You joined the league.");
        setShowMembership(false);
        await load(id);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The request could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function invite(league: League) {
    const url = `${window.location.origin}/login?invite=${league.invite_code}`;
    const share = {
      title: `Join ${league.league_name}`,
      text: `Join my ${league.league_name} fantasy soccer league with code ${league.invite_code}`,
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(share);
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    setMessage(`Invite link copied for ${league.league_name}.`);
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !settings) return;
    setSettingsBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const args = {
      p_league_id: active.league_id,
      p_name: String(form.get("league_name")),
      p_joining_open: form.get("joining_open") === "on",
      p_draft_pick_seconds: Number(
        form.get("draft_pick_seconds") ?? settings.draft_pick_seconds,
      ),
      p_trades_enabled: form.get("trades_enabled") === "on",
      p_lineup_lock_minutes: Number(form.get("lineup_lock_minutes")),
    };
    const { error } = await supabase.rpc("update_league_settings", args);
    if (error) setMessage(error.message);
    else {
      setMessage("League settings saved.");
      await load(active.league_id);
    }
    setSettingsBusy(false);
  }

  async function saveGameweek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setSettingsBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget),
      raw = String(form.get("first_kickoff") ?? "");
    const { error } = await supabase.rpc("set_transaction_window", {
      p_league_id: active.league_id,
      p_gameweek: Number(form.get("gameweek")),
      p_roster_lock_at: new Date(raw).toISOString(),
    });
    if (error) setMessage(error.message);
    else {
      setMessage(
        "Gameweek scheduled. Waivers will process Thursday at 8:00 AM Pacific.",
      );
      await loadDetails(active.league_id);
    }
    setSettingsBusy(false);
  }

  async function deleteLeague() {
    if (!active || !active.is_commissioner) return;
    const confirmed = window.confirm(
      `Permanently delete “${active.league_name}”?\n\nThis removes every manager, roster, draft pick, pack, waiver, trade, score and matchup in this league. This cannot be undone.`,
    );
    if (!confirmed) return;
    setSettingsBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("delete_league", {
      p_league_id: active.league_id,
      p_confirm_name: active.league_name,
    });
    if (error) setMessage(error.message);
    else {
      window.localStorage.removeItem("xi-fantasy-active-league");
      setMessage("League permanently deleted.");
      setActiveId("");
      await load();
    }
    setSettingsBusy(false);
  }

  const joiningLocked = Boolean(draft) || settings?.joining_open === false;
  return (
    <PageShell
      eyebrow="PRIVATE COMPETITION"
      title={active && !showMembership ? active.league_name : "Your leagues"}
    >
      {signedIn === false ? (
        <section className="panel empty-state">
          <strong>Log in to create or join a league.</strong>
          <p>
            Your leagues and commissioner settings are tied to your account.
          </p>
          <Link
            className="primary-button full-button"
            href="/login?next=/league"
          >
            Log in to continue
          </Link>
        </section>
      ) : active && !showMembership ? (
        <>
          <section className="panel league-identity">
            <div className="section-row">
              <div>
                <p className="eyebrow">
                  {active.is_commissioner ? "COMMISSIONER" : "LEAGUE MEMBER"}
                </p>
                <h2>{active.team_name}</h2>
              </div>
              <span
                className={`league-state ${joiningLocked ? "locked" : "open"}`}
              >
                {joiningLocked ? "JOINING LOCKED" : "JOINING OPEN"}
              </span>
            </div>
            <div className="league-code">
              <span>
                <small>INVITE CODE</small>
                <code>{active.invite_code}</code>
              </span>
              <button onClick={() => void invite(active)}>＋ Invite</button>
            </div>
            <p>
              {active.manager_count}/{active.league_size} managers · Draft{" "}
              {draft?.status ?? "not started"}
            </p>
          </section>
          <section
            className="segmented league-view-tabs"
            aria-label="League sections"
          >
            <button
              className={leagueView === "data" ? "active" : ""}
              onClick={() => setLeagueView("data")}
            >
              League Data
            </button>
            <button
              className={leagueView === "settings" ? "active" : ""}
              onClick={() => setLeagueView("settings")}
            >
              Settings
            </button>
          </section>
          {leagueView === "data" ? (
            <>
              <section className="panel league-overview">
                <div className="section-row">
                  <div>
                    <p className="eyebrow">COMPETITION STATUS</p>
                    <h2>
                      {active.game_format === "pack"
                        ? "Pack League"
                        : active.game_format === "auction"
                          ? "Auction League"
                          : "Draft League"}
                    </h2>
                  </div>
                  {active.game_format === "pack" ? (
                    <Link
                      className="league-primary-link"
                      href={`/packs?league=${active.league_id}`}
                    >
                      Open pack club →
                    </Link>
                  ) : active.game_format === "auction" &&
                    draft?.status !== "complete" ? (
                    <Link
                      className="league-primary-link"
                      href={`/auction?league=${active.league_id}`}
                    >
                      Open auction room →
                    </Link>
                  ) : draft?.status !== "complete" ? (
                    <Link
                      className="league-primary-link"
                      href={`/draft?league=${active.league_id}`}
                    >
                      Open draft room →
                    </Link>
                  ) : null}
                </div>
                <div className="league-data-grid">
                  <span>
                    <small>MANAGERS</small>
                    <strong>
                      {active.manager_count}/{active.league_size}
                    </strong>
                  </span>
                  <span>
                    <small>FORMAT</small>
                    <strong>
                      {active.game_format === "pack"
                        ? "Duplicates"
                        : active.game_format === "auction"
                          ? "$2B Auction"
                          : "Snake Draft"}
                    </strong>
                  </span>
                  <span>
                    <small>STATUS</small>
                    <strong>{draft?.status ?? "Waiting"}</strong>
                  </span>
                </div>
              </section>
              {settings ? (
                <section className="panel league-member-note">
                  <p className="eyebrow">PLAYER POOL · SEASON LOCKED</p>
                  <h2>{settings.player_pool}</h2>
                  <p>
                    {settings.player_pool === "All Top Five"
                      ? `${settings.calendar_competition} defines this league’s scoring windows and bye weeks. Players from all five supported leagues are eligible.`
                      : `Only ${settings.player_pool} players are eligible. Its official matchweeks automatically define the fantasy calendar.`}
                  </p>
                </section>
              ) : null}
              {transactionWindow && active.game_format !== "pack" ? (
                <section className="panel league-overview">
                  <div className="section-row">
                    <div>
                      <p className="eyebrow">CURRENT TRANSACTION WINDOW</p>
                      <h2>Gameweek {transactionWindow.gameweek}</h2>
                    </div>
                    <span className="muted-chip">
                      {transactionWindow.phase.replace("_", " ")}
                    </span>
                  </div>
                  <p className="league-data-copy">
                    Rosters lock{" "}
                    {new Date(
                      transactionWindow.roster_lock_at,
                    ).toLocaleString()}
                    .
                  </p>
                </section>
              ) : null}
              <section className="panel league-manager-list">
                <div className="section-row">
                  <div>
                    <p className="eyebrow">LEAGUE TABLE</p>
                    <h2>Managers</h2>
                  </div>
                  <span className="muted-chip">{managers.length}</span>
                </div>
                {managers.map((manager) => (
                  <article key={manager.user_id}>
                    <span>{manager.draft_slot}</span>
                    <strong>{manager.team_name}</strong>
                    {manager.draft_slot === 1 ? <small>COMMISH</small> : null}
                  </article>
                ))}
              </section>
            </>
          ) : (
            <>
              {!active.is_commissioner ? (
                <section className="panel league-settings-notice">
                  <p className="eyebrow">READ ONLY</p>
                  <h2>League settings</h2>
                  <p>
                    League settings are managed by the commissioner. Everyone
                    can view the rules below.
                  </p>
                </section>
              ) : null}
              {active.is_commissioner ? (
                <ApiFootballTest leagueId={active.league_id} />
              ) : null}
              {active.is_commissioner && settings ? (
                <>
                  <form
                    className="panel commissioner-settings settings-form"
                    onSubmit={saveSettings}
                  >
                    <div className="section-row">
                      <div>
                        <p className="eyebrow">LEAGUE RULES</p>
                        <h2>Commissioner settings</h2>
                      </div>
                      <span className="muted-chip">C</span>
                    </div>
                    <label className="settings-field">
                      <span>
                        <strong>League name</strong>
                        <small>Shown throughout the competition.</small>
                      </span>
                      <input
                        name="league_name"
                        defaultValue={settings.league_name}
                        minLength={2}
                        maxLength={60}
                        required
                      />
                    </label>
                    {active.game_format === "auction" ? (
                      <div className="settings-readonly">
                        <span>
                          <strong>Auction bid clock</strong>
                          <small>
                            Every new player opens for live league-wide bids.
                          </small>
                        </span>
                        <b>20 sec</b>
                        <input
                          type="hidden"
                          name="draft_pick_seconds"
                          value={settings.draft_pick_seconds}
                        />
                      </div>
                    ) : (
                      <label className="settings-field">
                        <span>
                          <strong>Draft clock</strong>
                          <small>Time allowed for each selection.</small>
                        </span>
                        <select
                          name="draft_pick_seconds"
                          defaultValue={settings.draft_pick_seconds}
                          disabled={Boolean(draft)}
                        >
                          <option value="30">30 seconds</option>
                          <option value="60">60 seconds</option>
                          <option value="90">90 seconds</option>
                          <option value="120">2 minutes</option>
                        </select>
                      </label>
                    )}
                    <label className="settings-toggle">
                      <span>
                        <strong>Allow new managers</strong>
                        <small>
                          {draft
                            ? "Automatically locked because the draft started."
                            : "Turn off to close invitations early."}
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        name="joining_open"
                        defaultChecked={settings.joining_open && !draft}
                        disabled={Boolean(draft)}
                      />
                      <i />
                    </label>
                    <label className="settings-toggle">
                      <span>
                        <strong>Enable trades</strong>
                        <small>
                          Managers exchange players directly. There is no
                          commissioner veto.
                        </small>
                      </span>
                      <input
                        type="checkbox"
                        name="trades_enabled"
                        defaultChecked={settings.trades_enabled}
                      />
                      <i />
                    </label>
                    <label className="settings-field">
                      <span>
                        <strong>Lineup lock</strong>
                        <small>
                          Applied relative to each player’s kickoff once match
                          data is connected.
                        </small>
                      </span>
                      <select
                        name="lineup_lock_minutes"
                        defaultValue={settings.lineup_lock_minutes}
                      >
                        <option value="0">At kickoff</option>
                        <option value="15">15 min before</option>
                        <option value="30">30 min before</option>
                        <option value="60">60 min before</option>
                      </select>
                    </label>
                    <div className="settings-readonly">
                      <span>
                        <strong>Man of the Match</strong>
                        <small>
                          Commissioner entry · +1 point; captain earns an
                          additional +4.
                        </small>
                      </span>
                      <b>MANUAL</b>
                    </div>
                    <button
                      className="primary-button full-button"
                      disabled={settingsBusy}
                    >
                      {settingsBusy ? "Saving…" : "Save settings"}
                    </button>
                  </form>
                  {active.game_format !== "pack" ? (
                    <form
                      className="panel commissioner-settings settings-form"
                      onSubmit={saveGameweek}
                    >
                      <div className="section-row">
                        <div>
                          <p className="eyebrow">BETA SCHEDULE</p>
                          <h2>Next transaction window</h2>
                        </div>
                        <span className="muted-chip">AUTO</span>
                      </div>
                      <label className="settings-field">
                        <span>
                          <strong>Gameweek</strong>
                          <small>
                            Waiver priority is randomized for this week.
                          </small>
                        </span>
                        <input
                          name="gameweek"
                          type="number"
                          min="1"
                          defaultValue={(transactionWindow?.gameweek ?? 0) + 1}
                          required
                        />
                      </label>
                      <label className="settings-field">
                        <span>
                          <strong>First match kickoff</strong>
                          <small>
                            Claims process Thursday at 8:00 AM Pacific; free
                            agency then stays open until this time.
                          </small>
                        </span>
                        <input
                          name="first_kickoff"
                          type="datetime-local"
                          required
                        />
                      </label>
                      {transactionWindow ? (
                        <div className="settings-readonly">
                          <span>
                            <strong>
                              Current GW {transactionWindow.gameweek}
                            </strong>
                            <small>
                              {transactionWindow.phase.replace("_", " ")} ·
                              locks{" "}
                              {new Date(
                                transactionWindow.roster_lock_at,
                              ).toLocaleString()}
                            </small>
                          </span>
                          <b>{transactionWindow.phase.toUpperCase()}</b>
                        </div>
                      ) : null}
                      <button
                        className="primary-button full-button"
                        disabled={settingsBusy}
                      >
                        {settingsBusy ? "Scheduling…" : "Schedule gameweek"}
                      </button>
                    </form>
                  ) : null}
                </>
              ) : settings ? (
                <section className="panel settings-readonly-list">
                  <div className="section-row">
                    <div>
                      <p className="eyebrow">LEAGUE RULES</p>
                      <h2>Current settings</h2>
                    </div>
                    <span className="muted-chip">VIEW</span>
                  </div>
                  <div>
                    <span>
                      <strong>League name</strong>
                      <small>Shown throughout the competition.</small>
                    </span>
                    <b>{settings.league_name}</b>
                  </div>
                  <div>
                    <span>
                      <strong>
                        {active.game_format === "auction"
                          ? "Auction bid clock"
                          : "Draft clock"}
                      </strong>
                      <small>
                        {active.game_format === "auction"
                          ? "Live bidding time for each player."
                          : "Time allowed for each selection."}
                      </small>
                    </span>
                    <b>
                      {active.game_format === "auction"
                        ? "20 sec"
                        : `${settings.draft_pick_seconds} sec`}
                    </b>
                  </div>
                  {active.game_format === "auction" ? (
                    <div>
                      <span>
                        <strong>Auction style</strong>
                        <small>Locked when the league was created.</small>
                      </span>
                      <b>
                        {active.auction_style === "mystery"
                          ? "Mystery Reveal"
                          : "Manager Nomination"}
                      </b>
                    </div>
                  ) : null}
                  <div>
                    <span>
                      <strong>New managers</strong>
                      <small>
                        Invitations close automatically after the draft starts.
                      </small>
                    </span>
                    <b>{joiningLocked ? "Closed" : "Open"}</b>
                  </div>
                  <div>
                    <span>
                      <strong>Trades</strong>
                      <small>Player-to-player with no commissioner veto.</small>
                    </span>
                    <b>{settings.trades_enabled ? "Enabled" : "Disabled"}</b>
                  </div>
                  <div>
                    <span>
                      <strong>Lineup lock</strong>
                      <small>Applied relative to each player’s kickoff.</small>
                    </span>
                    <b>
                      {settings.lineup_lock_minutes
                        ? `${settings.lineup_lock_minutes} min before`
                        : "At kickoff"}
                    </b>
                  </div>
                  <div>
                    <span>
                      <strong>Man of the Match</strong>
                      <small>+1 point; captain earns an additional +4.</small>
                    </span>
                    <b>Manual</b>
                  </div>
                </section>
              ) : null}
              {active.is_commissioner ? (
                <section className="panel">
                  <p className="eyebrow">DANGER ZONE</p>
                  <h2>Delete this league</h2>
                  <p className="league-member-note">
                    Permanently removes the league and all of its test activity
                    for every manager.
                  </p>
                  <button
                    type="button"
                    className="sign-out-button"
                    disabled={settingsBusy}
                    onClick={() => void deleteLeague()}
                  >
                    {settingsBusy ? "Deleting…" : "Delete league"}
                  </button>
                </section>
              ) : null}
            </>
          )}
          <button
            className="secondary-button full-button league-secondary-action"
            onClick={openMembership}
          >
            Create or join another league
          </button>
          {message ? <p className="form-message">{message}</p> : null}
        </>
      ) : (
        <>
          {leagues.length ? (
            <button
              className="text-button league-back"
              onClick={() => {
                setShowMembership(false);
                setMessage("");
              }}
            >
              ← Back to league controls
            </button>
          ) : null}
          <section className="segmented">
            <button
              className={tab === "create" ? "active" : ""}
              onClick={() => {
                setTab("create");
                setCreationStep("format");
                setMessage("");
              }}
            >
              Create
            </button>
            <button
              className={tab === "join" ? "active" : ""}
              onClick={() => {
                setTab("join");
                setMessage("");
              }}
            >
              Join
            </button>
          </section>
          {tab === "create" && creationStep === "format" ? (
            <section
              className="league-format-step"
              aria-labelledby="format-title"
            >
              <div className="league-format-heading">
                <p className="eyebrow">CHOOSE YOUR GAME</p>
                <h2 id="format-title">Three ways to build a champion</h2>
                <p>
                  Pick a format to see how it works. You will choose the league
                  rules on the next screen.
                </p>
              </div>
              <div className="league-format-gallery">
                {GAME_FORMATS.map((format) => (
                  <button
                    key={format.id}
                    type="button"
                    className={`league-format-poster league-format-${format.id}${
                      gameFormat === format.id ? " active" : ""
                    }`}
                    aria-pressed={gameFormat === format.id}
                    onClick={() => setGameFormat(format.id)}
                  >
                    <span className="league-format-icon" aria-hidden="true">
                      {format.icon}
                    </span>
                    <small>{format.kicker}</small>
                    <strong>{format.title}</strong>
                    <span>{format.description}</span>
                  </button>
                ))}
              </div>
              <div className="league-format-explainer">
                <p className="eyebrow">{selectedFormat.title.toUpperCase()}</p>
                <h3>{selectedFormat.description}</h3>
                <div>
                  {selectedFormat.details.map((detail) => (
                    <span key={detail}>✓ {detail}</span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                className="primary-button"
                onClick={() => {
                  setCreationStep("settings");
                  window.requestAnimationFrame(() =>
                    window.scrollTo({ top: 0, behavior: "smooth" }),
                  );
                }}
              >
                Continue with {selectedFormat.title}
              </button>
            </section>
          ) : null}
          {tab === "create" && creationStep === "settings" ? (
            <section className="panel form-card">
              <button
                type="button"
                className="text-button creation-format-back"
                onClick={() => {
                  setCreationStep("format");
                  window.requestAnimationFrame(() =>
                    window.scrollTo({ top: 0, behavior: "smooth" }),
                  );
                }}
              >
                ← Change game type
              </button>
              <p className="creation-selected-format">
                <span>{selectedFormat.icon}</span>
                <strong>{selectedFormat.title} settings</strong>
              </p>
              <div className="form-section-title">
                <p className="eyebrow">PLAYER POOL</p>
                <strong>Choose who can be owned in this league</strong>
              </div>
              <label>
                Eligible players
                <select
                  value={playerPool}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPlayerPool(value);
                    if (value !== "All Top Five") setCalendarCompetition(value);
                  }}
                >
                  <option>All Top Five</option>
                  <option>Premier League</option>
                  <option>La Liga</option>
                  <option>Serie A</option>
                  <option>Bundesliga</option>
                  <option>Ligue 1</option>
                </select>
              </label>
              <p>
                All Top Five is the signature cross-league experience. Choosing
                one competition limits the draft, packs, waivers and trades to
                players from that league.
              </p>
              <div className="form-section-title">
                <p className="eyebrow">FANTASY CALENDAR</p>
                <strong>Choose the competition your season follows</strong>
              </div>
              <label>
                Schedule league
                <select
                  value={
                    playerPool === "All Top Five"
                      ? calendarCompetition
                      : playerPool
                  }
                  disabled={playerPool !== "All Top Five"}
                  onChange={(event) =>
                    setCalendarCompetition(event.target.value)
                  }
                >
                  <option>Premier League</option>
                  <option>La Liga</option>
                  <option>Serie A</option>
                  <option>Bundesliga</option>
                  <option>Ligue 1</option>
                </select>
              </label>
              <div className="creation-rule-summary">
                <strong>How your fantasy calendar works</strong>
                <span>
                  {playerPool === "All Top Five"
                    ? `${calendarCompetition} matchweeks become this fantasy league’s official matchweeks.`
                    : `${playerPool} matchweeks automatically become this fantasy league’s official matchweeks.`}
                </span>
                <span>
                  Your weekly score is the total earned by your locked Starting
                  XI during that official matchweek’s fixtures.
                </span>
                <span>
                  {playerPool === "All Top Five"
                    ? `Players from the other supported leagues count only when their fixtures fall inside the ${calendarCompetition} matchweek window.`
                    : `Only ${playerPool} players are eligible and score.`}
                </span>
                <span>
                  If the selected competition has no matchweek, every manager
                  has a bye and no matchup is calculated.
                </span>
              </div>
              <p className="form-message">
                <strong>Season lock:</strong> the player pool and fantasy
                calendar cannot be changed after the league is created.
              </p>
            </section>
          ) : null}
          {tab === "join" || creationStep === "settings" ? (
            <form
              className="panel form-card create-league-form"
              onSubmit={submit}
            >
              {tab === "create" ? (
                <>
                <div className="form-section-title">
                  <p className="eyebrow">IDENTITY</p>
                  <strong>Name your competition</strong>
                </div>
                <label>
                  League name
                  <input
                    name="league"
                    placeholder="Central Valley Champions"
                    minLength={2}
                    required
                  />
                </label>
                <label>
                  Your team name
                  <input
                    name="team"
                    placeholder="Barrio XI"
                    minLength={2}
                    required
                  />
                </label>
                <label>
                  League capacity
                  <select name="size" defaultValue="10">
                    <option value="8">8 managers</option>
                    <option value="10">10 managers</option>
                    <option value="12">12 managers</option>
                  </select>
                </label>
                {gameFormat === "auction" ? (
                  <>
                    <div className="form-section-title">
                      <p className="eyebrow">AUCTION STYLE</p>
                      <strong>Choose how players enter the room</strong>
                    </div>
                    <div className="format-choice auction-style-choice">
                      <button
                        type="button"
                        className={
                          auctionStyle === "nomination" ? "active" : ""
                        }
                        aria-pressed={auctionStyle === "nomination"}
                        onClick={() => setAuctionStyle("nomination")}
                      >
                        <span>◎</span>
                        <strong>Manager Nomination</strong>
                        <small>
                          Random order · managers choose each player
                        </small>
                      </button>
                      <button
                        type="button"
                        className={auctionStyle === "mystery" ? "active" : ""}
                        aria-pressed={auctionStyle === "mystery"}
                        onClick={() => setAuctionStyle("mystery")}
                      >
                        <span>?</span>
                        <strong>Mystery Reveal</strong>
                        <small>The app randomly reveals each player</small>
                      </button>
                    </div>
                  </>
                ) : null}
                <div className="form-section-title">
                  <p className="eyebrow">RULES</p>
                  <strong>Set up your league</strong>
                </div>
                {gameFormat === "draft" ? (
                  <label>
                    Draft clock
                    <select name="draft_pick_seconds" defaultValue="90">
                      <option value="30">30 seconds per pick</option>
                      <option value="60">60 seconds per pick</option>
                      <option value="90">90 seconds per pick</option>
                      <option value="120">2 minutes per pick</option>
                    </select>
                  </label>
                ) : (
                  <input type="hidden" name="draft_pick_seconds" value="90" />
                )}
                <label>
                  Lineup lock
                  <select name="lineup_lock_minutes" defaultValue="0">
                    <option value="0">At each player’s kickoff</option>
                    <option value="15">15 minutes before kickoff</option>
                    <option value="30">30 minutes before kickoff</option>
                    <option value="60">60 minutes before kickoff</option>
                  </select>
                </label>
                <label className="creation-toggle">
                  <span>
                    <strong>Allow trades</strong>
                    <small>
                      Managers can exchange equal numbers of players.
                    </small>
                  </span>
                  <input name="trades_enabled" type="checkbox" defaultChecked />
                </label>
                <div className="creation-rule-summary">
                  <strong>
                    {gameFormat === "draft"
                      ? "Draft League beta rules"
                      : gameFormat === "pack"
                        ? "Pack League beta rules"
                        : "Auction League beta rules"}
                  </strong>
                  {gameFormat === "draft" ? (
                    <span>3 managers minimum to draft</span>
                  ) : gameFormat === "pack" ? (
                    <>
                      <span>
                        22-card starter bundle · 50-card collection limit
                      </span>
                      <span>
                        Duplicates, pack tokens and league auction house
                      </span>
                    </>
                  ) : (
                    <>
                      <span>$2B per manager · $1M bid increments</span>
                      <span>Exclusive players · live open bidding</span>
                      <span>
                        {auctionStyle === "nomination"
                          ? "Random nomination order"
                          : "Random Mystery Reveal players"}
                      </span>
                    </>
                  )}
                  <span>18-player squads · 11 starters · 7 bench</span>
                  <span>Manual MOTM: +1, plus +4 when captain</span>
                  <span>Season-long standings · No playoffs</span>
                </div>
                </>
              ) : (
                <>
                <label>
                  Invite code
                  <input
                    name="code"
                    value={code}
                    onChange={(event) =>
                      setCode(event.target.value.toUpperCase())
                    }
                    placeholder="XI-A1B2C3"
                    required
                  />
                </label>
                <label>
                  Your team name
                  <input
                    name="team"
                    placeholder="Barrio XI"
                    minLength={2}
                    required
                  />
                </label>
                </>
              )}
              <button className="primary-button" disabled={busy}>
                {busy
                  ? "Saving…"
                  : tab === "create"
                    ? `Create ${gameFormat === "draft" ? "Draft" : gameFormat === "pack" ? "Pack" : "Auction"} League`
                    : "Join league"}
              </button>
              {message ? <p className="form-message">{message}</p> : null}
            </form>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
