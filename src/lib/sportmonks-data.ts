import {createClient} from '@supabase/supabase-js';
import {sportmonks} from './sportmonks-server';
import {unusedSportMonksSubstitute,type SportMonksFixture} from './sportmonks-scoring';
export const competitions=[{id:8,legacyId:39,name:'Premier League'},{id:564,legacyId:140,name:'La Liga'},{id:384,legacyId:135,name:'Serie A'},{id:82,legacyId:78,name:'Bundesliga'},{id:301,legacyId:61,name:'Ligue 1'}];
export const fixtureInclude='participants;scores;state;lineups.player;lineups.details.type;events';
export type SMPlayer={id:number;name?:string;display_name?:string;common_name?:string;image_path?:string;position_id?:number};
export type SMFixture=Omit<SportMonksFixture,'lineups'> & {state_id?:number;round?:{name:string};season_id?:number;lineups:Array<SportMonksFixture['lineups'][number]&{player?:SMPlayer;position_id?:number}>};
export type SMTeam={sportmonks_id:number;club:string;competition:string};
export function adminDb(){
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw new Error('Server database credential is not configured.');
 return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL??'https://ocabrgbrkqmsnalbfzvx.supabase.co',key,{auth:{persistSession:false,autoRefreshToken:false}});
}
export async function checked<T>(query:PromiseLike<{data:T;error:{message:string}|null}>):Promise<NonNullable<T>>{const {data,error}=await query;if(error)throw new Error(error.message);return data as NonNullable<T>;}
export async function allPages<T>(path:string,params:Record<string,string>={}){
 const rows:T[]=[];let requestsUsed=0;
 for(let page=1;page<=200;page++){
  const result=await sportmonks(path,{...params,per_page:'50',page:String(page)});requestsUsed++;
  if(!Array.isArray(result.data))throw new Error('SportMonks list payload is invalid.');
  rows.push(...result.data as T[]);
  if(!result.pagination?.has_more)return {rows,requestsUsed};
 }
 throw new Error('SportMonks pagination exceeded the safety limit.');
}
export function kickoff(value:string){return new Date(value.includes('T')?value:value.replace(' ','T')+'Z').toISOString();}
export function fixtureStatus(f:Pick<SMFixture,'state'|'state_id'>){
 const states:Record<string,string>={NS:'NS',INPLAY_1ST_HALF:'1H',INPLAY_2ND_HALF:'2H',HT:'HT',FT:'FT',AET:'AET',FT_PEN:'PEN',INPLAY_ET:'ET',EXTRA_TIME_BREAK:'BT',INPLAY_PENALTIES:'P',PEN_BREAK:'BT',BREAK:'BT',POSTPONED:'PST',SUSPENDED:'SUSP',CANCELLED:'CANC',ABANDONED:'ABD',AWARDED:'AWD',WO:'WO',DELAYED:'TBD',INTERRUPTED:'INT'};
 const ids:Record<number,string>={1:'NS',2:'1H',3:'HT',4:'2H',5:'FT',6:'ET',7:'AET',8:'PEN',9:'P',10:'PST',11:'SUSP',12:'CANC',13:'TBD',14:'WO',15:'ABD',16:'BT',17:'BT',18:'INT',19:'AWD'};
 const status=states[f.state?.state]??ids[f.state_id??0];
 if(!status)throw new Error(`Unsupported SportMonks state ${f.state?.state??f.state_id}`);
 return status;
}
export function fixtureSides(f:SMFixture){
 const home=f.participants?.find(p=>p.meta.location==='home'),away=f.participants?.find(p=>p.meta.location==='away');
 if(!home||!away||home.id===away.id)throw new Error(`SportMonks ${f.id}: missing participants`);
 const score=(id:number)=>f.scores?.find(s=>s.description==='CURRENT'&&s.participant_id===id)?.score.goals??null;
 return {home,away,homeScore:score(home.id),awayScore:score(away.id)};
}
export async function profileMap(f:SMFixture,teams:SMTeam[],namesOnly=true){
 const db=adminDb();const profiles=f.lineups.filter(l=>{
  if(!l.player&&unusedSportMonksSubstitute(f,l))return false;
  return true;
 }).map(l=>{
  const team=teams.find(t=>t.sportmonks_id===l.team_id);
  if(!team||!l.player||l.player.id!==l.player_id)throw new Error(`Missing SportMonks profile or team for ${l.player_name}`);
  return {player:l.player,club:team.club,competition:team.competition};
 });
 const result=await checked(db.rpc('sync_sportmonks_profiles',{p_profiles:profiles,p_names_only:namesOnly}));
 return result.playerMap as Record<string,number>;
}
export async function currentSeasons(){
 const {rows,requestsUsed}=await allPages<{id:number;currentseason?:{id:number;name:string};currentSeason?:{id:number;name:string}}>('leagues',{include:'currentSeason'});
 return {requestsUsed,seasons:competitions.map(c=>{
  const league=rows.find(l=>l.id===c.id);const season=league?.currentseason??league?.currentSeason;
  if(!season?.id)throw new Error(`SportMonks current season unavailable for ${c.name}`);
  return {...c,season};
 })};
}
