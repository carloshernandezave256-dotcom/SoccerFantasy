import {expect,it} from 'vitest';
import {fixtureCompleteness,type ProviderLineup} from './fixture-completeness';
import {buildLeaguePlayerScoreRows,type ProviderPlayerPage,type WeekFixture} from './live-score-domain';
function sample(){
 const lineups:ProviderLineup[]=[1,2].map(team=>({team:{id:team},startXI:Array.from({length:11},(_,i)=>({player:{id:team*100+i}})),substitutes:[{player:{id:team*100+20}}]}));
 const page={fixture:{fixture:{id:1,status:{short:'FT'}},teams:{home:{id:1},away:{id:2}}},teams:lineups.map(l=>({team:l.team,players:[...l.startXI,...l.substitutes].map(p=>({player:p.player,statistics:[{games:{minutes:p.player.id%100===20?0:90}}]}))}))} as ProviderPlayerPage;
 const mapping=new Map(page.teams.flatMap(t=>t.players.map(p=>[p.player.id,p.player.id] as const)));
 return {page,lineups,mapping};
}
it('accepts explicit unused substitute minutes after both squads reconcile',()=>{
 const {page,lineups,mapping}=sample();expect(fixtureCompleteness(page,lineups,mapping).complete).toBe(true);
});
it('missing appeared-player statistics cannot certify DNP',()=>{
 const {page,lineups,mapping}=sample();page.teams[0].players.shift();
 expect(fixtureCompleteness(page,lineups,mapping).complete).toBe(false);
});
it('null minutes, missing squad and unknown mappings keep the fixture pending',()=>{
 const {page,lineups,mapping}=sample();page.teams[0].players[11].statistics[0].games.minutes=null;
 expect(fixtureCompleteness(page,lineups,mapping).complete).toBe(false);
 expect(fixtureCompleteness(sample().page,[],mapping).complete).toBe(false);
 mapping.delete(100);expect(fixtureCompleteness(sample().page,lineups,mapping).complete).toBe(false);
});
const stamp='2026-08-23T18:00:00Z';
const week:WeekFixture[]=[{fixture_id:1,status:'FT',kickoff:stamp,competition:'La Liga',gameweek:2,data_complete:true,evidence_version:stamp,expected_player_ids:[100]}];
const args={leagueId:'league',gameweek:2,playerIds:[100,999],weekFixtures:week,updatedAt:stamp};
it('unknown stays pending; complete fixture evidence permits legitimate absent-player DNP',()=>{
 const pending=buildLeaguePlayerScoreRows({...args,fixtureStats:[]});
 expect(pending.every(row=>row.status==='live'&&!row.data_complete)).toBe(true);
 const complete=buildLeaguePlayerScoreRows({...args,fixtureStats:[{fixture_id:1,player_id:100,minutes:90,source_updated_at:stamp}]});
 expect(complete[1]).toMatchObject({minutes:0,status:'final',data_complete:true,stats_received:false});
});
it('sums per-fixture points and ledgers without applying weekly scoring thresholds',()=>{
 const fixtures=[...week,{...week[0],fixture_id:2}];
 const rows=buildLeaguePlayerScoreRows({...args,weekFixtures:fixtures,fixtureStats:[1,2].map(fixture_id=>({fixture_id,player_id:100,minutes:90,fantasy_points:5,source_updated_at:stamp}))});
 expect(rows[0]).toMatchObject({minutes:180,fantasy_points:10,status:'final'});
});
it('ignores out-of-week and rescheduled excluded statistics, including corrected catch-up data',()=>{
 const rows=buildLeaguePlayerScoreRows({...args,weekFixtures:[...week,{...week[0],fixture_id:2,status:'EXCLUDED'}],fixtureStats:[
  {fixture_id:1,player_id:100,minutes:90,fantasy_points:3,source_updated_at:stamp},
  {fixture_id:2,player_id:100,minutes:90,fantasy_points:50,source_updated_at:stamp},
  {fixture_id:99,player_id:100,minutes:90,fantasy_points:60,source_updated_at:stamp},
 ]});expect(rows[0].fantasy_points).toBe(3);
});
it('replaces corrected values and rejects stale cached data from earlier observations',()=>{
 const old=buildLeaguePlayerScoreRows({...args,fixtureStats:[{fixture_id:1,player_id:100,minutes:24,source_updated_at:'2026-08-23T17:00:00Z'}]});
 expect(old[0]).toMatchObject({status:'live',minutes:0});
 const fixed=buildLeaguePlayerScoreRows({...args,fixtureStats:[{fixture_id:1,player_id:100,minutes:31,source_updated_at:stamp}]});
 expect(fixed[0]).toMatchObject({status:'final',minutes:31});
});
