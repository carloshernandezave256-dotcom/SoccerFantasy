export type PlayerFixture={
  fixture_id:number;
  gameweek:number;
  competition:string;
  kickoff:string;
  status:string;
  home_team:string;
  away_team:string;
  home_score?:number|null;
  away_score?:number|null;
};

const clubAliases:Record<string,string[]>={
  "psg":["paris saint germain"],
  "bayern munich":["bayern munchen","bayern münchen"],
  "inter milan":["inter"],
  "ac milan":["milan"],
  "athletic bilbao":["athletic club"],
  "real betis":["betis"],
};

export function teamKey(value:string){
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\b(fc|cf|ac)\b/g,"").replace(/[^a-z0-9]/g,"");
}

export function isPlayersClub(team:string,club:string){
  const teamName=teamKey(team),clubName=teamKey(club);
  return teamName===clubName||(clubAliases[club.toLowerCase()]??[]).some(alias=>teamName===teamKey(alias));
}

export function fixtureOpponent(fixture:PlayerFixture,club:string){
  return isPlayersClub(fixture.home_team,club)?fixture.away_team:fixture.home_team;
}

export function fixtureVenue(fixture:PlayerFixture,club:string){
  return isPlayersClub(fixture.home_team,club)?"Home":"Away";
}

export function fixtureForClub(fixtures:PlayerFixture[],club:string){
  return fixtures.find(fixture=>isPlayersClub(fixture.home_team,club)||isPlayersClub(fixture.away_team,club))??null;
}
