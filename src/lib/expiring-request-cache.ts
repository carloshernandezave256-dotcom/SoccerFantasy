/** Shares in-flight reads; failed requests are immediately retryable. */
export function createExpiringRequestCache<T>(ttlMs:number){
  const entries=new Map<string,{expiresAt:number;promise:Promise<T>}>();
  return {
    clear(){entries.clear()},
    load(key:string,fetcher:()=>Promise<T>):Promise<T>{
      const now=Date.now();
      for(const [key,entry] of entries)if(entry.expiresAt<=now)entries.delete(key);
      const cached=entries.get(key);
      if(cached)return cached.promise;
      const promise=Promise.resolve().then(fetcher).catch(error=>{
        if(entries.get(key)?.promise===promise)entries.delete(key);
        throw error;
      });
      entries.set(key,{expiresAt:now+ttlMs,promise});
      return promise;
    },
  };
}
