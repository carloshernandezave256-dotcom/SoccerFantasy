import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const L='10000000-0000-0000-0000-000000000001';
const A='20000000-0000-0000-0000-000000000001',B='20000000-0000-0000-0000-000000000002',C='20000000-0000-0000-0000-000000000003';
const T='30000000-0000-0000-0000-000000000001',T2='30000000-0000-0000-0000-000000000002';
const CA='40000000-0000-0000-0000-000000000001',CB='40000000-0000-0000-0000-000000000002',CC='40000000-0000-0000-0000-000000000003';
let checks=0;
const scalar=async sql=>Object.values((await db.query(sql)).rows[0])[0];
const verify=(a,b)=>{assert.deepEqual(a,b);checks++};
const respond=(accept='true')=>db.query(`select public.respond_to_trade('${T}',${accept})`);
const rejected=async(pattern)=>{await assert.rejects(respond(),pattern);checks++};
async function seed(format='draft'){
 await db.exec(`reset role;truncate trades,trade_players,lineup_players,draft_picks,pack_cards,league_members,leagues,league_transaction_windows,players cascade;
 insert into leagues values('${L}','${format}',true);
 insert into league_members values('${L}','${A}',1),('${L}','${B}',2),('${L}','${C}',3);
 insert into players values(1,true,'GK','Club A'),(2,true,'GK','Club B'),(3,true,'GK','Club C');
 insert into draft_picks(league_id,user_id,player_id) values('${L}','${A}',1),('${L}','${B}',2);
 insert into lineup_players values('${L}','${A}',1),('${L}','${B}',2),('${L}','${C}',1);
 insert into trades values('${T}','${L}','${A}','${B}','pending',now()+interval '1 hour',null,null);
 insert into trade_players values('${T}',1,'${A}',null),('${T}',2,'${B}',null);
 select set_config('request.jwt.claim.sub','${B}',false);set role authenticated;`);
}
try{
 await db.exec(await read('supabase/tests/market-bootstrap.sql'));
 await db.exec(await read('supabase/tests/trades-bootstrap.sql'));
 await db.exec(await read('supabase/migrations/20260905224727_serialize_trade_acceptance.sql'));
 await seed();verify((await respond()).rows[0].respond_to_trade,'accepted');
 await db.exec('reset role');
 verify((await db.query('select player_id,user_id from draft_picks order by player_id')).rows,[{player_id:1,user_id:B},{player_id:2,user_id:A}]);
 verify(await scalar('select count(*)::int from lineup_players'),1);
 await rejected(/no longer pending/);
 await seed();await db.exec(`reset role;update leagues set trades_enabled=false;set role authenticated`);await rejected(/disabled/);
 verify((await respond('false')).rows[0].respond_to_trade,'declined');
 await seed();await db.exec(`reset role;delete from league_members where user_id='${A}';set role authenticated`);await rejected(/Both managers/);
 await seed();await db.exec(`reset role;update draft_picks set player_id=3 where player_id=1;set role authenticated`);await rejected(/ownership changed/);
 await db.exec('reset role');verify(await scalar('select count(*)::int from lineup_players'),3);verify(await scalar('select status from trades'),'pending');
 await seed();await db.exec(`reset role;insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',1,now()-interval '1 minute');set role authenticated`);await rejected(/Trading is locked/);
 await seed();await db.exec(`reset role;select set_config('request.jwt.claim.sub','${C}',false);set role authenticated`);await rejected(/not addressed/);
 await seed();await assert.rejects(respond('null'),/Choose accept or decline/);checks++;
 await db.exec(`reset role;select set_config('request.jwt.claim.sub','',false);set role authenticated`);await rejected(/Sign in/);
 await seed();await db.exec(`reset role;update trades set expires_at=now()-interval '1 second';set role authenticated`);verify((await respond()).rows[0].respond_to_trade,'expired');
 // Server time, not transaction start time, governs a request queued across cutoff.
 await seed();await db.exec(`reset role;begin;insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',1,clock_timestamp()+interval '30 milliseconds');select pg_sleep(0.04);set role authenticated`);
 await rejected(/Trading is locked/);await db.exec('rollback');
 // Legal existing rosters may become illegal after the exchange.
 await seed();await db.exec(`reset role;insert into players select n,true,'DEF','Club A' from generate_series(4,7) n;
 insert into draft_picks(league_id,user_id,player_id) select '${L}','${B}',n from generate_series(4,7) n;set role authenticated`);
 await rejected(/roster position or four-per-club/);
 // Conflicting second trade is cancelled after exactly one ownership exchange.
 await seed();await db.exec(`reset role;insert into trades values('${T2}','${L}','${A}','${C}','pending',now()+interval '1 hour',null,null);
 insert into trade_players values('${T2}',1,'${A}',null);set role authenticated`);await respond();await db.exec('reset role');verify(await scalar(`select status from trades where id='${T2}'`),'cancelled');
 // A trigger skips a write: exact row-count assertion rolls back ownership AND lineup cleanup.
 await seed();await db.exec(`reset role;create function private.skip_one_trade_write() returns trigger language plpgsql as $$begin if old.player_id=2 then return null;end if;return new;end$$;
 create trigger skip_one before update on draft_picks for each row execute function private.skip_one_trade_write();set role authenticated`);
 await rejected(/update incomplete/);await db.exec('reset role');verify(await scalar('select count(*)::int from lineup_players'),3);verify(await scalar('select user_id from draft_picks where player_id=1'),A);await db.exec('drop trigger skip_one on draft_picks');
 // Exact card identity: trading an inactive duplicate preserves the active lineup copy and others' cards/offers.
 await seed('pack');await db.exec(`reset role;
 insert into pack_cards values('${CA}','${L}','${A}',1,null,'pack'),('${CB}','${L}','${B}',2,1,'pack'),('${CC}','${L}','${C}',1,1,'pack'),('40000000-0000-0000-0000-000000000004','${L}','${A}',1,1,'pack');
 update trade_players set pack_card_id=case when player_id=1 then '${CA}'::uuid else '${CB}'::uuid end;
 insert into trades values('${T2}','${L}','${C}','${A}','pending',now()+interval '1 hour',null,null);
 insert into trade_players values('${T2}',1,'${C}','${CC}');set role authenticated`);
 await respond();await db.exec('reset role');
 verify((await db.query('select user_id,player_id from lineup_players order by user_id')).rows,[{user_id:A,player_id:1},{user_id:C,player_id:1}]);
 verify(await scalar(`select status from trades where id='${T2}'`),'pending');verify(await scalar(`select user_id from pack_cards where id='${CC}'`),C);
 // Inspect PostgreSQL's real lock table during the ownership update.
 await seed();await db.exec(`reset role;create function private.require_trade_mutex() returns trigger language plpgsql as $$begin
 if not exists(select 1 from pg_locks where locktype='advisory' and mode='ExclusiveLock' and granted and pid=pg_backend_pid()) then raise exception 'Missing league mutex';end if;return new;end$$;
 create trigger require_mutex before update on draft_picks for each row execute function private.require_trade_mutex();set role authenticated`);
 verify((await respond()).rows[0].respond_to_trade,'accepted');
 await db.exec('reset role;set role anon');await assert.rejects(respond(),/permission denied/);checks++;
 console.log(`${checks} actual PostgreSQL trade checks passed (single-session; multi-client races still require a release test).`);
}finally{await db.close()}
