"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Confirming your account…");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const requested = params.get("next") || "/league";
    const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/league";
    if (!code) {
      setMessage("This confirmation link is incomplete. Please request a new email.");
      return;
    }
    void supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
      if (error) setMessage(error.message);
      else router.replace(next);
    });
  }, [router]);

  return <main className="auth-shell"><div className="brand-mark">XI</div><p className="eyebrow">ACCOUNT CONFIRMATION</p><h1>Welcome to the league.</h1><p className="auth-copy">{message}</p></main>;
}
