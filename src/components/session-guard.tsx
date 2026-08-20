"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const PUBLIC_ROUTES = ["/login", "/auth/callback", "/practice-draft"];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const publicRoute = isPublicRoute(pathname);
  const [sessionReady, setSessionReady] = useState(publicRoute);

  useEffect(() => {
    if (publicRoute) {
      setSessionReady(true);
      return;
    }

    let active = true;
    setSessionReady(false);

    const sendToLogin = () => {
      if (!active) return;
      setSessionReady(false);
      router.replace("/login");
    };

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active) return;

      if (error || !data.user) {
        sendToLogin();
        return;
      }

      setSessionReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        sendToLogin();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [publicRoute, router]);

  if (!publicRoute && !sessionReady) return null;

  return children;
}
