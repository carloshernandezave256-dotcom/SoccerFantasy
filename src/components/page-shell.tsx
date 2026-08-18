import Link from "next/link";
import { BottomNav } from "./bottom-nav";
import { AccountMenu } from "./account-menu";

export function PageShell({ eyebrow, title, children, leagueId }: { eyebrow: string; title: string; children: React.ReactNode; leagueId?: string }) {
  return <main className="app-shell"><header className="sub-header"><Link href="/">←</Link><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div><AccountMenu compact/></header>{children}<BottomNav leagueId={leagueId}/></main>;
}
