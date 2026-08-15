import fs from "node:fs/promises";

const leagues = [
  ["eng.1", "Premier League"],
  ["esp.1", "La Liga"],
  ["ita.1", "Serie A"],
  ["ger.1", "Bundesliga"],
  ["fra.1", "Ligue 1"],
];

const seedNames = new Set([
  "Erling Haaland", "Bukayo Saka", "Mohamed Salah", "Jude Bellingham", "Lamine Yamal",
  "Kylian Mbappé", "Harry Kane", "Florian Wirtz", "Jamal Musiala", "Lautaro Martínez",
  "Rafael Leão", "Alessandro Bastoni", "Ousmane Dembélé", "Achraf Hakimi", "Gianluigi Donnarumma",
]);

const starOrder = [
  "Vinícius Júnior", "Cole Palmer", "Rodri", "Pedri", "Raphinha", "Federico Valverde",
  "Alexander Isak", "Declan Rice", "Bruno Fernandes", "Phil Foden", "Khvicha Kvaratskhelia",
  "Nico Williams", "Dani Olmo", "Martin Ødegaard", "Viktor Gyökeres", "João Neves",
  "Michael Olise", "Serhou Guirassy", "Nicolò Barella", "Marcus Thuram", "Kenan Yıldız",
  "Desire Doué", "Vitinha", "Bradley Barcola", "William Saliba", "Gabriel Magalhães",
  "Virgil van Dijk", "Trent Alexander-Arnold", "Alphonso Davies", "Theo Hernández",
  "Nuno Mendes", "Marquinhos", "Antonio Rüdiger", "Pau Cubarsí", "Joško Gvardiol",
];

const clubOrder = [
  "Real Madrid", "Barcelona", "Manchester City", "Liverpool", "Arsenal", "Bayern Munich",
  "Paris Saint-Germain", "Inter Milan", "Chelsea", "Manchester United", "Atlético Madrid",
  "Borussia Dortmund", "Juventus", "AC Milan", "Napoli", "Bayer Leverkusen", "Tottenham Hotspur",
  "Newcastle United", "Aston Villa", "RB Leipzig", "Marseille", "Monaco", "Roma", "Atalanta",
];

const positionMap = { G: "GK", D: "DEF", M: "MID", F: "FWD", A: "FWD" };
const limits = { GK: 40, DEF: 120, MID: 110, FWD: 110 };

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

const teamRows = [];
for (const [slug, competition] of leagues) {
  const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams?limit=100`);
  const teams = data?.sports?.[0]?.leagues?.[0]?.teams ?? [];
  for (const entry of teams) teamRows.push({ slug, competition, team: entry.team });
}

const rosterResults = [];
for (let index = 0; index < teamRows.length; index += 10) {
  const batch = teamRows.slice(index, index + 10);
  rosterResults.push(...await Promise.all(batch.map(async ({ slug, competition, team }) => {
    const data = await getJson(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/teams/${team.id}?enable=roster`);
    return { competition, club: data.team?.displayName ?? team.displayName, athletes: data.team?.athletes ?? [] };
  })));
}

const byId = new Map();
for (const roster of rosterResults) {
  for (const athlete of roster.athletes) {
    const position = positionMap[athlete.position?.abbreviation];
    if (!athlete.id || !athlete.displayName || !position || seedNames.has(athlete.displayName)) continue;
    if (!byId.has(athlete.id)) {
      byId.set(athlete.id, {
        providerId: `espn:${athlete.id}`,
        fullName: athlete.displayName,
        position,
        club: roster.club,
        competition: roster.competition,
      });
    }
  }
}

const starRank = new Map(starOrder.map((name, index) => [name, index]));
const clubRank = new Map(clubOrder.map((name, index) => [name, index]));
const candidates = [...byId.values()].sort((a, b) => {
  const aStar = starRank.has(a.fullName) ? starRank.get(a.fullName) : 999;
  const bStar = starRank.has(b.fullName) ? starRank.get(b.fullName) : 999;
  if (aStar !== bStar) return aStar - bStar;
  const aClub = clubRank.has(a.club) ? clubRank.get(a.club) : 999;
  const bClub = clubRank.has(b.club) ? clubRank.get(b.club) : 999;
  if (aClub !== bClub) return aClub - bClub;
  return a.fullName.localeCompare(b.fullName);
});

const counts = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
const selected = candidates.filter((player) => {
  if (counts[player.position] >= limits[player.position]) return false;
  counts[player.position] += 1;
  return true;
});

const sqlValue = (value) => `'${String(value).replaceAll("'", "''")}'`;
const rows = selected.map((player, index) =>
  `(${sqlValue(player.providerId)},${sqlValue(player.fullName)},${sqlValue(player.position)}::public.player_position,${sqlValue(player.club)},${sqlValue(player.competition)},true,${index + 16})`,
);

const sql = `-- Generated from ESPN's 2026 top-five-league roster feed by scripts/import-espn-player-pool.mjs.
-- draft_rank is a provisional board: established seed stars first, then curated stars and club/name order.

update public.players
set active = false, draft_rank = null
where provider_id like 'espn:%';

insert into public.players(provider_id,full_name,position,club,competition,active,draft_rank)
values
${rows.join(",\n")}
on conflict(provider_id) do update
set full_name = excluded.full_name,
    position = excluded.position,
    club = excluded.club,
    competition = excluded.competition,
    active = true,
    draft_rank = excluded.draft_rank;
`;

await fs.writeFile(new URL("../supabase/migrations/0011_import_2026_player_pool.sql", import.meta.url), sql);
console.log(JSON.stringify({ teams: teamRows.length, candidates: candidates.length, selected: selected.length, counts }, null, 2));
