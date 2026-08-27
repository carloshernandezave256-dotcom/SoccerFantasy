import {describe,expect,it} from "vitest";
import {returnEstimateLabel} from "./return-estimate";

describe("returnEstimateLabel",()=>{
  it.each([
    "Early September 2026",
    "About a week",
    "Doubtful",
    "Back in training",
  ])("preserves the FotMob estimate %s",estimate=>{
    expect(returnEstimateLabel(estimate)).toBe(estimate);
  });

  it("never renders an invalid exact date",()=>{
    expect(returnEstimateLabel("2026-09-03")).not.toBe("Invalid Date");
  });
});
