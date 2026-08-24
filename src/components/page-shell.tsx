"use client";

import Link from "next/link";
import { BottomNav } from "./bottom-nav";
import { AccountMenu } from "./account-menu";
import { useLanguage } from "@/lib/i18n";
import { usePathname } from "next/navigation";

const rootTabs = new Set(["/", "/matchup", "/team", "/players", "/league"]);

export function PageShell({ eyebrow, title, children, leagueId }: { eyebrow: string; title: string; children: React.ReactNode; leagueId?: string }) {
  const { t } = useLanguage();
  const pathname = usePathname();
  const showBack = !rootTabs.has(pathname);
  return <main className="app-shell"><header className={`sub-header${showBack?"":" root-tab-header"}`}>{showBack?<Link href="/" aria-label="Back to Home">←</Link>:null}<div><p className="eyebrow">{t(`shell.${eyebrow}`, eyebrow)}</p><h1>{t(`shell.${title}`, title)}</h1></div><AccountMenu compact/></header>{children}<BottomNav leagueId={leagueId}/></main>;
}
