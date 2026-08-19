"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [betaCode, setBetaCode] = useState("");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("mode") === "login") setMode("login");
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    if (!isSupabaseConfigured) { setMessage("Preview mode: Supabase is not configured."); setBusy(false); return; }
    const search = new URLSearchParams(window.location.search);
    const invite = search.get("invite");
    const requested = search.get("next");
    const safeNext = requested?.startsWith("/") && !requested.startsWith("//") ? requested : null;
    const next = safeNext ?? (invite ? `/league?invite=${encodeURIComponent(invite)}` : "/league");
    if (mode === "signup") {
      const response = await fetch("/api/auth/beta-signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, password, betaCode }) });
      const body = await response.json().catch(() => ({ error: "Your account could not be created." }));
      if (!response.ok) { setBusy(false); setMessage(body.error); return; }
    }
    const result = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false); if (result.error) return setMessage(result.error.message);
    router.push(next);
  }
  return <main className="auth-page">
    <section className="auth-visual" aria-hidden="true">
      <Image src="/home/my-fantasy-xi-hero.webp" alt="" fill priority sizes="(min-width: 760px) 50vw, 100vw" />
      <div><p className="eyebrow">MY FANTASY XI</p><h2>Every decision<br />shapes your season.</h2></div>
    </section>
    <section className="auth-panel">
      <Link className="auth-home-link" href="/">← Back to home</Link>
      <div className="auth-brand"><span>XI</span><strong>MY FANTASY XI</strong></div>
      <div className="auth-content">
        <p className="eyebrow">{mode === "signup" ? "WELCOME, MANAGER" : "WELCOME BACK"}</p>
        <h1>{mode === "signup" ? "Create your account." : "Log in to your club."}</h1>
        <p className="auth-copy">{mode === "signup" ? "Join a league, build your squad and start competing." : "Your leagues, lineups and matchups are waiting."}</p>
        <div className="auth-mode" role="tablist" aria-label="Account action">
          <button type="button" className={mode === "signup" ? "active" : ""} onClick={()=>setMode("signup")}>Create account</button>
          <button type="button" className={mode === "login" ? "active" : ""} onClick={()=>setMode("login")}>Log in</button>
        </div>
        <form className="form-card auth-form" onSubmit={submit}>
          {mode === "signup" ? <label>Manager name<input autoComplete="name" value={name} onChange={e=>setName(e.target.value)} minLength={2} required /></label> : null}
          <label>Email<input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} required /></label>
          <label>Password<input type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label>
          {mode === "signup" ? <label>Beta access code<input autoComplete="off" value={betaCode} onChange={e=>setBetaCode(e.target.value)} required /><small>My Fantasy XI is currently invite-only.</small></label> : null}
          <button className="primary-button" disabled={busy}>{busy ? "Working…" : mode === "signup" ? "Create account" : "Log in"}</button>
          {message ? <p className="form-message" role="status">{message}</p> : null}
        </form>
        <p className="auth-note">By continuing, you agree to use My Fantasy XI responsibly and keep your account secure.</p>
      </div>
    </section>
  </main>;
}
