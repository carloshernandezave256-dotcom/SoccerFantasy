const FANTASY_WEEK_MS=7*24*60*60*1000;

export type KickoffFixture={kickoff:string};
export type CompetitionRoundFixture=KickoffFixture&{
  competition:string;
  officialRound:number;
};

export function fantasyWeekWindow(fixtures:KickoffFixture[]){
  const kickoffTimes=fixtures
    .map(fixture=>new Date(fixture.kickoff).getTime())
    .filter(Number.isFinite);
  if(!kickoffTimes.length)return null;
  const firstKickoff=new Date(Math.min(...kickoffTimes));
  let startsAt=Date.UTC(
    firstKickoff.getUTCFullYear(),
    firstKickoff.getUTCMonth(),
    firstKickoff.getUTCDate(),
  );
  // Weekend rounds can start Friday in another competition even when the
  // calendar competition opens Saturday or Sunday.
  const day=firstKickoff.getUTCDay();
  if(day===6)startsAt-=24*60*60*1000;
  if(day===0)startsAt-=2*24*60*60*1000;
  return {
    startsAt:new Date(startsAt).toISOString(),
    endsAt:new Date(startsAt+FANTASY_WEEK_MS-1).toISOString(),
  };
}

export function fixtureInsideFantasyWeek(fixture:KickoffFixture,window:{startsAt:string;endsAt:string}){
  const kickoff=new Date(fixture.kickoff).getTime();
  return Number.isFinite(kickoff)
    && kickoff>=new Date(window.startsAt).getTime()
    && kickoff<=new Date(window.endsAt).getTime();
}

export function fixturesForFantasyWeek<T extends CompetitionRoundFixture>(
  fixtures:T[],
  window:{startsAt:string;endsAt:string},
  preferredRounds:Readonly<Record<string,number>>={},
){
  const inside=fixtures.filter(fixture=>fixtureInsideFantasyWeek(fixture,window));
  const openingTime=new Date(window.startsAt).getTime();
  const weekend=new Date(openingTime).getUTCDay()===5;
  // Choose the round played during this weekend, not a larger upcoming
  // midweek round. Once selected, retain its eligible later fixtures too.
  const selectionFixtures=weekend
    ? inside.filter(fixture=>new Date(fixture.kickoff).getTime()<openingTime+4*24*60*60*1000)
    : inside;
  const roundCounts=new Map<string,Map<number,number>>();
  for(const fixture of selectionFixtures){
    const competitionCounts=roundCounts.get(fixture.competition)??new Map<number,number>();
    competitionCounts.set(
      fixture.officialRound,
      (competitionCounts.get(fixture.officialRound)??0)+1,
    );
    roundCounts.set(fixture.competition,competitionCounts);
  }

  const selectedRounds=new Map<string,number>();
  for(const[competition,counts]of roundCounts){
    const preferredRound=preferredRounds[competition];
    if(preferredRound!==undefined){
      selectedRounds.set(competition,preferredRound);
      continue;
    }
    const selected=[...counts.entries()].sort(
      ([roundA,countA],[roundB,countB])=>countB-countA||roundA-roundB,
    )[0];
    if(selected)selectedRounds.set(competition,selected[0]);
  }

  return inside.filter(
    fixture=>selectedRounds.get(fixture.competition)===fixture.officialRound,
  );
}
