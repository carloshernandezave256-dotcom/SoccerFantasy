import { describe, expect, it } from "vitest";
import { completedPassesFromApi } from "./api-football-stats";

describe("API-Football passing statistics", () => {
  it("uses the accuracy field as the accurate-pass count", () => {
    expect(completedPassesFromApi(16, 13)).toBe(13);
    expect(completedPassesFromApi(16, "13")).toBe(13);
  });

  it("accepts an explicitly percent-formatted value", () => {
    expect(completedPassesFromApi(20, "80%")).toBe(16);
  });
});
