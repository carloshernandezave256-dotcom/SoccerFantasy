"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["⌂", "Home", "/"], ["⚔", "Matchup", "/matchup"], ["◉", "My Team", "/team"], ["⌕", "Players", "/players"], ["≡", "League", "/league"],
] as const;

export function BottomNav({ leagueId }: { leagueId?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => {
    if (pathname === href) return true;
    if (href === "/players") return ["/waivers", "/packs", "/trades"].includes(pathname);
    if (href === "/league") return ["/draft", "/auction", "/developer"].includes(pathname);
    return false;
  };
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <Link className="nav-brand" href="/" aria-label="My Fantasy XI home">
        <span>XI</span>
        <strong>MY FANTASY XI</strong>
      </Link>
      <div className="nav-items">
        {items.map(([icon, label, href]) => {
          const destination = leagueId && href !== "/" ? `${href}?league=${encodeURIComponent(leagueId)}` : href;
          const active = isActive(href);
          return (
            <Link className={active ? "active" : ""} key={label} aria-current={active ? "page" : undefined} href={destination}>
              <span aria-hidden="true">{icon}</span><b>{label}</b>
            </Link>
          );
        })}
      </div>
      <p className="nav-footer">BUILD · MANAGE · COMPETE</p>
    </nav>
  );
}
