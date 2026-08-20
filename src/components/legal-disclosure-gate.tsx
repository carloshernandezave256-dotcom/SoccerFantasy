"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { LEGAL_DISCLOSURE_VERSION, requiresLegalDisclosure } from "@/lib/legal-disclosure";

const sections = [
  ["Your Privacy", "We respect your privacy. We do not sell your personal information or share it with third parties for advertising or marketing purposes. Information necessary to operate My Fantasy XI may be processed by trusted service providers that help us provide the platform, such as authentication, database, and hosting services."],
  ["Fantasy Data & Errors", "My Fantasy XI uses sports statistics and other information from third-party data sources. While we work to keep information accurate, player data, scores, statistics, rankings, availability, match information, and fantasy results may occasionally contain errors, delays, or corrections. We reserve the right to correct inaccurate data or fantasy scoring when necessary."],
  ["Trademarks & Third-Party Content", "Club names, league names, competition names, player names, logos, trademarks, and other third-party intellectual property belong to their respective owners. Their appearance on My Fantasy XI does not imply ownership, sponsorship, or endorsement by those parties."],
  ["Independent Fantasy Platform", "My Fantasy XI is an independent fantasy sports platform. It is not affiliated with, sponsored by, or endorsed by FIFA, UEFA, any domestic football league, football club, player, governing body, or other organization referenced on the platform."],
] as const;

type DisclosureStatus = {
  legal_disclosure_version: string | null;
  legal_disclosure_accepted_at: string | null;
};

export function LegalDisclosureGate() {
  const [required, setRequired] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function refresh() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active) return;
      if (!user) {
        setRequired(false);
        return;
      }
      const { data, error } = await supabase.rpc("my_legal_disclosure_status");
      if (!active) return;
      if (error) {
        setMessage("We could not verify your account disclosure. Please refresh and try again.");
        setRequired(true);
        return;
      }

      const status = (data?.[0] ?? null) as DisclosureStatus | null;
      setRequired(requiresLegalDisclosure(status?.legal_disclosure_version, status?.legal_disclosure_accepted_at));
      setMessage("");
    }

    void refresh();
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      window.setTimeout(() => { void refresh(); }, 0);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function accept() {
    if (!checked || busy) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.rpc("accept_legal_disclosure", { p_version: LEGAL_DISCLOSURE_VERSION });
    setBusy(false);
    if (error) {
      setMessage("Your acceptance could not be saved. Please try again.");
      return;
    }
    setRequired(false);
  }

  if (!required) return null;

  return <div className="legal-gate" role="dialog" aria-modal="true" aria-labelledby="legal-disclosure-title">
    <section className="legal-card">
      <header className="legal-header">
        <div className="auth-brand"><span>XI</span><strong>MY FANTASY XI</strong></div>
        <p className="eyebrow">CLOSED BETA · {LEGAL_DISCLOSURE_VERSION}</p>
        <h1 id="legal-disclosure-title">Beta Account Disclosure</h1>
        <p>Please review these essentials before entering your dashboard.</p>
      </header>
      <div className="legal-copy">
        {sections.map(([title, copy]) => <section key={title}><h2>{title}</h2><p>{copy}</p></section>)}
      </div>
      <footer className="legal-actions">
        <label className="legal-check">
          <input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />
          <span>I have read and agree to the My Fantasy XI Beta Account Disclosure.</span>
        </label>
        {message ? <p className="form-message" role="alert">{message}</p> : null}
        <button className="primary-button" type="button" disabled={!checked || busy} onClick={accept}>{busy ? "Saving…" : "Continue"}</button>
      </footer>
    </section>
  </div>;
}
