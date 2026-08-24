"use client";

import { useCallback, useEffect, useState } from "react";
import { resolveActiveLeague } from "@/lib/active-league";
import { supabase } from "@/lib/supabase";
import { DraftRoomChat } from "./draft-room-chat";

type League = { league_id: string };
type Manager = { user_id: string; team_name: string };

export function LeagueChat() {
  const [leagueId, setLeagueId] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);

  const load = useCallback(async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) {
      setLeagueId("");
      setUserId(null);
      return;
    }
    const { data } = await supabase.rpc("my_leagues");
    const requested = new URLSearchParams(window.location.search).get("league");
    const active = resolveActiveLeague((data ?? []) as League[], requested);
    setUserId(authData.user.id);
    setLeagueId(active?.league_id ?? "");
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("xi-active-league-change", refresh);
    window.addEventListener("popstate", refresh);
    return () => {
      window.removeEventListener("xi-active-league-change", refresh);
      window.removeEventListener("popstate", refresh);
    };
  }, [load]);

  useEffect(() => {
    if (!leagueId) {
      setManagers([]);
      return;
    }
    let active = true;
    void supabase
      .rpc("draft_order", { p_league_id: leagueId })
      .then(({ data }) => {
        if (active) setManagers((data ?? []) as Manager[]);
      });
    return () => {
      active = false;
    };
  }, [leagueId]);

  if (!leagueId || !userId) return null;
  return (
    <DraftRoomChat
      leagueId={leagueId}
      currentUserId={userId}
      managers={managers}
      roomName="League"
    />
  );
}
