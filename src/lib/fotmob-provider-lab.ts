import {calculateScore,type LedgerEntry,type PlayerMatchStats,type Position} from "./scoring";

type UnknownRecord=Record<string,unknown>;
type FotmobStat={key?:string;stat?:{value?:number;total?:number}};
type FotmobPlayer={id?:number;name?:string;teamId?:number;teamName?:string;usualPosition?:number;isGoalkeeper?:boolean;stats?:Array<{stats?:Record<string,FotmobStat>}>};

export type LabMatch={id:number;league:string;home:string;away:string;kickoff:string;started:boolean;finished:boolean;score:string};
export type LabPlayer={fotmobId:number;name:string;team:string;position:Position;stats:PlayerMatchStats;points:number;ledger:LedgerEntry[];coverage:string[]};
export type LabMatchDetails={matchId:number;league:string;home:string;away:string;kickoff:string;status:"not_started"|"live"|"final";score:string;players:LabPlayer[];source:"fotmob-public-web";fetchedAt:string};

function record(value:unknown):UnknownRecord{return value&&typeof value==="object"&&!Array.isArray(value)?value as UnknownRecord:{}}
function number(value:unknown,fallback=0){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback}
function bool(value:unknown){return value===true}
function text(value:unknown){return typeof value==="string"?value:""}

export function parseFotmobMatches(payload:unknown):LabMatch[]{
  const root=record(payload),leagues=Array.isArray(root.leagues)?root.leagues:[];
  return leagues.flatMap(leagueValue=>{
    const league=record(leagueValue),leagueName=text(league.name),matches=Array.isArray(league.matches)?league.matches:[];
    return matches.map(matchValue=>{
      const match=record(matchValue),home=record(match.home),away=record(match.away),status=record(match.status);
      return{id:number(match.id),league:leagueName,home:text(home.longName)||text(home.name),away:text(away.longName)||text(away.name),kickoff:text(match.time),started:bool(status.started),finished:bool(status.finished),score:`${number(home.score)} - ${number(away.score)}`};
    }).filter(match=>match.id>0);
  });
}

function position(value:number|undefined,isGoalkeeper:boolean|undefined):Position{
  if(isGoalkeeper||value===0)return "GK";
  if(value===1)return "DEF";
  if(value===2)return "MID";
  return "FWD";
}

function flattenedStats(player:FotmobPlayer){
  const all=new Map<string,number>();
  for(const section of player.stats??[]){
    for(const [label,item] of Object.entries(section.stats??{})){
      const key=(item.key??label).toLocaleLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
      if(!all.has(key))all.set(key,number(item.stat?.value??item.stat?.total));
    }
  }
  return all;
}

function first(values:Map<string,number>,...keys:string[]){
  for(const key of keys){const value=values.get(key.toLocaleLowerCase());if(value!==undefined)return value}
  return 0;
}

export function parseFotmobMatchDetails(payload:unknown):LabMatchDetails{
  const root=record(payload),general=record(root.general),header=record(root.header),statusData=record(header.status),teams=Array.isArray(header.teams)?header.teams.map(record):[];
  const home=teams[0]??record(general.homeTeam),away=teams[1]??record(general.awayTeam);
  const status:LabMatchDetails["status"]=bool(statusData.finished)?"final":bool(statusData.started)?"live":"not_started";
  const playerStats=record(record(root.content).playerStats);
  const players=Object.values(playerStats).map(value=>value as FotmobPlayer).filter(player=>number(player.id)>0).map(player=>{
    const values=flattenedStats(player),playerPosition=position(player.usualPosition,player.isGoalkeeper),isHome=number(player.teamId)===number(home.id);
    const stats:PlayerMatchStats={
      position:playerPosition,
      minutes:first(values,"minutes_played","minutes"),
      goals:first(values,"goals"),
      assists:first(values,"assists"),
      shotsOnTarget:first(values,"shotsontarget","shots_on_target"),
      completedPasses:first(values,"accurate_passes","completed_passes"),
      tacklesWon:first(values,"matchstats_headers_tackles","tackles","tackles_won"),
      penaltyGoals:first(values,"penalty_goals","penalties_scored"),
      penaltiesMissed:first(values,"penalty_missed","penalties_missed"),
      penaltiesConceded:first(values,"penalty_committed","penalties_conceded"),
      saves:first(values,"saves"),
      penaltiesSaved:first(values,"penalty_saved","penalties_saved"),
      goalsConceded:isHome?number(away.score):number(home.score),
      yellowCards:first(values,"yellow_cards","yellow_card"),
      secondYellowCards:first(values,"second_yellow_cards","second_yellow_card"),
      redCards:first(values,"red_cards","red_card"),
      ownGoals:first(values,"own_goals","own_goal"),
      status,
    };
    const result=calculateScore(stats);
    const coverage=["minutes","goals","assists","completed passes","shots on target","tackles","saves","team goals conceded","cards","penalties","own goals"];
    return{fotmobId:number(player.id),name:text(player.name),team:text(player.teamName),position:playerPosition,stats,points:result.total,ledger:result.entries,coverage};
  }).sort((a,b)=>b.points-a.points||a.name.localeCompare(b.name));
  return{matchId:number(general.matchId),league:text(general.leagueName),home:text(home.name),away:text(away.name),kickoff:text(statusData.utcTime),status,score:text(statusData.scoreStr)||`${number(home.score)} - ${number(away.score)}`,players,source:"fotmob-public-web",fetchedAt:new Date().toISOString()};
}
