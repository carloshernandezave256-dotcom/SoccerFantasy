import {adminDb,checked} from './sportmonks-data';
import {normalizeAvailabilityName} from './fotmob-availability';
import type {DoubtfulReport} from './fotmob-doubtful';
export async function saveDoubtfulReport(report:DoubtfulReport){
 if(report.errors.length||report.clubsChecked!==report.clubsExpected)return {saved:false,unresolved:0};
 const db=adminDb();type Player={id:number;full_name:string;fotmob_id:number|null};const players:Player[]=[];
 for(let offset=0;;offset+=1000){
  const rows=await checked(db.from('players').select('id,full_name,fotmob_id').eq('competition',report.league).or('api_football_id.not.is.null,provider_id.like.sportmonks:%').order('id').range(offset,offset+999));
  players.push(...rows);if(rows.length<1000)break;
 }
 const ids:number[]=[];let unresolved=0;
 for(const player of report.players){
  let matches=players.filter(p=>p.fotmob_id===player.id);
  if(!matches.length)matches=players.filter(p=>normalizeAvailabilityName(p.full_name)===normalizeAvailabilityName(player.name));
  if(matches.length===1)ids.push(matches[0].id);else unresolved++;
 }
 await checked(db.rpc('apply_doubtful_report',{p_competition:report.league,p_ids:ids,p_checked_at:report.checkedAt,p_clear_missing:unresolved===0}));
 return {saved:true,mapped:ids.length,unresolved};
}
