"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

type Manager = { user_id: string; team_name: string };
type ChatMessage = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

export function DraftRoomChat({
  leagueId,
  currentUserId,
  managers,
  roomName,
}: {
  leagueId: string;
  currentUserId: string | null;
  managers: Manager[];
  roomName: "Draft" | "Auction";
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [unread, setUnread] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const openRef = useRef(false);
  const currentUserRef = useRef(currentUserId);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  useEffect(() => {
    currentUserRef.current = currentUserId;
  }, [currentUserId]);

  useEffect(() => {
    let active = true;
    void supabase
      .from("draft_room_messages")
      .select("id,user_id,body,created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError("Chat is unavailable until its database update is applied.");
        else setMessages(((data ?? []) as ChatMessage[]).reverse());
      });

    const channel = supabase
      .channel(`draft-chat:${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_room_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const incoming = payload.new as ChatMessage;
          setMessages((current) =>
            current.some((message) => message.id === incoming.id)
              ? current
              : [...current, incoming].slice(-100),
          );
          if (!openRef.current && incoming.user_id !== currentUserRef.current)
            setUnread((count) => count + 1);
        },
      )
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [leagueId]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || !currentUserId || sending) return;
    setSending(true);
    setError("");
    const { data, error: sendError } = await supabase
      .from("draft_room_messages")
      .insert({ league_id: leagueId, user_id: currentUserId, body })
      .select("id,user_id,body,created_at")
      .single();
    if (sendError) setError(sendError.message);
    else {
      const sent = data as ChatMessage;
      setMessages((current) =>
        current.some((message) => message.id === sent.id)
          ? current
          : [...current, sent].slice(-100),
      );
      setDraft("");
    }
    setSending(false);
  }

  const teamName = (userId: string) =>
    managers.find((manager) => manager.user_id === userId)?.team_name ?? "Manager";

  return (
    <div className={`draft-chat ${open ? "open" : ""}`}>
      {open ? (
        <section className="draft-chat-panel" role="dialog" aria-label={`${roomName} room chat`}>
          <header>
            <span>
              <small>LIVE CHAT</small>
              <strong>{roomName} room</strong>
            </span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat">
              ×
            </button>
          </header>
          <div className="draft-chat-messages" aria-live="polite">
            {messages.length ? (
              messages.map((message) => {
                const mine = message.user_id === currentUserId;
                return (
                  <article className={mine ? "mine" : ""} key={message.id}>
                    <div>
                      <strong>{mine ? "You" : teamName(message.user_id)}</strong>
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    <p>{message.body}</p>
                  </article>
                );
              })
            ) : (
              <p className="draft-chat-empty">The room is quiet. Start the conversation.</p>
            )}
            <div ref={endRef} />
          </div>
          {error ? <p className="draft-chat-error">{error}</p> : null}
          <form onSubmit={send}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={300}
              placeholder="Message the league…"
              aria-label="Chat message"
              autoComplete="off"
              enterKeyHint="send"
            />
            <button type="submit" disabled={!draft.trim() || !currentUserId || sending}>
              {sending ? "…" : "Send"}
            </button>
          </form>
        </section>
      ) : (
        <button
          type="button"
          className="draft-chat-launcher"
          onClick={() => setOpen(true)}
          aria-label={`Open ${roomName.toLowerCase()} room chat${unread ? `, ${unread} unread messages` : ""}`}
        >
          <span aria-hidden="true">✉</span>
          <strong>Chat</strong>
          {unread ? <b>{unread > 9 ? "9+" : unread}</b> : null}
        </button>
      )}
    </div>
  );
}
