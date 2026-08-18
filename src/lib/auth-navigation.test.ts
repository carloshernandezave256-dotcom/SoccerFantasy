import { describe, expect, it } from "vitest";
import { loginPathFor } from "./auth-navigation";

describe("authenticated page navigation", () => {
  it("returns signed-out managers to the exact My Team league URL after login", () => {
    expect(loginPathFor("/team", "?league=league-123")).toBe(
      "/login?next=%2Fteam%3Fleague%3Dleague-123",
    );
  });

  it("preserves the selected Auction League through login", () => {
    expect(loginPathFor("/auction", "?league=auction-456")).toBe(
      "/login?next=%2Fauction%3Fleague%3Dauction-456",
    );
  });
});
