type NavIconName = "home" | "matchup" | "team" | "players" | "league";

export function NavIcon({ name }: { name: NavIconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "home") return <svg {...common}><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>;
  if (name === "matchup") return <svg {...common}><path d="m6 3 12 18"/><path d="m18 3-4.5 7"/><path d="M10.5 14 6 21"/><path d="M4 3h4"/><path d="M16 21h4"/></svg>;
  if (name === "team") return <svg {...common}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="m12 3 2 6"/><path d="m20.6 9-6 3"/><path d="m17.3 19-4.3-5"/><path d="m6.7 19 4.3-5"/><path d="m3.4 9 6 3"/></svg>;
  if (name === "players") return <svg {...common}><circle cx="10" cy="8" r="3"/><path d="M4 20v-2a6 6 0 0 1 12 0v2"/><path d="M17 4a3 3 0 0 1 0 6"/><path d="M18 14a5 5 0 0 1 2 4v2"/></svg>;
  return <svg {...common}><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><circle cx="7" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="7" cy="18" r="1" fill="currentColor" stroke="none"/></svg>;
}
