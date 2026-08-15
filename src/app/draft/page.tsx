import { Suspense } from "react";
import { ActiveDraftRoom } from "@/components/active-draft-room";
export default async function DraftPage({ searchParams }: { searchParams: Promise<{ league?: string }> }) { const { league } = await searchParams; return <Suspense fallback={<main className="app-shell">Loading draft…</main>}><ActiveDraftRoom requestedLeagueId={league}/></Suspense>; }
