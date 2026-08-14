export type CatalogPlayer = {
  id: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  club: string;
  league: string;
};

export const playerCatalog: CatalogPlayer[] = [
  { id: 1, name: "Erling Haaland", position: "FWD", club: "Manchester City", league: "Premier League" },
  { id: 2, name: "Bukayo Saka", position: "MID", club: "Arsenal", league: "Premier League" },
  { id: 3, name: "Mohamed Salah", position: "FWD", club: "Liverpool", league: "Premier League" },
  { id: 4, name: "Jude Bellingham", position: "MID", club: "Real Madrid", league: "La Liga" },
  { id: 5, name: "Lamine Yamal", position: "MID", club: "Barcelona", league: "La Liga" },
  { id: 6, name: "Kylian Mbappé", position: "FWD", club: "Real Madrid", league: "La Liga" },
  { id: 7, name: "Harry Kane", position: "FWD", club: "Bayern Munich", league: "Bundesliga" },
  { id: 8, name: "Florian Wirtz", position: "MID", club: "Bayer Leverkusen", league: "Bundesliga" },
  { id: 9, name: "Jamal Musiala", position: "MID", club: "Bayern Munich", league: "Bundesliga" },
  { id: 10, name: "Lautaro Martínez", position: "FWD", club: "Inter", league: "Serie A" },
  { id: 11, name: "Rafael Leão", position: "MID", club: "Milan", league: "Serie A" },
  { id: 12, name: "Alessandro Bastoni", position: "DEF", club: "Inter", league: "Serie A" },
  { id: 13, name: "Ousmane Dembélé", position: "FWD", club: "PSG", league: "Ligue 1" },
  { id: 14, name: "Achraf Hakimi", position: "DEF", club: "PSG", league: "Ligue 1" },
  { id: 15, name: "Gianluigi Donnarumma", position: "GK", club: "PSG", league: "Ligue 1" },
];
