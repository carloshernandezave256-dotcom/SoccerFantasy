"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  ["⌂", "Home", "/"], ["⚔", "Matchup", "/matchup"], ["◉", "My Team", "/team"], ["⌕", "Players", "/players"], ["≡", "League", "/league"],
] as const;

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map(([icon, label, href]) => (
        <Link className={pathname === href ? "active" : ""} key={label} aria-current={pathname === href ? "page" : undefined} href={href}>
          <span>{icon}</span>{label}
        </Link>
      ))}
    </nav>
  );
}
