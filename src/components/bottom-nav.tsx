"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["⌂", "Home", "/"], ["⚔", "Matchup", "/matchup"], ["◉", "My Team", "/team"], ["⌕", "Players", "/players"], ["≡", "League", "/league"],
] as const;

export function BottomNav({ leagueId }: { leagueId?: string }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href || (href === "/players" && (pathname === "/waivers" || pathname === "/packs"));
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map(([icon, label, href]) => {\n        const destination = leagueId && href !== "/" ? `${href}?league=${encodeURIComponent(leagueId)}` : href;\n        return (
        <Link className={isActive(href) ? "active" : ""} key={label} aria-current={isActive(href) ? "page" : undefined} href={destination}>
          <span>{icon}</span>{label}
        </Link>
      ))}
    </nav>
  );
}
