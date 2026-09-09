import {describe,expect,it} from "vitest";
import {matchFotmobAvailabilityPlayer,parseFotmobTeamAvailability,resolveFotmobClubIds} from "./fotmob-availability";

describe("FotMob availability backup",()=>{
  it("resolves API-Football club labels against FotMob league payloads",()=>{
    const payload={overview:{table:[{data:{tables:[{table:{all:[
      {id:9823,name:"Bayern München"},
      {id:8634,name:"Paris Saint-Germain"},
    ]}}]}}]}};
    const resolved=resolveFotmobClubIds(payload,["Bayern München","Paris Saint Germain"]);
    expect(resolved.get("Bayern München")).toBe(9823);
    expect(resolved.get("Paris Saint Germain")).toBe(8634);
  });

  it("reads injured and suspended squad members",()=>{
    const payload={squad:{squad:[{members:[
      {id:1,name:"Manuel Locatelli",injured:true,injury:{type:"Knee injury",expectedReturn:"February 2027"}},
      {id:2,name:"Player Two",status:"Suspended"},
      {id:3,name:"Healthy Player",injured:false},
    ]}]}};
    expect(parseFotmobTeamAvailability(payload)).toEqual([
      {fotmobId:1,name:"Manuel Locatelli",kind:"injury",reason:"Knee injury",expectedReturn:"February 2027"},
      {fotmobId:2,name:"Player Two",kind:"suspension",reason:"Suspended",expectedReturn:null},
    ]);
  });

  it("matches abbreviated fantasy names without requiring a stored FotMob id",()=>{
    const player=matchFotmobAvailabilityPlayer(
      {fotmobId:123,name:"Manuel Locatelli",kind:"injury",reason:"Knee injury",expectedReturn:null},
      [{id:2086,full_name:"M. Locatelli",club:"Juventus",fotmob_id:null}],
    );
    expect(player?.id).toBe(2086);
  });

  it("prefers an existing FotMob identity over name matching",()=>{
    const player=matchFotmobAvailabilityPlayer(
      {fotmobId:999,name:"Different Display Name",kind:"injury",reason:"Injury",expectedReturn:null},
      [
        {id:1,full_name:"D. Name",club:"Club",fotmob_id:null},
        {id:2,full_name:"Other",club:"Club",fotmob_id:999},
      ],
    );
    expect(player?.id).toBe(2);
  });
});
