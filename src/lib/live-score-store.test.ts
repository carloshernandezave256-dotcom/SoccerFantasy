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
});
