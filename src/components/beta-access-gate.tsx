"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function BetaAccessGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let active = true;
    async function refresh() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!active || !user) {
        if (active) setBlocked(false);
        return;
      }
      const { data, error } = await supabase.rpc("my_beta_access_status");
      if (!active) return;
      setBlocked(Boolean(error) || !data);
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

  async function signOut() {
    await supabase.auth.signOut();
    window.location.assign("/login?mode=login");
  }

  if (!blocked) return null;
  return <div className="legal-gate beta-block" role="dialog" aria-modal="true" aria-labelledby="beta-access-title">
    <section className="legal-card beta-block-card">
      <div className="auth-brand"><span>XI</span><strong>MY FANTASY XI</strong></div>
      <p className="eyebrow">CLOSED BETA</p>
      <h1 id="beta-access-title">This account needs beta access.</h1>
      <p>My Fantasy XI is currently invite-only. Create an approved account using a valid beta access code.</p>
      <button className="primary-button" type="button" onClick={signOut}>Return to login</button>
    </section>
  </div>;
}
