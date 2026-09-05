import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

// Runs the actual migration and baseline SQL helpers in disposable PostgreSQL.
// Deliberately does not claim to replay all migrations, RLS, cron, or concurrency.
const db=new PGlite();
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const league='10000000-0000-0000-0000-000000000001';
const user='20000000-0000-0000-0000-000000000001';
const draft='30000000-0000-0000-0000-000000000001';
const session='40000000-0000-0000-0000-000000000001';
const lot='50000000-0000-0000-0000-000000000001';
let checks=0;
const reject=async(sql,pattern)=>{await assert.rejects(db.query(sql),pattern);checks++};
try {
  await db.exec(await read('supabase/tests/market-bootstrap.sql'));
  await db.exec(await read('supabase/migrations/20260905143838_close_legacy_market_routes.sql'));
  await db.exec(`
    insert into leagues values('${league}','auction');
    insert into profiles values('${user}');
    insert into league_members values('${league}','${user}',1);
    insert into drafts values('${draft}','${league}','live',1,now()+interval '1 hour',30,now());
    insert into players values(1,true,'GK','Test Club');
    insert into auction_sessions(id,league_id,draft_id,style,status) values('${session}','${league}','${draft}','nomination','bidding');
    insert into auction_lots(id,session_id,league_id,sequence_no,player_id,closes_at) values('${lot}','${session}','${league}',1,1,now()+interval '1 hour');
    update auction_sessions set current_lot_id='${lot}';
    insert into auction_budgets values('${league}','${user}',2000000000);
    select set_config('request.jwt.claim.sub','${user}',false);
    set role authenticated;
  `);
  const bid=amount=>`select public.place_auction_bid('${league}',${amount})`;
  await reject(bid('null'),/Bid must beat/);
  await reject(bid(0),/Bid must beat/);
  await reject(bid(1500000),/Bid must beat/);
  await db.query(bid(1000000));checks++;
  await reject(bid(1000000),/Bid must beat/);
  await db.query(bid(2000000));checks++;
  await reject(bid(1984000000),/too little budget/);
  await reject(`select pickup_free_agent('${league}',1,2)`,/only available in draft leagues/);
  await reject(`select submit_waiver_claim('${league}',1,2)`,/only available in draft leagues/);
  await reject(`select make_draft_pick('${league}',1)`,/only available in draft leagues/);
  await reject(`select process_waivers('${league}')`,/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query("select to_regprocedure('public.sign_available_player(uuid,bigint,bigint)') as fn")).rows[0].fn,null);checks++;
  assert.equal(Number((await db.query('select count(*) as n from auction_bids')).rows[0].n),2);checks++;
  await db.exec(`delete from auction_budgets; set role authenticated;`);
  await reject(bid(3000000),/too little budget/);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','20000000-0000-0000-0000-000000000002',false); set role authenticated;`);
  await reject(bid(3000000),/membership required/);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${user}',false); update leagues set game_format='draft'; set role authenticated;`);
  await reject(bid(3000000),/requires an auction league/);
  // Draft league positive path still works; windowless markets stay closed.
  await db.query(`select make_draft_pick('${league}',1)`);checks++;
  await reject(`select pickup_free_agent('${league}',2,1)`,/pickups are not open/);
  await reject(`select submit_waiver_claim('${league}',2,1)`,/claims are not open/);
  await db.exec('reset role; set role anon');
  await reject(bid(3000000),/permission denied/);
  await reject(`select make_draft_pick('${league}',1)`,/permission denied/);
  console.log(`${checks} actual PostgreSQL market regression checks passed.`);
} finally { await db.close(); }
