import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  range: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

import { loadPlayerSeasonTotals } from "./player-season-totals";

describe("loadPlayerSeasonTotals", () => {
  beforeEach(() => {
    mocks.range.mockReset();
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(() => ({ range: mocks.range }));
  });

  it("loads every page instead of stopping at Supabase's 1,000-row limit", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({ player_id: index + 1 }));
    const secondPage = [{ player_id: 1001 }, { player_id: 1002 }];
    mocks.range
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });

    const result = await loadPlayerSeasonTotals();

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1002);
    expect(mocks.range).toHaveBeenNthCalledWith(1, 0, 999);
    expect(mocks.range).toHaveBeenNthCalledWith(2, 1000, 1999);
  });
});
