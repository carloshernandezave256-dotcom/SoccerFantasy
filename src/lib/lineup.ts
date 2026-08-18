export type LineupPlayer = {
  id: number;
  position: string;
};

export type LeagueFormat = "draft" | "auction" | "pack";

export function formationIsValid(roster: LineupPlayer[], ids: Set<number>) {
  const counts = roster
    .filter((player) => ids.has(player.id))
    .reduce(
      (all, player) => ({ ...all, [player.position]: (all[player.position] ?? 0) + 1 }),
      {} as Record<string, number>,
    );

  return (
    ids.size === 11 &&
    counts.GK === 1 &&
    (counts.DEF ?? 0) >= 3 &&
    (counts.MID ?? 0) >= 1 &&
    (counts.FWD ?? 0) >= 1 &&
    (counts.FWD ?? 0) <= 4
  );
}

export function lineupIsReady(roster: LineupPlayer[], ids: Set<number>, captain: number | null) {
  return formationIsValid(roster, ids) && captain !== null && ids.has(captain);
}

export function reorderWithinPosition(roster: LineupPlayer[], order: number[], id: number, targetId: number) {
  const position = roster.find((player) => player.id === id)?.position;
  if (!position || roster.find((player) => player.id === targetId)?.position !== position) return null;

  const from = order.indexOf(id);
  const target = order.indexOf(targetId);
  if (from < 0 || target < 0 || from === target) return null;

  const next = [...order];
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}
