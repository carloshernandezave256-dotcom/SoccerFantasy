const items = [
  ["⌂", "Home"], ["⚔", "Matchup"], ["◉", "My Team"], ["⌕", "Players"], ["≡", "League"],
] as const;

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      {items.map(([icon, label], index) => (
        <button className={index === 0 ? "active" : ""} key={label} aria-current={index === 0 ? "page" : undefined}>
          <span>{icon}</span>{label}
        </button>
      ))}
    </nav>
  );
}
