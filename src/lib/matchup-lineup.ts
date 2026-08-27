export type MatchupLineupStatus = "scheduled" | "live" | "final";

export function selectMatchupLineup<T>(
  status: MatchupLineupStatus,
  current: T[],
  snapshot: T[],
) {
  if (status === "scheduled") return current.length ? current : snapshot;
  return snapshot.length ? snapshot : current;
}

export function partitionMatchupLineup<T extends { is_starter: boolean; pitch_order?: number | null; bench_order?: number | null }>(rows: T[]) {
  return {
    starters: rows.filter((row) => row.is_starter).sort((a,b)=>(a.pitch_order??Number.MAX_SAFE_INTEGER)-(b.pitch_order??Number.MAX_SAFE_INTEGER)),
    bench: rows.filter((row) => !row.is_starter).sort((a,b)=>(a.bench_order??Number.MAX_SAFE_INTEGER)-(b.bench_order??Number.MAX_SAFE_INTEGER)),
  };
}
