const FANTASY_WEEK_MS=7*24*60*60*1000;

export type KickoffFixture={kickoff:string};

export function fantasyWeekWindow(fixtures:KickoffFixture[]){
  const kickoffTimes=fixtures
    .map(fixture=>new Date(fixture.kickoff).getTime())
    .filter(Number.isFinite);
  if(!kickoffTimes.length)return null;
  const firstKickoff=new Date(Math.min(...kickoffTimes));
  const startsAt=Date.UTC(
    firstKickoff.getUTCFullYear(),
    firstKickoff.getUTCMonth(),
    firstKickoff.getUTCDate(),
  );
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
