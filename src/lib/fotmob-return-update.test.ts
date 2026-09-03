import {describe,expect,it} from "vitest";
import {fotmobConfirmsActive,fotmobReturnUpdate,recentFotmobClearBlocksInjury} from "./fotmob-return-update";

describe("FotMob return estimate updates",()=>{
  it("keeps fuzzy provider labels out of the exact return-date field",()=>{
    const update=fotmobReturnUpdate(123,"Early September 2026","2026-08-27T06:00:00.000Z");

    expect(update).toEqual({
      fotmob_id:123,
      fotmob_expected_return:"Early September 2026",
      fotmob_return_checked_at:"2026-08-27T06:00:00.000Z",
    });
    expect(update).not.toHaveProperty("expected_return");
  });

  it("clears stale injury fields when FotMob says the player is back in training",()=>{
    expect(fotmobConfirmsActive("Back in training")).toBe(true);
    expect(fotmobReturnUpdate(123,"Back in training","2026-08-27T06:00:00.000Z")).toMatchObject({
      injured:false,
      injury_type:null,
      injury_reason:null,
      expected_return:null,
    });
  });

  it("protects a recent FotMob clearance from a stale injury feed",()=>{
    const now=Date.parse("2026-09-03T12:00:00.000Z");
    expect(recentFotmobClearBlocksInjury(false,"2026-09-03T10:00:00.000Z",now)).toBe(true);
    expect(recentFotmobClearBlocksInjury(true,"2026-09-03T10:00:00.000Z",now)).toBe(false);
    expect(recentFotmobClearBlocksInjury(false,"2026-08-20T10:00:00.000Z",now)).toBe(false);
  });
});
