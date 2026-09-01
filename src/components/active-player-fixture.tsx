"use client";

import {useEffect,useState} from "react";
import {fixturesForFantasyWeek} from "@/lib/fantasy-week-window";
import {fixtureForClub,fixtureOpponent,fixtureVenue,type PlayerFixture} from "@/lib/player-fixtures";
import {supabase} from "@/lib/supabase";
import {resolveActiveLeague} from "@/lib/active-league";

type WindowRow={gameweek:number;roster_lock_at:string};
type CachedWeek={expiresAt:number;promise:Promise<PlayerFixture[]>};

const fixtureCache=new Map<string,CachedWeek>();
let currentLeaguePromise:Promise<string>|null=null;

async function currentLeagueId(){
  if(!currentLeaguePromise)currentLeaguePromise=(async()=>{
    const{data}=await supabase.rpc("my_leagues");
    return resolveActiveLeague((data??[]) as Array<{league_id:string}>,new URLSearchParams(window.location.search).get("league"))?.league_id??"";
  })();
  return await currentLeaguePromise;
}

function loadActiveWeekFixtures(leagueId:string){
  const cached=fixtureCache.get(leagueId);
  if(cached&&cached.expiresAt>Date.now())return cached.promise;
  const promise=(async()=>{
    const[windowResult,leagueResult]=await Promise.all([
      supabase.rpc("transaction_window",{p_league_id:leagueId}),
      supabase.from("leagues").select("calendar_competition").eq("id",leagueId).single(),
    ]);
    const window=((windowResult.data??[]) as WindowRow[])[0];
    const calendarCompetition=(leagueResult.data as {calendar_competition?:string}|null)?.calendar_competition;
    if(!window||!calendarCompetition)return[];
    const lockDate=new Date(window.roster_lock_at);
    const startsAt=new Date(Date.UTC(lockDate.getUTCFullYear(),lockDate.getUTCMonth(),lockDate.getUTCDate()));
    const endsAt=new Date(startsAt.getTime()+7*24*60*60*1000-1);
    const{data}=await supabase.from("league_headline_fixtures")
      .select("fixture_id,gameweek,competition,kickoff,status,home_team,away_team,home_score,away_score")
      .eq("league_id",leagueId)
      .gte("kickoff",startsAt.toISOString())
      .lte("kickoff",endsAt.toISOString())
      .order("kickoff",{ascending:true});
    const fixtures=(data??[]) as PlayerFixture[];
    return fixturesForFantasyWeek(
      fixtures.map(fixture=>({...fixture,officialRound:fixture.gameweek})),
      {startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString()},
      {[calendarCompetition]:window.gameweek},
    );
  })();
  fixtureCache.set(leagueId,{expiresAt:Date.now()+5*60*1000,promise});
  return promise;
}

export function ActivePlayerFixture({leagueId,club,className=""}:{leagueId?:string;club:string;className?:string}){
  const[fixture,setFixture]=useState<PlayerFixture|null>(null);
  useEffect(()=>{let active=true;void(leagueId?Promise.resolve(leagueId):currentLeagueId()).then(id=>id?loadActiveWeekFixtures(id):[]).then(fixtures=>{if(active)setFixture(fixtureForClub(fixtures,club))});return()=>{active=false}},[leagueId,club]);
  if(!fixture)return null;
  return <span className={`active-player-fixture ${className}`.trim()}><b>{fixtureVenue(fixture,club)==="Home"?"vs":"@"} {fixtureOpponent(fixture,club)}</b><i>{new Date(fixture.kickoff).toLocaleString([], {weekday:"short",hour:"numeric",minute:"2-digit"})}</i></span>;
}
