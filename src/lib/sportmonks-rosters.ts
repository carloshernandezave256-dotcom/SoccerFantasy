import {adminDb,allPages,checked,currentSeasons,competitions,type SMPlayer,type SMTeam} from './sportmonks-data';
import {sportmonks} from './sportmonks-server';
export async function syncSportMonksPlayers(namesOnly=false){
 const db=adminDb(),teams=await checked(db.from('sportmonks_teams').select('*')) as SMTeam[];
 const current=await currentSeasons();let requestsUsed=current.requestsUsed,imported=0,unresolved=0,playersFound=0;
 const unavailable:string[]=[],seasonsUsed:Record<string,number>={};
 // Read and validate all squads before updating any records. An absent player is not retired automatically.
 const profiles=[];
 for(const c of current.seasons){
  const {rows:providerTeams,requestsUsed:used}=await allPages<{id:number}>(`teams/seasons/${c.season.id}`);requestsUsed+=used;
  if(providerTeams.length<18)throw new Error(`Incomplete current teams for ${c.name}`);
  seasonsUsed[c.name]=Number(c.season.name.slice(0,4));
  for(let i=0;i<providerTeams.length;i+=5){
   const batches=await Promise.all(providerTeams.slice(i,i+5).map(async team=>{
    const canonical=teams.find(t=>t.sportmonks_id===team.id&&t.competition===c.name);
    if(!canonical)throw new Error(`Unmapped SportMonks team ${team.id}`);
    const result=await allPages<{player_id:number;player:SMPlayer}>(`squads/teams/${team.id}`,{include:'player'});
    if(result.rows.length<11)throw new Error(`Incomplete current squad for ${canonical.club}`);
    return {canonical,...result};
   }));
   for(const {canonical,rows,requestsUsed:used} of batches){
    requestsUsed+=used;
    for(const row of rows){if(!row.player||row.player.id!==row.player_id)throw new Error('Squad player identity missing');profiles.push({player:row.player,club:canonical.club,competition:c.name});}
   }
  }
 }
 for(let i=0;i<profiles.length;i+=250){
  const result=await checked(db.rpc('sync_sportmonks_profiles',{p_profiles:profiles.slice(i,i+250),p_names_only:namesOnly}));
  imported+=result.mapped;unresolved+=result.unresolved;
 }
 playersFound=profiles.length;
 return {ok:true,provider:'sportmonks',imported,updated:imported,reconciled:imported,unresolved,playersFound,requestsUsed,unavailable,seasonsUsed};
}
type Sideline={player_id:number;participant_id:number;type?:{name:string};sideline?:{category:string;start_date:string|null;end_date:string|null;completed:boolean};player?:SMPlayer};
type InjuryFixture={id:number;league_id:number;starting_at:string;participants:Array<{id:number}>;sidelined?:Sideline[]};
export async function syncSportMonksInjuries(){
 const db=adminDb(),now=new Date(),today=now.toISOString().slice(0,10);
 const start=new Date(now.getTime()-7*86400000).toISOString().slice(0,10),end=new Date(now.getTime()+7*86400000).toISOString().slice(0,10);
 const {rows,requestsUsed}=await allPages<InjuryFixture>(`fixtures/between/${start}/${end}`,{include:'participants;sidelined.sideline;sidelined.type;sidelined.player',filters:`fixtureLeagues:${competitions.map(c=>c.id).join(',')}`});
 const teams=await checked(db.from('sportmonks_teams').select('*')) as SMTeam[];
 const latest=new Map<number,{record:Sideline;date:string}>();
 for(const fixture of rows){
  if(!competitions.some(c=>c.id===fixture.league_id))continue;
  for(const record of fixture.sidelined??[]){
   const existing=latest.get(record.player_id);
   if(!existing||existing.date<fixture.starting_at)latest.set(record.player_id,{record,date:fixture.starting_at});
  }
 }
 const reports=[...latest.values()].filter(({record:r})=>r.player&&r.sideline&&teams.some(t=>t.sportmonks_id===r.participant_id));
 const mappings:Record<string,number>={};
 for(let i=0;i<reports.length;i+=250){
  const result=await checked(db.rpc('sync_sportmonks_profiles',{p_profiles:reports.slice(i,i+250).map(({record:r})=>{
   const team=teams.find(t=>t.sportmonks_id===r.participant_id)!;return {player:r.player,club:team.club,competition:team.competition};
  }),p_names_only:true}));Object.assign(mappings,result.playerMap);
 }
 const ids=Object.values(mappings);
 const existingRows=ids.length?await checked(db.from('players').select('id,availability_last_appearance_at,club').in('id',ids)):[];
 const existingById=new Map(existingRows.map(p=>[p.id,p]));
 let injuriesSynced=0,playersCleared=0,unresolved=latest.size-reports.length,dated=0;
 for(const {record:r} of reports){
  const team=teams.find(t=>t.sportmonks_id===r.participant_id)!;
  const id=mappings[r.player_id],existing=existingById.get(id);
  if(!id||!existing){unresolved++;continue;}
  if(existing.club!==team.club)continue;
  const sideline=r.sideline!;
  // Old reports cannot re-injure a player after a newer confirmed appearance.
  if(existing.availability_last_appearance_at&&sideline.start_date&&Date.parse(existing.availability_last_appearance_at)>Date.parse(sideline.start_date+'T23:59:59Z'))continue;
  const completed=sideline.completed===true;
  const values=completed?{injured:false,injury_type:null,injury_reason:null,expected_return:null}:{injured:true,injury_type:sideline.category==='suspension'?'Suspension':'Injury',injury_reason:r.type?.name??null,expected_return:sideline.end_date&&sideline.end_date>=today?sideline.end_date:null};
  await checked(db.from('players').update({...values,injury_updated_at:now.toISOString(),sidelined_checked_at:now.toISOString(),fotmob_expected_return:null,fotmob_return_checked_at:null}).eq('id',id));
  if(completed)playersCleared++;else{injuriesSynced++;if(values.expected_return)dated++;}
 }
 return {ok:true,provider:'sportmonks',requestsUsed,injuriesSynced,playersCleared,unresolved,dated,sidelinedLookups:latest.size,sidelinedCacheHits:0,unavailable:[],notes:['An empty injury report does not clear a player.']};
}
export async function sportMonksClubLookup(legacyId:number){
 const db=adminDb();const player=await checked(db.from('players').select('sportmonks_id').eq('api_football_id',legacyId).not('sportmonks_id','is',null).maybeSingle());
 if(!player?.sportmonks_id)throw new Error(`No verified SportMonks mapping for player ${legacyId}`);
 const response=await sportmonks(`players/${player.sportmonks_id}`,{include:'teams.team'});
 const p=response.data as SMPlayer&{teams?:Array<{start:string;end:string|null;team:{id:number;name:string;image_path:string}}>};
 const today=new Date().toISOString().slice(0,10);
 const memberships=(p.teams??[]).filter(t=>t.start<=today&&(!t.end||t.end>=today));
 const teams=await checked(db.from('sportmonks_teams').select('*')) as SMTeam[];
 const current=memberships.filter(m=>teams.some(t=>t.sportmonks_id===m.team.id));
 if(current.length!==1)throw new Error('Current domestic club could not be uniquely verified.');
 return {playerId:legacyId,providerPlayer:p.display_name??p.name,clubId:current[0].team.id,club:current[0].team.name,clubLogo:current[0].team.image_path};
}
