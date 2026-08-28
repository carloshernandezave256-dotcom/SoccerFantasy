import {describe,expect,it} from "vitest";
import {parseFotmobMatchDetails,parseFotmobMatches} from "./fotmob-provider-lab";

describe("FotMob provider lab parser",()=>{
  it("normalizes a match list",()=>{
    expect(parseFotmobMatches({leagues:[{name:"Premier League",matches:[{id:12,time:"today",home:{name:"A",score:1},away:{name:"B",score:0},status:{started:true,finished:false}}]}]})).toEqual([{id:12,league:"Premier League",home:"A",away:"B",kickoff:"today",started:true,finished:false,score:"1 - 0"}]);
  });

  it("runs normalized statistics through the real calculator",()=>{
    const result=parseFotmobMatchDetails({general:{matchId:"12",leagueName:"Premier League"},header:{status:{started:true,finished:true,scoreStr:"1 - 0"},teams:[{id:1,name:"A",score:1},{id:2,name:"B",score:0}]},content:{playerStats:{"9":{id:9,name:"Mid",teamId:1,teamName:"A",usualPosition:2,stats:[{stats:{"Minutes played":{key:"minutes_played",stat:{value:90}},Goals:{key:"goals",stat:{value:1}},"Accurate passes":{key:"accurate_passes",stat:{value:42}},"Yellow cards":{key:"yellow_cards",stat:{value:1}}}}]}}}});
    expect(result.players[0].points).toBe(10);
    expect(result.players[0].stats).toMatchObject({position:"MID",minutes:90,goals:1,completedPasses:42,yellowCards:1,goalsConceded:0,status:"final"});
  });
});
