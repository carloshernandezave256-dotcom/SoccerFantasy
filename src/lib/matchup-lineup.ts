export type MatchupLineupStatus = "scheduled" | "live" | "final";

export function selectMatchupLineup<T>(
  status: MatchupLineupStatus,
  current: T[],
  snapshot: T[],
) {
  if (status === "scheduled") return current.length ? current : snapshot;
  return snapshot.length ? snapshot : current;
}

export function partitionMatchupLineup<T extends { is_starter: boolean }>(rows: T[]) {
  return {
    starters: rows.filter((row) => row.is_starter),
    bench: rows.filter((row) => !row.is_starter),
  };
}
