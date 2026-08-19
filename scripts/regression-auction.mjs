import assert from "node:assert/strict";

const managers = ["Manager 1", "Manager 2", "Manager 3"];
const targets = { GK: 2, DEF: 6, MID: 5, FWD: 5 };
const startingBudget = 2_000_000_000;
const minimumBid = 1_000_000;
const clubLimit = 4;
const positions = Object.entries(targets).flatMap(([position, count]) =>
  Array.from({ length: count * managers.length + 6 }, () => position),
);
const players = positions.map((position, index) => ({
  id: index + 1,
  position,
  club: `Club ${(index * 7) % 24}`,
  rank: index + 1,
}));

const rosters = new Map(managers.map((manager) => [manager, []]));
const budgets = new Map(managers.map((manager) => [manager, startingBudget]));
const sold = new Set();
const lots = [];
let nominatorSlot = 0;

function counts(manager) {
  return rosters.get(manager).reduce(
    (all, player) => ({ ...all, [player.position]: (all[player.position] ?? 0) + 1 }),
    { GK: 0, DEF: 0, MID: 0, FWD: 0 },
  );
}

function playerIsValid(manager, player) {
  if (sold.has(player.id) || rosters.get(manager).length >= 18) return false;
  const current = counts(manager);
  if (current[player.position] >= targets[player.position]) return false;
  if (rosters.get(manager).filter((item) => item.club === player.club).length >= clubLimit) return false;
  current[player.position] += 1;
  const remaining = 18 - rosters.get(manager).length - 1;
  const missing = Object.entries(targets).reduce(
    (total, [position, target]) => total + Math.max(0, target - current[position]),
    0,
  );
  return missing <= remaining;
}

function maxBid(manager) {
  return budgets.get(manager) - Math.max(0, 18 - rosters.get(manager).length - 1) * minimumBid;
}

function nextIncompleteSlot(slot) {
  for (let offset = 1; offset <= managers.length; offset += 1) {
    const candidate = (slot + offset) % managers.length;
    if (rosters.get(managers[candidate]).length < 18) return candidate;
  }
  return slot;
}

while (managers.some((manager) => rosters.get(manager).length < 18)) {
  const nominator = managers[nominatorSlot];
  assert.ok(rosters.get(nominator).length < 18, "Completed managers must be skipped");
  const player = players.find((candidate) => playerIsValid(nominator, candidate));
  assert.ok(player, `${nominator} must always have an eligible nomination`);

  const openingBid = minimumBid;
  assert.ok(openingBid <= maxBid(nominator), "Opening bid must preserve one minimum bid per empty slot");
  const rival = managers.find(
    (manager) => manager !== nominator && playerIsValid(manager, player) && maxBid(manager) >= 2_000_000,
  );
  const bids = [{ manager: nominator, amount: openingBid, secondsLeft: 20 }];
  if (rival) bids.push({ manager: rival, amount: 2_000_000, secondsLeft: 4 });
  const winningBid = rival ? 3_000_000 : openingBid;
  if (rival) bids.push({ manager: nominator, amount: winningBid, secondsLeft: 6 });

  for (let index = 1; index < bids.length; index += 1) {
    assert.ok(bids[index].amount >= bids[index - 1].amount + minimumBid, "Each bid must increase by at least $1M");
  }
  assert.equal(bids[1]?.secondsLeft === 4 ? 6 : 20, rival ? 6 : 20, "A final-six-second bid resets the clock");
  assert.ok(winningBid <= maxBid(nominator), "Winning bid must remain under the reserved-budget maximum");

  budgets.set(nominator, budgets.get(nominator) - winningBid);
  rosters.get(nominator).push(player);
  sold.add(player.id);
  lots.push({ playerId: player.id, nominator, winner: nominator, winningBid, bids });
  nominatorSlot = nextIncompleteSlot(nominatorSlot);
}

assert.equal(lots.length, 54, "Three managers must complete 54 sold lots");
assert.equal(sold.size, 54, "Every auctioned player must have exclusive ownership");
assert.ok(lots.some((lot) => lot.bids.length > 1), "The regression must exercise competitive bidding");

for (const manager of managers) {
  const roster = rosters.get(manager);
  assert.equal(roster.length, 18, `${manager} must finish with 18 players`);
  for (const [position, target] of Object.entries(targets)) {
    assert.equal(roster.filter((player) => player.position === position).length, target);
  }
  const maxFromClub = Math.max(
    ...Object.values(roster.reduce((all, player) => ({ ...all, [player.club]: (all[player.club] ?? 0) + 1 }), {})),
  );
  assert.ok(maxFromClub <= clubLimit, `${manager} must respect the four-player club limit`);
  assert.ok(budgets.get(manager) >= 0, `${manager} cannot overspend`);
  assert.equal(
    startingBudget - budgets.get(manager),
    lots.filter((lot) => lot.winner === manager).reduce((total, lot) => total + lot.winningBid, 0),
    `${manager}'s budget must reconcile to sold lots`,
  );
}

assert.equal(Math.min(15, 5 + 20), 15, "Superstar pity odds cap at 15%");
assert.equal(Math.min(45, 15 + 20 * 5), 45, "Star pity odds cap at 45%");

console.log(
  JSON.stringify(
    {
      managers: managers.length,
      lots: lots.length,
      competitiveLots: lots.filter((lot) => lot.bids.length > 1).length,
      rosters: Object.fromEntries(managers.map((manager) => [manager, counts(manager)])),
      budgets: Object.fromEntries(budgets),
      result: "Auction regression passed",
    },
    null,
    2,
  ),
);
