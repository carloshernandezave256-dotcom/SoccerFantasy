import {calculateScore,type PlayerMatchStats,type Position} from './scoring';
import {normalizeSportMonks} from './sportmonks-scoring';
import {competitions,fixtureSides,fixtureStatus,kickoff,type SMFixture} from './sportmonks-data';
export type LabMatch={id:number;league:string;home:string;away:string;kickoff:string;started:boolean;finished:boolean;score:string};
export type LabMatchDetails={matchId:number;league:string;home:string;away:string;kickoff:string;status:'not_started'|'live'|'final';score:string;players:Array<{providerId:number;name:string;team:string;position:Position;stats:PlayerMatchStats;points:number}>;source:'sportmonks';fetchedAt:string};
export function previewMatch(f:SMFixture):LabMatch{
 const sides=fixtureSides(f),status=fixtureStatus(f);
 return {id:f.id,league:competitions.find(c=>c.id===f.league_id)?.name??String(f.league_id),home:sides.home.name,away:sides.away.name,kickoff:kickoff(f.starting_at),started:!['NS','TBD','PST','CANC'].includes(status),finished:['FT','AET','PEN'].includes(status),score:`${sides.homeScore??0} - ${sides.awayScore??0}`};
}
export function previewDetails(f:SMFixture):LabMatchDetails{
 const match=previewMatch(f),sides=fixtureSides(f),observedAt=new Date().toISOString();
 const status=match.finished?'final':match.started?'live':'not_started';
 const c=competitions.find(c=>c.id===f.league_id);if(!c)throw new Error('Unsupported competition');
 if(!match.started)return {matchId:f.id,...match,status,players:[],source:'sportmonks',fetchedAt:observedAt};
 if(sides.homeScore===null||sides.awayScore===null)throw new Error('Match score unavailable');
 const map=Object.fromEntries(f.lineups.map(l=>[l.player_id,l.player_id]));
 const rows=normalizeSportMonks({fixture_id:f.id,sportmonks_id:f.id,raw_data:f,player_map:map},{fixture_id:f.id,kickoff:match.kickoff,competition_id:c.legacyId,home_score:sides.homeScore,away_score:sides.awayScore},observedAt,{live:true});
 const players=rows.map(r=>{
  const lineup=f.lineups.find(l=>l.player_id===r.player_id)!;
  const position=({24:'GK',25:'DEF',26:'MID',27:'FWD',154:'DEF'} as Record<number,Position>)[lineup.player?.position_id??lineup.position_id??0];
  if(!position)throw new Error(`Unknown preview position for ${lineup.player_name}`);
  const stats:PlayerMatchStats={position,status,minutes:Number(r.minutes),goals:Number(r.goals),assists:Number(r.assists),shotsOnTarget:Number(r.shots_on_target),completedPasses:Number(r.completed_passes),tacklesWon:Number(r.tackles_won),penaltyGoals:Number(r.penalty_goals),penaltiesMissed:Number(r.penalties_missed),penaltiesConceded:Number(r.penalties_conceded),penaltiesSaved:Number(r.penalties_saved),saves:Number(r.saves),goalsConceded:Number(r.goals_conceded),yellowCards:Number(r.yellow_cards),secondYellowCards:Number(r.second_yellow_cards),redCards:Number(r.red_cards),ownGoals:Number(r.own_goals)};
  return {providerId:r.player_id,name:lineup.player_name,team:f.participants.find(t=>t.id===lineup.team_id)!.name,position,stats,points:calculateScore(stats).total};
 });
 return {matchId:f.id,...match,status,players,source:'sportmonks',fetchedAt:observedAt};
}
