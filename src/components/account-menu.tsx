"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { resolveActiveLeague, setActiveLeagueId } from "@/lib/active-league";

type Profile = {
  display_name: string;
  avatar_url: string | null;
  theme_preference: "system" | "light" | "dark";
  notifications_enabled: boolean;
};
type League = {
  league_id: string;
  league_name: string;
  team_name: string;
  game_format: "draft" | "pack" | "auction";
};
function applyTheme(theme: Profile["theme_preference"]) {
  document.documentElement.dataset.theme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
}

export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [leagues, setLeagues] = useState<League[]>([]);
  const [activeLeagueId, setActiveId] = useState("");
  async function load() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    setEmail(user.email ?? "");
    const [profileResult, leagueResult] = await Promise.all([
      supabase.rpc("my_profile"),
      supabase.rpc("my_leagues"),
    ]);
    const saved = ((profileResult.data ?? [])[0] as Profile | undefined) ?? {
      display_name: String(
        user.user_metadata?.display_name ??
          user.email?.split("@")[0] ??
          "Manager",
      ),
      avatar_url: null,
      theme_preference: "system",
      notifications_enabled: true,
    };
    const leagueList = (leagueResult.data ?? []) as League[];
    const active = resolveActiveLeague(
      leagueList,
      new URLSearchParams(window.location.search).get("league"),
    );
    const activeLeagueId = active?.league_id ?? "";
    setLeagues(
      activeLeagueId
        ? [...leagueList].sort(
            (a, b) =>
              Number(b.league_id === activeLeagueId) -
              Number(a.league_id === activeLeagueId),
          )
        : leagueList,
    );
    setActiveId(activeLeagueId);
    setProfile(saved);
    if (saved.avatar_url) {
      const { data: signed } = await supabase.storage
        .from("avatars")
        .createSignedUrl(saved.avatar_url, 3600);
      setAvatarPreview(signed?.signedUrl ?? null);
    }
    applyTheme(saved.theme_preference);
  }
  useEffect(() => {
    void load();
  }, []);
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !profile) return;
    if (file.size > 3145728) {
      setMessage("Choose an image smaller than 3 MB.");
      return;
    }
    setBusy(true);
    setMessage("");
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${user.id}/profile.${extension}`;
    const { error } = await supabase.storage
      .from("avatars")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) setMessage(error.message);
    else {
      const { data: signed } = await supabase.storage
        .from("avatars")
        .createSignedUrl(path, 3600);
      setAvatarPreview(signed?.signedUrl ?? null);
      setProfile({ ...profile, avatar_url: path });
      setMessage("Photo ready. Save your profile to keep it.");
    }
    setBusy(false);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("update_my_profile", {
      p_display_name: profile.display_name,
      p_avatar_url: profile.avatar_url ?? "",
      p_theme_preference: profile.theme_preference,
      p_notifications_enabled: profile.notifications_enabled,
    });
    setMessage(error ? error.message : "Profile saved.");
    if (!error) router.refresh();
    setBusy(false);
  }
  async function changeTheme(theme: Profile["theme_preference"]) {
    if (!profile || busy) return;
    const previous = profile;
    const next = { ...profile, theme_preference: theme };
    setProfile(next);
    applyTheme(theme);
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("update_my_profile", {
      p_display_name: next.display_name,
      p_avatar_url: next.avatar_url ?? "",
      p_theme_preference: theme,
      p_notifications_enabled: next.notifications_enabled,
    });
    if (error) {
      setProfile(previous);
      applyTheme(previous.theme_preference);
      setMessage(error.message);
    } else setMessage("Appearance saved.");
    setBusy(false);
  }
  async function signOut() {
    await supabase.auth.signOut();
    setOpen(false);
    router.push("/login");
    router.refresh();
  }
  function switchLeague(id: string) {
    const league = leagues.find((item) => item.league_id === id);
    if (!league) return;
    setActiveLeagueId(id);
    setActiveId(id);
    setOpen(false);
    const path = window.location.pathname;
    const room =
      league.game_format === "pack"
        ? "/packs"
        : league.game_format === "auction"
          ? "/auction"
          : "/draft";
    const target =
      path === "/draft" || path === "/auction"
        ? room
        : path === "/packs" || path === "/waivers" || path === "/players"
          ? "/players"
          : path;
    window.location.href = `${target}?league=${id}`;
  }
  const initials = (profile?.display_name ?? "C")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <>
      <button
        className={`account-trigger ${compact ? "compact" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Open personal settings"
      >
        {avatarPreview ? (
          <img src={avatarPreview} alt="Your profile" />
        ) : (
          <span>{initials || "C"}</span>
        )}
      </button>
      {open ? (
        <div
          className="account-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Personal settings"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <form className="account-sheet" onSubmit={save}>
            <div className="account-sheet-head">
              <div>
                <p className="eyebrow">PERSONAL SETTINGS</p>
                <h2>Your profile</h2>
              </div>
              <button
                type="button"
                className="account-close"
                onClick={() => setOpen(false)}
              >
                ×
              </button>
            </div>
            {leagues.length > 1 ? (
              <label className="account-field active-league-field">
                <span>Active league</span>
                <select
                  value={activeLeagueId}
                  onChange={(event) => switchLeague(event.target.value)}
                >
                  {leagues.map((league) => (
                    <option key={league.league_id} value={league.league_id}>
                      {league.league_name} ·{" "}
                      {league.game_format === "pack" ? "Pack" : "Draft"}
                    </option>
                  ))}
                </select>
                <small>Changes the league used across every page.</small>
              </label>
            ) : null}
            <div className="profile-photo-row">
              <label className="profile-photo">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Your selected profile" />
                ) : (
                  <span>{initials || "C"}</span>
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={upload}
                  disabled={busy}
                />
              </label>
              <div>
                <strong>Profile picture</strong>
                <small>Tap the picture to choose a photo.</small>
                <small>JPG, PNG or WebP · 3 MB max</small>
              </div>
            </div>
            <label className="account-field">
              <span>Display name</span>
              <input
                value={profile?.display_name ?? ""}
                onChange={(event) =>
                  profile &&
                  setProfile({ ...profile, display_name: event.target.value })
                }
                minLength={2}
                maxLength={40}
                required
              />
            </label>
            <div className="account-readonly">
              <span>
                <strong>Email</strong>
                <small>{email}</small>
              </span>
              <b>ACCOUNT</b>
            </div>
            <fieldset className="appearance-options">
              <legend>Appearance</legend>
              {(["system", "light", "dark"] as const).map((theme) => (
                <button
                  type="button"
                  disabled={busy}
                  className={
                    profile?.theme_preference === theme ? "active" : ""
                  }
                  key={theme}
                  onClick={() => void changeTheme(theme)}
                >
                  {theme === "system"
                    ? "Auto"
                    : theme[0].toUpperCase() + theme.slice(1)}
                </button>
              ))}
            </fieldset>
            <label className="account-toggle">
              <span>
                <strong>Notifications</strong>
                <small>League activity and important reminders.</small>
              </span>
              <input
                type="checkbox"
                checked={profile?.notifications_enabled ?? true}
                onChange={(event) =>
                  profile &&
                  setProfile({
                    ...profile,
                    notifications_enabled: event.target.checked,
                  })
                }
              />
              <i />
            </label>
            {message ? <p className="form-message">{message}</p> : null}
            <button
              className="primary-button full-button"
              disabled={busy || !profile}
            >
              {busy ? "Saving…" : "Save profile"}
            </button>
            <button
              type="button"
              className="sign-out-button"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
