"use client";

import {useEffect,useState} from "react";
import {fixturesForFantasyWeek} from "@/lib/fantasy-week-window";
import {fixtureForClub,fixtureOpponent,fixtureVenue,type PlayerFixture} from "@/lib/player-fixtures";
import {createExpiringRequestCache} from "@/lib/expiring-request-cache";
import {supabase} from "@/lib/supabase";


type WindowRow={gameweek:number;roster_lock_at:string};
const fixtureCache=createExpiringRequestCache<PlayerFixture[]>(5*60*1000);
let fixtureUser:string|undefined;
supabase.auth.onAuthStateChange((_event,session)=>{
  if(fixtureUser!==session?.user.id){fixtureUser=session?.user.id;fixtureCache.clear()}
});
function loadActiveWeekFixtures(leagueId:string){
  return fixtureCache.load(leagueId,async()=>{
    const[windowResult,leagueResult]=await Promise.all([
      supabase.rpc("transaction_window",{p_league_id:leagueId}),
      supabase.rpc("league_settings",{p_league_id:leagueId}),
    ]);
    if(windowResult.error)throw windowResult.error;
    if(leagueResult.error)throw leagueResult.error;
    const window=((windowResult.data??[]) as WindowRow[])[0];
    const calendarCompetition=((leagueResult.data??[]) as {calendar_competition?:string}[])[0]?.calendar_competition;
    if(!window||!calendarCompetition)return[];
    const lockDate=new Date(window.roster_lock_at);
    const startsAt=new Date(Date.UTC(lockDate.getUTCFullYear(),lockDate.getUTCMonth(),lockDate.getUTCDate()));
    const endsAt=new Date(startsAt.getTime()+7*24*60*60*1000-1);
    const{data,error}=await supabase.from("league_headline_fixtures")
      .select("fixture_id,gameweek,competition,kickoff,status,home_team,away_team,home_score,away_score")
      .eq("league_id",leagueId)
      .gte("kickoff",startsAt.toISOString())
      .lte("kickoff",endsAt.toISOString())
      .order("kickoff",{ascending:true});
    if(error)throw error;
    const fixtures=(data??[]) as PlayerFixture[];
    return fixturesForFantasyWeek(
      fixtures.map(fixture=>({...fixture,officialRound:fixture.gameweek})),
      {startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString()},
      {[calendarCompetition]:window.gameweek},
    );
  });
}

export function ActivePlayerFixture({leagueId,club,className=""}:{leagueId:string;club:string;className?:string}){
  const[fixture,setFixture]=useState<PlayerFixture|null>(null);
  useEffect(()=>{
    let active=true;
    let request=0;
    const refresh=()=>{
      if(!active)return;
      const version=++request;
      setFixture(null);
      if(leagueId)void loadActiveWeekFixtures(leagueId)
        .then(fixtures=>{if(active&&version===request)setFixture(fixtureForClub(fixtures,club))})
        .catch(()=>{if(active&&version===request)setFixture(null)});
    };
    refresh();
    const timer=window.setInterval(refresh,5*60*1000);
    const {data:{subscription}}=supabase.auth.onAuthStateChange(event=>{
      if(event==="SIGNED_IN"||event==="SIGNED_OUT")queueMicrotask(refresh);
    });
    return()=>{active=false;window.clearInterval(timer);subscription.unsubscribe()};
  },[leagueId,club]);
  if(!fixture)return null;
  return <span className={`active-player-fixture ${className}`.trim()}><b>{fixtureVenue(fixture,club)==="Home"?"vs":"@"} {fixtureOpponent(fixture,club)}</b><i>{new Date(fixture.kickoff).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}</i></span>;
}
