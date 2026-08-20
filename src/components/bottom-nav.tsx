"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLanguage } from "@/lib/i18n";

const items = [
  ["⌂", "nav.home", "Home", "/"], ["⚔", "nav.matchup", "Matchup", "/matchup"], ["◉", "nav.team", "My Team", "/team"], ["⌕", "nav.players", "Players", "/players"], ["≡", "nav.league", "League", "/league"],
] as const;

export function BottomNav({ leagueId }: { leagueId?: string }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/players") return ["/waivers", "/packs", "/trades"].includes(pathname);
    if (href === "/league") return ["/draft", "/auction", "/developer"].includes(pathname);
    return false;
  };
  return (
    <nav className="bottom-nav" aria-label={t("nav.primary", "Primary navigation")}>
      <Link className="nav-brand" href="/" aria-label="My Fantasy XI home">
        <span>XI</span>
        <strong>MY FANTASY XI</strong>
      </Link>
      <div className="nav-items">
        {items.map(([icon, key, label, href]) => {
          const destination = leagueId && href !== "/" ? `${href}?league=${encodeURIComponent(leagueId)}` : href;
          const active = isActive(href);
          return (
            <Link className={active ? "active" : ""} key={label} aria-current={active ? "page" : undefined} href={destination}>
              <span aria-hidden="true">{icon}</span><b>{t(key, label)}</b>
            </Link>
          );
        })}
      </div>
      <p className="nav-footer">{t("nav.footer", "BUILD · MANAGE · COMPETE")}</p>
    </nav>
  );
}
