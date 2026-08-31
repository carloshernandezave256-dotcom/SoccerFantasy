import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveScoreStore } from "./live-score-store";

describe("LiveScoreStore player mappings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves fixture-feed aliases through the protected database function", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([
      { id: 3596, api_football_id: 527943 },
    ]), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new LiveScoreStore("https://example.test", "service-role-key");
    await expect(store.playerMappings([527943])).resolves.toEqual([
      { id: 3596, api_football_id: 527943 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/rest/v1/rpc/resolve_api_football_player_mappings",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_api_ids: [527943] }),
      }),
    );
  });

  it("stores appearance-confirmed clubs through the protected database function", async () => {
    const fetchMock = vi.fn(async () => new Response("1", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const store = new LiveScoreStore("https://example.test", "service-role-key");
    const appearances = [{
      fixture_id: 1557384,
      player_id: 3013,
      club: "Manchester United",
      competition: "Premier League",
      kickoff: "2026-08-30T15:30:00Z",
      observed_at: "2026-08-31T14:30:00Z",
    }];
    await expect(store.reconcilePlayerClubs(appearances)).resolves.toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/rest/v1/rpc/reconcile_player_clubs_from_appearances",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ p_appearances: appearances }),
      }),
    );
  });
});
