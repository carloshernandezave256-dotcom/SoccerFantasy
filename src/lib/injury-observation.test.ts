import { describe, expect, it } from "vitest";
import { appearanceDisprovesInjury, injuryObservedAt } from "./injury-observation";

const existing = {
  injured: true,
  injury_type: "Questionable",
  injury_reason: "Hamstring",
  injury_updated_at: "2026-08-20T10:00:00.000Z",
  availability_last_appearance_at: null,
};

describe("injury observations", () => {
  it("preserves the first observation time while the provider status is unchanged", () => {
    expect(injuryObservedAt(existing, "Questionable", "Hamstring", "2026-08-29T10:00:00.000Z"))
      .toBe("2026-08-20T10:00:00.000Z");
  });

  it("timestamps a changed injury as a new observation", () => {
    expect(injuryObservedAt(existing, "Missing Fixture", "Knee", "2026-08-29T10:00:00.000Z"))
      .toBe("2026-08-29T10:00:00.000Z");
  });

  it("keeps a cleared provider flag cleared after a later appearance", () => {
    expect(appearanceDisprovesInjury({
      ...existing,
      injured: false,
      availability_last_appearance_at: "2026-08-29T14:00:00.000Z",
    }, "Questionable", "Hamstring")).toBe(true);
  });

  it("does not suppress an injury first observed after the appearance", () => {
    expect(appearanceDisprovesInjury({
      ...existing,
      injured: false,
      injury_updated_at: "2026-08-29T15:00:00.000Z",
      availability_last_appearance_at: "2026-08-29T14:00:00.000Z",
    }, "Questionable", "Hamstring")).toBe(false);
  });
});
