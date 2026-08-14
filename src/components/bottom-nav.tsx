import Link from "next/link";

const items = [
  ["⌂", "Home", "/"], ["⚔", "Matchup", "/matchup"], ["◉", "My Team", "/team"], ["⌕", "Players", "/players"], ["≡", "League", "/league"],
] as const;

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map(([icon, label, href], index) => (
        <Link className={index === 0 ? "active" : ""} key={label} aria-current={index === 0 ? "page" : undefined} href={href}>
          <span>{icon}</span>{label}
        </Link>
      ))}
    </nav>
  );
}
