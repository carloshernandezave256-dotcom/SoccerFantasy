"use client";

import {PlayerHeadshot} from "@/components/player-headshot";

type PackPlayer={full_name:string;position:string;club:string;competition:string;photo_url:string|null;draft_rank:number|null;is_club_captain:boolean};
type Props={player:PackPlayer|null;active:boolean;duplicateCount:number;onToggle:()=>void;onExchange?:()=>void;onList?:()=>void};

const leagueClasses:Record<string,string>={"Premier League":"premier-league","La Liga":"la-liga","Bundesliga":"bundesliga","Serie A":"serie-a","Ligue 1":"ligue-1"};

export function PackCollectionCard({player,active,duplicateCount,onToggle,onExchange,onList}:Props){
 const tier=(player?.draft_rank??9999)<=50?"superstar":(player?.draft_rank??9999)<=150?"star":"base";
 const leagueClass=leagueClasses[player?.competition??""]??"top-five";
 return <article className={`collection-card ${leagueClass} ${tier} ${active?"active":""}`}>
  <button className="collection-card-face" onClick={onToggle} aria-pressed={active} aria-label={`${active?"Remove":"Add"} ${player?.full_name??"player"} ${active?"from":"to"} active squad`}>
   <span className="collection-card-shine"/>
   <header><span>{player?.competition??"TOP FIVE"}</span>{duplicateCount>1?<b>×{duplicateCount}</b>:null}</header>
   <div className="collection-card-rating"><strong>{player?.draft_rank??"—"}</strong><span>{player?.position}</span></div>
   {player?<PlayerHeadshot name={player.full_name} position={player.position} photoUrl={player.photo_url} className="collection-card-photo" decorative/>:null}
   <div className="collection-card-copy"><small>{tier.toUpperCase()}</small><h3>{player?.full_name}</h3><p>{player?.club}</p></div>
   <footer><span>{player?.is_club_captain?"CAPTAIN":"XI FANTASY"}</span><b>{active?"ACTIVE":"COLLECTION"}</b></footer>
  </button>
  {duplicateCount>1&&!active&&(onExchange||onList)?<div className="collection-card-actions">{onExchange?<button onClick={onExchange}>Exchange</button>:null}{onList?<button onClick={onList}>List</button>:null}</div>:null}
 </article>
}
