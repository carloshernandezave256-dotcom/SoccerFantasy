import { describe, expect, it } from "vitest";
import { LEGAL_DISCLOSURE_VERSION, requiresLegalDisclosure } from "./legal-disclosure";

describe("legal disclosure version gate", () => {
  it("blocks an account that has never accepted", () => {
    expect(requiresLegalDisclosure(null, null)).toBe(true);
  });

  it("allows an account that accepted the current version", () => {
    expect(requiresLegalDisclosure(LEGAL_DISCLOSURE_VERSION, "2026-08-19T22:00:00Z")).toBe(false);
  });

  it("prompts once again after the disclosure version changes", () => {
    expect(requiresLegalDisclosure("beta-0.9", "2026-08-18T22:00:00Z")).toBe(true);
  });
});
