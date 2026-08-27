import {describe,expect,it} from "vitest";
import {fotmobReturnUpdate} from "./fotmob-return-update";

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
});
