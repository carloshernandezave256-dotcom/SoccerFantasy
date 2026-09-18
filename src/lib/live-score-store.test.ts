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
  it("includes pending historical and current windows, excluding settled ones", async () => {
    const windows = [2, 3, 4].map(gameweek => ({gameweek, roster_lock_at: '2026-09-18T19:00Z'}));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const data = url.includes('finalized_gameweek_locks') ? [{gameweek:2}]
        : url.includes('league_transaction_windows') ? windows
        : [{calendar_competition:'Premier League',player_pool:'All Top Five'}];
      return new Response(JSON.stringify(data), {status:200});
    }));
    const contexts = await new LiveScoreStore('https://example.test','test-key').scoringLeagueContexts('league');
    expect(contexts.map(context => context.window.gameweek)).toEqual([3,4]);
  });

});

it.each(['snake','pack'])('includes owned players missing from both first snapshot and editable lineup (%s)',async(format)=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
  const data=url.includes('/leagues?')?[{game_format:format}]
   :url.includes('/lineup_players?')?[{player_id:1}]
   :url.includes('/lineup_gameweek_players?')?[]
   :url.includes(format==='pack'?'/pack_cards?':'/draft_picks?')?[{player_id:1},{player_id:99}]:[];
  if(format==='pack'&&url.includes('/pack_cards?'))expect(url).toContain('active_slot=not.is.null');
  return new Response(JSON.stringify(data));
 }));
 try{expect(await new LiveScoreStore('https://example.test','test').lineupPlayerIds('league',5)).toEqual([1,99]);}
 finally{vi.unstubAllGlobals();}
});
