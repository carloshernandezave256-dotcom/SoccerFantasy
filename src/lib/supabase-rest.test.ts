import {describe,expect,it,vi} from "vitest";
import {fetchAllRestRows} from "./supabase-rest";

describe("fetchAllRestRows",()=>{
  it("retrieves rows beyond Supabase's 1,000-row response limit",async()=>{
    const source=Array.from({length:1040},(_,id)=>({id}));
    const fetchMock=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
      const range=new Headers(init?.headers).get("Range")??"0-999";
      const [start,end]=range.split("-").map(Number);
      return new Response(JSON.stringify(source.slice(start,end+1)),{status:200,headers:{"Content-Type":"application/json"}});
    });

    const rows=await fetchAllRestRows<{id:number}>("https://example.test/rest",{},fetchMock as unknown as typeof fetch);

    expect(rows).toHaveLength(1040);
    expect(rows.at(-1)).toEqual({id:1039});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("Range")).toBe("1000-1999");
  });
});
