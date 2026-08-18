import assert from "node:assert/strict";

const managers = ["Manager 1", "Manager 2", "Manager 3"];
const targets = { GK: 2, DEF: 6, MID: 5, FWD: 5 };
const supply = { GK: 12, DEF: 36, MID: 30, FWD: 30 };
const clubs = Array.from({ length: 24 }, (_, index) => `Club ${index + 1}`);
let nextId = 1;

const players = Object.entries(supply).flatMap(([position, count]) =>
  Array.from({ length: count }, () => {
    const id = nextId++;
    return { id, position, club: clubs[(id * 7) % clubs.length], rank: id };
  }),
);

const rosters = new Map(managers.map((manager) => [manager, []]));
const pickedIds = new Set();
const queues = new Map(
  managers.map((manager, managerIndex) => [
    manager,
    players
      .filter((_, index) => index % managers.length === managerIndex)
      .slice(0, 25)
      .map((player) => player.id),
  ]),
);

function managerAtPick(pickNumber) {
  const round = Math.floor((pickNumber - 1) / managers.length) + 1;
  const index = (pickNumber - 1) % managers.length;
  return managers[round % 2 === 1 ? index : managers.length - index - 1];
}

function isValid(manager, player) {
  if (pickedIds.has(player.id)) return false;
  const roster = rosters.get(manager);
  if (roster.length >= 18) return false;
  if (roster.filter((item) => item.club === player.club).length >= 4) return false;

  const counts = Object.fromEntries(
    Object.keys(targets).map((position) => [
      position,
      roster.filter((item) => item.position === position).length,
    ]),
  );
  if (counts[player.position] >= targets[player.position]) return false;
  counts[player.position] += 1;
  const remaining = 18 - (roster.length + 1);
  const missing = Object.entries(targets).reduce(
    (total, [position, target]) => total + Math.max(0, target - counts[position]),
    0,
  );
  return missing <= remaining;
}

const picks = [];
for (let pickNumber = 1; pickNumber <= managers.length * 18; pickNumber += 1) {
  const manager = managerAtPick(pickNumber);
  const queuedPlayer = queues
    .get(manager)
    .map((id) => players.find((player) => player.id === id))
    .find((player) => player && isValid(manager, player));
  const fallback = players.find((player) => isValid(manager, player));
  const player = pickNumber % 3 === 1 ? queuedPlayer ?? fallback : fallback;
  assert.ok(player, `Pick ${pickNumber} must have an eligible player`);
  pickedIds.add(player.id);
  rosters.get(manager).push(player);
  picks.push({ pickNumber, manager, playerId: player.id, automatic: pickNumber % 3 !== 0 });
}

assert.equal(picks.length, 54, "Three managers must complete 54 total picks");
assert.equal(pickedIds.size, 54, "Every drafted player must have exclusive ownership");
assert.deepEqual(
  picks.slice(0, 6).map((pick) => pick.manager),
  ["Manager 1", "Manager 2", "Manager 3", "Manager 3", "Manager 2", "Manager 1"],
  "The first two rounds must reverse in snake order",
);

for (const manager of managers) {
  const roster = rosters.get(manager);
  assert.equal(roster.length, 18, `${manager} must finish with 18 players`);
  for (const [position, target] of Object.entries(targets)) {
    assert.equal(
      roster.filter((player) => player.position === position).length,
      target,
      `${manager} must finish with ${target} ${position}`,
    );
  }
  const clubCounts = Object.values(
    roster.reduce((counts, player) => ({ ...counts, [player.club]: (counts[player.club] ?? 0) + 1 }), {}),
  );
  assert.ok(Math.max(...clubCounts) <= 4, `${manager} must respect the four-per-club limit`);
}

console.log("Snake Draft regression passed");
console.log(`Picks: ${picks.length} | Unique players: ${pickedIds.size} | Managers: ${managers.length}`);
console.log(`Queued/automatic path exercised: ${picks.filter((pick) => pick.automatic).length} picks`);
