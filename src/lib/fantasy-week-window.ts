const FANTASY_WEEK_PADDING_MS=48*60*60*1000;

export type KickoffFixture={kickoff:string};

export function fantasyWeekWindow(fixtures:KickoffFixture[]){
  const kickoffTimes=fixtures
    .map(fixture=>new Date(fixture.kickoff).getTime())
    .filter(Number.isFinite);
  if(!kickoffTimes.length)return null;
  return {
    startsAt:new Date(Math.min(...kickoffTimes)-FANTASY_WEEK_PADDING_MS).toISOString(),
    endsAt:new Date(Math.max(...kickoffTimes)+FANTASY_WEEK_PADDING_MS).toISOString(),
  };
}

export function fixtureInsideFantasyWeek(fixture:KickoffFixture,window:{startsAt:string;endsAt:string}){
  const kickoff=new Date(fixture.kickoff).getTime();
  return Number.isFinite(kickoff)
    && kickoff>=new Date(window.startsAt).getTime()
    && kickoff<=new Date(window.endsAt).getTime();
}
