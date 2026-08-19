import type { PlayerMatchStats } from "./scoring";

export type SimulatedPlayer = {
  id: number;
  name: string;
  club: string;
  stats: PlayerMatchStats;
};

export type SimulatedTeam = {
  name: string;
  players: SimulatedPlayer[];
};

export const simulatedTeams: [SimulatedTeam, SimulatedTeam] = [
  {
    name: "Your XI",
    players: [
      { id: 1, name: "Gianluigi Donnarumma", club: "PSG", stats: { position: "GK", minutes: 90, saves: 4, goalsConceded: 0 } },
      { id: 2, name: "Achraf Hakimi", club: "PSG", stats: { position: "DEF", minutes: 90, assists: 1, tacklesWon: 4, completedPasses: 61, goalsConceded: 0 } },
      { id: 3, name: "Alessandro Bastoni", club: "Inter", stats: { position: "DEF", minutes: 90, completedPasses: 72, tacklesWon: 3, goalsConceded: 1 } },
      { id: 4, name: "William Saliba", club: "Arsenal", stats: { position: "DEF", minutes: 90, completedPasses: 55, tacklesWon: 2, goalsConceded: 2 } },
      { id: 5, name: "Jude Bellingham", club: "Real Madrid", stats: { position: "MID", minutes: 90, goals: 1, shotsOnTarget: 2, completedPasses: 47, tacklesWon: 3 } },
      { id: 6, name: "Bukayo Saka", club: "Arsenal", stats: { position: "MID", minutes: 84, assists: 1, shotsOnTarget: 3, completedPasses: 31 } },
      { id: 7, name: "Lamine Yamal", club: "Barcelona", stats: { position: "MID", minutes: 90, goals: 1, assists: 1, shotsOnTarget: 3, completedPasses: 42, starPickWinner: true } },
      { id: 8, name: "Florian Wirtz", club: "Bayer Leverkusen", stats: { position: "MID", minutes: 71, shotsOnTarget: 1, completedPasses: 39 } },
      { id: 9, name: "Erling Haaland", club: "Manchester City", stats: { position: "FWD", minutes: 90, goals: 2, shotsOnTarget: 4, completedPasses: 18 } },
      { id: 10, name: "Kylian Mbappé", club: "Real Madrid", stats: { position: "FWD", minutes: 90, goals: 1, shotsOnTarget: 3, completedPasses: 21 } },
      { id: 11, name: "Harry Kane", club: "Bayern Munich", stats: { position: "FWD", minutes: 90, assists: 1, shotsOnTarget: 2, completedPasses: 24, yellowCards: 1 } },
    ],
  },
  {
    name: "Barrio XI",
    players: [
      { id: 101, name: "David Raya", club: "Arsenal", stats: { position: "GK", minutes: 90, saves: 2, goalsConceded: 2 } },
      { id: 102, name: "Virgil van Dijk", club: "Liverpool", stats: { position: "DEF", minutes: 90, goals: 1, completedPasses: 68, tacklesWon: 3, goalsConceded: 1 } },
      { id: 103, name: "Theo Hernández", club: "Milan", stats: { position: "DEF", minutes: 90, assists: 1, completedPasses: 41, goalsConceded: 2 } },
      { id: 104, name: "Antonio Rüdiger", club: "Real Madrid", stats: { position: "DEF", minutes: 90, completedPasses: 52, tacklesWon: 4, goalsConceded: 0, yellowCards: 1 } },
      { id: 105, name: "Rodri", club: "Manchester City", stats: { position: "MID", minutes: 90, completedPasses: 93, tacklesWon: 6 } },
      { id: 106, name: "Jamal Musiala", club: "Bayern Munich", stats: { position: "MID", minutes: 77, goals: 1, shotsOnTarget: 2, completedPasses: 38 } },
      { id: 107, name: "Cole Palmer", club: "Chelsea", stats: { position: "MID", minutes: 90, assists: 2, shotsOnTarget: 2, completedPasses: 44 } },
      { id: 108, name: "Rafael Leão", club: "Milan", stats: { position: "MID", minutes: 65, shotsOnTarget: 2, completedPasses: 22 } },
      { id: 109, name: "Mohamed Salah", club: "Liverpool", stats: { position: "FWD", minutes: 90, goals: 1, assists: 1, shotsOnTarget: 3, completedPasses: 29, starPickWinner: true } },
      { id: 110, name: "Lautaro Martínez", club: "Inter", stats: { position: "FWD", minutes: 90, goals: 1, shotsOnTarget: 2, completedPasses: 17 } },
      { id: 111, name: "Ousmane Dembélé", club: "PSG", stats: { position: "FWD", minutes: 58, assists: 1, shotsOnTarget: 2, completedPasses: 26 } },
    ],
  },
];
