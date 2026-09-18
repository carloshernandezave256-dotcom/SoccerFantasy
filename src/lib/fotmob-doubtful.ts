export const doubtfulLeagues = [
  {id:47,name:'Premier League',slug:'premier-league',clubs:20},
  {id:87,name:'La Liga',slug:'laliga',clubs:20},
  {id:55,name:'Serie A',slug:'serie-a',clubs:20},
  {id:54,name:'Bundesliga',slug:'bundesliga',clubs:18},
  {id:53,name:'Ligue 1',slug:'ligue-1',clubs:18},
] as const;
export type DoubtfulPlayer={id:number;name:string;club:string;league:string;status:'Doubtful';source:'FotMob';sourceUrl:string};
export type DoubtfulReport={league:string;checkedAt:string;clubsChecked:number;clubsExpected:number;players:DoubtfulPlayer[];errors:string[]};
type ObjectData=Record<string,unknown>;
function object(value:unknown):ObjectData{return value&&typeof value==='object'&&!Array.isArray(value)?value as ObjectData:{};}
export function parseFotmobPage(html:string){
 const match=html.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!match)throw new Error('FotMob page data is unavailable.');
 const props=object(object(JSON.parse(match[1])).props).pageProps;
 if(!props)throw new Error('FotMob page data is incomplete.');
 return object(props);
}
export function doubtfulSquad(page:ObjectData,teamId:number,club:string,league:string,sourceUrl:string):DoubtfulPlayer[]{
 const team=object(object(page.fallback)[`team-${teamId}`]??page);
 if(Number(object(team.details).id)!==teamId)throw new Error('FotMob team identity did not match.');
 const groups=Array.isArray(team.squad)?team.squad:object(team.squad).squad;
 if(!Array.isArray(groups)||!groups.length)throw new Error('FotMob squad is unavailable.');
 const players=new Map<number,DoubtfulPlayer>();let members=0;
 for(const group of groups){
  const entries=object(group).members;if(!Array.isArray(entries))throw new Error('FotMob squad is incomplete.');
  for(const entry of entries){
   const player=object(entry);members++;
   if(String(object(player.injury).expectedReturn??'').trim().toLowerCase()!=='doubtful')continue;
   if(!Number.isSafeInteger(player.id)||Number(player.id)<=0||typeof player.name!=='string')throw new Error('Doubtful player identity is missing.');
   players.set(Number(player.id),{id:Number(player.id),name:player.name,club,league,status:'Doubtful',source:'FotMob',sourceUrl});
  }
 }
 if(members<11)throw new Error('FotMob squad is incomplete.');
 return [...players.values()];
}
async function getPage(path:string){
 const response=await fetch(`https://www.fotmob.com${path}`,{cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Error(`FotMob returned HTTP ${response.status}.`);
 return parseFotmobPage(await response.text());
}
export async function fetchDoubtfulLeague(id:number):Promise<DoubtfulReport>{
 const league=doubtfulLeagues.find(l=>l.id===id);if(!league)throw new Error('Unsupported league.');
 const page=await getPage(`/leagues/${league.id}/table/${league.slug}`);
 const teams=new Map<number,{id:number;name:string;path:string}>();
 const walk=(value:unknown)=>{
  if(Array.isArray(value)){value.forEach(walk);return;}
  if(!value||typeof value!=='object')return;
  const row=object(value),path=String(row.pageUrl??'');
  if(Number.isSafeInteger(row.id)&&typeof row.name==='string'&&'played' in row&&new RegExp(`^/teams/${row.id}/overview/[a-z0-9-]+$`).test(path))teams.set(Number(row.id),{id:Number(row.id),name:row.name,path:path.replace('/overview/','/squad/')});
  Object.values(row).forEach(walk);
 };
 walk(page.table??object(object(page.fallback)[`league-${id}`]).table);
 if(teams.size!==league.clubs)throw new Error(`Incomplete ${league.name} club list (${teams.size}/${league.clubs}).`);
 const list=[...teams.values()],players:DoubtfulPlayer[]=[],errors:string[]=[];let clubsChecked=0,next=0;
 await Promise.all(Array.from({length:4},async()=>{
  while(next<list.length){
   const team=list[next++];
   try{players.push(...doubtfulSquad(await getPage(team.path),team.id,team.name,league.name,`https://www.fotmob.com${team.path}`));clubsChecked++;}
   catch(error){errors.push(`${team.name}: ${error instanceof Error?error.message:'Fetch failed.'}`);}
  }
 }));
 return {league:league.name,checkedAt:new Date().toISOString(),clubsChecked,clubsExpected:league.clubs,players:players.sort((a,b)=>a.club.localeCompare(b.club)||a.name.localeCompare(b.name)),errors};
}
