import { Suspense } from "react";
import { ActiveAuctionRoom } from "@/components/active-auction-room";

export default async function AuctionPage({
  searchParams,
}: {
  searchParams: Promise<{ league?: string }>;
}) {
  const { league } = await searchParams;
  return (
    <Suspense fallback={<main className="app-shell">Loading auction…</main>}>
      <ActiveAuctionRoom requestedLeagueId={league} />
    </Suspense>
  );
}
