type UnknownRecord=Record<string,unknown>;

export type AvailabilityPlayer={
  id:number;
  full_name:string;
  club:string;
  fotmob_id:number|null;
};

export type FotmobAvailability={
  fotmobId:number;
  name:string;
  kind:"injury"|"suspension";
  reason:string;
  expectedReturn:string|null;
};

export const FOTMOB_LEAGUE_IDS:Record<string,number>={
  "Premier League":47,
  "La Liga":87,
  "Serie A":55,
  Bundesliga:54,
  "Ligue 1":53,
};

function record(value:unknown):UnknownRecord{
  return value&&typeof value==="object"&&!Array.isArray(value)?value as UnknownRecord:{};
}

export function normalizeAvailabilityName(value:string){
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
}

function tokens(value:string){
  return normalizeAvailabilityName(value).split(" ").filter(Boolean);
}

function firstText(...values:unknown[]){
  for(const value of values){
    if(typeof value==="string"&&value.trim())return value.trim();
  }
  return null;
}

function collectNamedIds(value:unknown){
  const candidates:Array<{id:number;name:string;teamHint:number}>=[];
  const visit=(node:unknown)=>{
    if(Array.isArray(node)){node.forEach(visit);return;}
    if(!node||typeof node!=="object")return;
    const item=node as UnknownRecord;
    const id=Number(item.id??item.teamId??item.team_id);
    const name=firstText(item.name,item.longName,item.shortName,item.teamName);
    if(Number.isFinite(id)&&id>0&&name){
      const type=String(item.type??item.entityType??item.category??"").toLowerCase();
      const url=String(item.pageUrl??item.url??item.path??"").toLowerCase();
      const teamHint=(type.includes("team")?2:0)+(url.includes("/teams/")?2:0)+(item.teamId!==undefined||item.team_id!==undefined?1:0);
      candidates.push({id,name,teamHint});
    }
    Object.values(item).forEach(visit);
  };
  visit(value);
  return candidates;
}

function clubCandidateScore(club:string,candidate:{name:string;teamHint:number}){
  const wanted=normalizeAvailabilityName(club),found=normalizeAvailabilityName(candidate.name);
  if(!wanted||!found)return 0;
  let score=candidate.teamHint*20;
  if(found===wanted)score+=240;
  else if(wanted.length>=5&&(found.includes(wanted)||wanted.includes(found)))score+=130;
  else{
    const wantedTokens=new Set(tokens(club)),foundTokens=new Set(tokens(candidate.name));
    const overlap=[...wantedTokens].filter(token=>foundTokens.has(token)).length;
    if(overlap&&overlap===Math.min(wantedTokens.size,foundTokens.size))score+=80+overlap*10;
  }
  return score;
}

export function resolveFotmobClubIds(payload:unknown,clubs:string[]){
  const candidates=collectNamedIds(payload);
  const resolved=new Map<string,number>();
  for(const club of clubs){
    const ranked=candidates.map(candidate=>({candidate,score:clubCandidateScore(club,candidate)})).filter(item=>item.score>=120).sort((a,b)=>b.score-a.score||b.candidate.teamHint-a.candidate.teamHint);
    if(ranked[0]&&(!ranked[1]||ranked[0].score>ranked[1].score||ranked[0].candidate.id===ranked[1].candidate.id))resolved.set(club,ranked[0].candidate.id);
  }
  return resolved;
}

function availabilityGroups(payload:unknown){
  const squad=record(payload).squad;
  if(Array.isArray(squad))return squad;
  const nested=record(squad).squad;
  return Array.isArray(nested)?nested:[];
}

function injuryDetails(member:UnknownRecord){
  const injury=member.injury;
  const injuryRecord=record(injury);
  const status=firstText(member.status,member.availabilityStatus,member.availability_status);
  const injuryText=typeof injury==="string"?injury:null;
  const reason=firstText(injuryRecord.reason,injuryRecord.type,injuryRecord.description,injuryRecord.name,injuryRecord.text,injuryText,status)??"Injury";
  const expectedReturn=firstText(injuryRecord.expectedReturn,injuryRecord.expected_return,injuryRecord.returnDate,injuryRecord.return_date);
  const unavailableText=`${reason} ${status??""}`.toLowerCase();
  const suspension=/suspend|red card|yellow card/.test(unavailableText);
  const statusUnavailable=Boolean(status&&/injur|suspend|red card|yellow card|unavailable|\bout\b/.test(status.toLowerCase()));
  const unavailable=member.injured===true||Boolean(injury)||statusUnavailable;
  return {unavailable,kind:suspension?"suspension" as const:"injury" as const,reason,expectedReturn};
}

export function parseFotmobTeamAvailability(payload:unknown):FotmobAvailability[]{
  const found:FotmobAvailability[]=[];
  for(const groupValue of availabilityGroups(payload)){
    const group=record(groupValue),members=Array.isArray(group.members)?group.members:[];
    for(const memberValue of members){
      const member=record(memberValue),id=Number(member.id??member.playerId??member.player_id),name=firstText(member.name,member.playerName,member.fullName);
      if(!Number.isFinite(id)||id<=0||!name)continue;
      const details=injuryDetails(member);
      if(!details.unavailable)continue;
      found.push({fotmobId:id,name,kind:details.kind,reason:details.reason,expectedReturn:details.expectedReturn});
    }
  }
  return [...new Map(found.map(item=>[item.fotmobId,item])).values()];
}

function playerMatchScore(player:AvailabilityPlayer,availability:FotmobAvailability){
  if(player.fotmob_id===availability.fotmobId)return 1000;
  const wanted=tokens(player.full_name),found=tokens(availability.name);
  if(!wanted.length||!found.length)return 0;
  const wantedJoined=wanted.join(""),foundJoined=found.join("");
  let score=0;
  if(wantedJoined===foundJoined)score+=240;
  else if(wantedJoined.includes(foundJoined)||foundJoined.includes(wantedJoined))score+=100;
  const wantedSurname=wanted[wanted.length-1],foundSurname=found[found.length-1];
  if(wantedSurname===foundSurname)score+=110;
  else if(found.includes(wantedSurname)||wanted.includes(foundSurname))score+=70;
  const wantedFirst=wanted[0],foundFirst=found[0];
  if(wantedFirst.length===1&&foundFirst.startsWith(wantedFirst))score+=55;
  else if(foundFirst.length===1&&wantedFirst.startsWith(foundFirst))score+=55;
  else if(wantedFirst===foundFirst)score+=60;
  return score;
}

export function matchFotmobAvailabilityPlayer(availability:FotmobAvailability,players:AvailabilityPlayer[]){
  const ranked=players.map(player=>({player,score:playerMatchScore(player,availability)})).filter(item=>item.score>=160).sort((a,b)=>b.score-a.score);
  if(!ranked[0])return null;
  if(ranked[1]&&ranked[0].score===ranked[1].score)return null;
  return ranked[0].player;
}
