import {afterEach,expect,it,vi} from 'vitest';
import {createExpiringRequestCache} from './expiring-request-cache';
afterEach(()=>vi.useRealTimers());
it('shares reads within one league but isolates other leagues',async()=>{
  const cache=createExpiringRequestCache<string>(1000),fetch=vi.fn(async()=>'fixtures');
  const first=cache.load('league-a',fetch);
  expect(cache.load('league-a',fetch)).toBe(first);
  await cache.load('league-b',fetch);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('retries a failed request immediately',async()=>{
  const cache=createExpiringRequestCache<string>(1000);
  await expect(cache.load('a',async()=>{throw Error('offline')})).rejects.toThrow('offline');
  await expect(cache.load('a',async()=>'recovered')).resolves.toBe('recovered');
});
it('refreshes after expiry and session invalidation',async()=>{
  vi.useFakeTimers();
  const cache=createExpiringRequestCache<number>(1000),fetch=vi.fn(async()=>1);
  await cache.load('a',fetch);
  vi.advanceTimersByTime(1001);
  await cache.load('a',fetch);
  cache.clear();
  await cache.load('a',fetch);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('an old rejection cannot evict a newer session request',async()=>{
  const cache=createExpiringRequestCache<number>(1000);
  let reject!:(error:Error)=>void;
  const old=cache.load('a',()=>new Promise((_,r)=>{reject=r}));
  await Promise.resolve();
  cache.clear();
  const current=cache.load('a',async()=>2);
  reject(Error('old request'));
  await expect(old).rejects.toThrow('old request');
  expect(cache.load('a',async()=>3)).toBe(current);
});
