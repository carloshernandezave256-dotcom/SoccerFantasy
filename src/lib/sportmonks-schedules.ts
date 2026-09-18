import {adminDb,checked,currentSeasons,fixtureSides,fixtureStatus,kickoff,type SMFixture,type SMTeam} from './sportmonks-data';
import {sportmonks} from './sportmonks-server';
type Canonical={fixture_id:number;sportmonks_id:number|null;competition:string;season:number;home_team:string;away_team:string};
export async function syncSportMonksSchedules(){
 const db=adminDb();const {seasons,requestsUsed:initial}=await currentSeasons();let requestsUsed=initial;
 const teams=await checked(db.from('sportmonks_teams').select('*')) as SMTeam[];
 const canonical:Canonical[]=[];
 for(let from=0;;from+=1000){const rows=await checked(db.from('football_fixture_cache').select('fixture_id,sportmonks_id,competition,season,home_team,away_team').order('fixture_id').range(from,from+999));canonical.push(...rows);if(rows.length<1000)break;}
 const updates=[];
 for(const c of seasons){
  const result=await sportmonks(`schedules/seasons/${c.season.id}`,{});requestsUsed++;
  const stages=result.data as Array<{rounds?:Array<{name:string;fixtures?:SMFixture[]}>}>;
  if(!Array.isArray(stages))throw new Error(`Invalid schedule for ${c.name}`);
  const season=Number(c.season.name.slice(0,4));
  if(!Number.isSafeInteger(season)||season<2020)throw new Error('Invalid season year');
  const fixtures=stages.flatMap(s=>(s.rounds??[]).flatMap(r=>(r.fixtures??[]).map(f=>({f,round:r.name}))));
  if(fixtures.length<100)throw new Error(`Incomplete SportMonks schedule for ${c.name}`);
  for(const {f,round} of fixtures){
   if(f.league_id!==c.id)throw new Error('Schedule league mismatch');
   const sides=fixtureSides(f);
   const home=teams.find(t=>t.sportmonks_id===sides.home.id&&t.competition===c.name),away=teams.find(t=>t.sportmonks_id===sides.away.id&&t.competition===c.name);
   if(!home||!away)throw new Error(`Unmapped SportMonks club: ${sides.home.name} / ${sides.away.name}`);
   const matches=canonical.filter(x=>x.sportmonks_id===f.id||(x.competition===c.name&&x.season===season&&x.home_team===home.club&&x.away_team===away.club));
   if(matches.length>1)throw new Error(`Ambiguous fixture mapping ${f.id}`);
   const match=matches[0];
   if(match?.sportmonks_id&&match.sportmonks_id!==f.id)throw new Error('Conflicting fixture mapping');
   const fixtureId=match?.fixture_id??(1_000_000_000+f.id);
   if(canonical.some(x=>x.fixture_id===fixtureId&&x!==match))throw new Error('Canonical fixture ID collision');
   updates.push({fixture_id:fixtureId,sportmonks_id:f.id,competition:c.name,competition_id:c.legacyId,season,gameweek:Number(round),round_name:`Regular Season - ${round}`,kickoff:kickoff(f.starting_at),status:fixtureStatus(f),home_team:home.club,away_team:away.club,home_score:sides.homeScore,away_score:sides.awayScore,updated_at:new Date().toISOString()});
  }
 }
 if(new Set(updates.map(f=>f.fixture_id)).size!==updates.length)throw new Error('Duplicate season fixtures');
 for(let i=0;i<updates.length;i+=250)await checked(db.from('football_fixture_cache').upsert(updates.slice(i,i+250),{onConflict:'fixture_id'}));
 const leagues=await checked(db.from('leagues').select('id,calendar_competition,player_pool').in('game_format',['draft','auction','pack']).not('calendar_competition','is',null));
 let copied=0;
 for(const league of leagues){
  const rows=updates.filter(f=>league.player_pool==='All Top Five'||f.competition===league.calendar_competition).map(({sportmonks_id,competition_id,season,...f})=>{void sportmonks_id;void competition_id;void season;return {...f,league_id:league.id};});
  for(let i=0;i<rows.length;i+=250)await checked(db.from('league_headline_fixtures').upsert(rows.slice(i,i+250),{onConflict:'league_id,fixture_id'}));
  await checked(db.rpc('refresh_league_calendar',{p_league_id:league.id}));copied+=rows.length;
 }
 return {ok:true,provider:'sportmonks',requestsUsed,fixturesCached:updates.length,leagueFixtureRowsCopied:copied,leaguesUpdated:leagues.length};
}
