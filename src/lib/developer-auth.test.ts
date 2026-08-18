import { describe, expect, it } from "vitest";
import { isDeveloperEmail } from "./developer-auth";

describe("developer authorization", () => {
  it("allows only the configured owner email", () => {
    expect(isDeveloperEmail("carloshernandezave256@gmail.com")).toBe(true);
    expect(isDeveloperEmail("CARLOSHERNANDEZAVE256@GMAIL.COM")).toBe(true);
    expect(isDeveloperEmail("another-commissioner@gmail.com")).toBe(false);
    expect(isDeveloperEmail(null)).toBe(false);
  });
});
