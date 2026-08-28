import {describe,expect,it} from "vitest";
import {isApiFootballUnavailable} from "./player-unavailability";

describe("isApiFootballUnavailable",()=>{
  it("does not treat match-fitness recovery as an injury",()=>{
    expect(isApiFootballUnavailable("Missing Fixture","Lacking Match Fitness")).toBe(false);
  });

  it("keeps injuries and suspensions unavailable",()=>{
    expect(isApiFootballUnavailable("Missing Fixture","Muscle Injury")).toBe(true);
    expect(isApiFootballUnavailable("Suspension","Red Card")).toBe(true);
  });
});
