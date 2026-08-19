export type RatedMatchPlayer = {
  playerId: number;
  rating: number;
  minutes: number;
  goals: number;
  assists: number;
  shotsOnTarget: number;
};

/** Select exactly one API-rated player for a fixture, with stable tie-breakers. */
export function selectManOfTheMatchId(players: RatedMatchPlayer[]): number | null {
  const eligible = players.filter((player) => Number.isFinite(player.rating) && player.rating > 0);
  if (!eligible.length) return null;

  return [...eligible].sort((left, right) =>
    right.rating - left.rating ||
    right.minutes - left.minutes ||
    right.goals - left.goals ||
    right.assists - left.assists ||
    right.shotsOnTarget - left.shotsOnTarget ||
    left.playerId - right.playerId
  )[0].playerId;
}
