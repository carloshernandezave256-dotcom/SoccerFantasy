import Link from "next/link";
import { BottomNav } from "./bottom-nav";

export function PageShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return <main className="app-shell"><header className="sub-header"><Link href="/">←</Link><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1></div></header>{children}<BottomNav /></main>;
}
