import { Suspense } from "react";
import { DraftRoom } from "@/components/draft-room";
export default async function DraftPage({ searchParams }: { searchParams: Promise<{ league?: string }> }) { const { league } = await searchParams; return <Suspense fallback={<main className="app-shell">Loading draft…</main>}><DraftRoom leagueId={league ?? ""} /></Suspense>; }
