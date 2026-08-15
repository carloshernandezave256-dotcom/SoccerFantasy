"use client";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    if (!isSupabaseConfigured) { setMessage("Preview mode: Supabase is not configured."); setBusy(false); return; }
    const search = new URLSearchParams(window.location.search);
    const invite = search.get("invite");
    const requested = search.get("next");
    const safeNext = requested?.startsWith("/") && !requested.startsWith("//") ? requested : null;
    const next = safeNext ?? (invite ? `/league?invite=${encodeURIComponent(invite)}` : "/league");
    const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const result = mode === "signup" ? await supabase.auth.signUp({ email, password, options: { data: { display_name: name }, emailRedirectTo: callback } }) : await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); if (result.error) return setMessage(result.error.message);
    if (result.data.session) router.push(next); else setMessage(invite ? "Check your email to confirm your account, then reopen the invite link and log in." : "Check your email to confirm your account, then log in.");
  }
  return <main className="auth-shell"><div className="brand-mark">XI</div><p className="eyebrow">TOP FIVE LEAGUES · ONE DRAFT</p><h1>Build your football world.</h1><p className="auth-copy">Exclusive players. Weekly head-to-head battles. Your league, your legacy.</p><form className="form-card" onSubmit={submit}>{mode === "signup" ? <label>Manager name<input value={name} onChange={e=>setName(e.target.value)} minLength={2} required /></label> : null}<label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label><button className="primary-button" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create account" : "Log in"}</button>{message ? <p className="form-message">{message}</p> : null}</form><button className="text-button auth-toggle" onClick={()=>setMode(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Already have an account? Log in" : "New manager? Create an account"}</button></main>;
}
