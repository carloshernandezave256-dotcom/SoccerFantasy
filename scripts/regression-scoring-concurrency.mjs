import pg from 'pg';
import assert from 'node:assert/strict';
import {initializeRolloverDatabase,seedRolloverLeague,certifyFixture} from './regression-rollover-db.mjs';

// Requires a disposable PostgreSQL server with CREATEDB; never target production.
// CI supplies a fresh PostgreSQL 16 service. PGlite cannot prove lock overlap.
const url=process.env.TEST_DATABASE_URL;
if(!url) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL server.');
const admin=new pg.Client({connectionString:url});
await admin.connect();
const name=`scoring_concurrency_${Date.now()}`;
const isolated=new URL(url);
isolated.pathname=`/${name}`;
const clients=[];
try {
  await admin.query(`create database ${name}`);
  const make=async()=>{
    const client=new pg.Client({connectionString:isolated.href});
    await client.connect();clients.push(client);return client;
  };
  const setup=await make();
  await initializeRolloverDatabase(sql=>setup.query(sql));
  const scenario=await seedRolloverLeague((sql,args)=>setup.query(sql,args),1,{delayed:true});
  const query=(sql,args)=>setup.query(sql,args);
  for(const fixture of scenario.fixtureIds) await certifyFixture(query,fixture,scenario.stamp,scenario.base+12);
  const proof=(await query('select * from public.scoring_week_fixtures($1,1::smallint)',[scenario.league])).rows;
  const a=await make(), b=await make();
  for(const client of [a,b]) await client.query("select set_config('request.jwt.claim.role','service_role',false);set statement_timeout='15s'");
  const sql='select public.publish_gameweek_scores($1,1::smallint,$2,$3) as published';
  const args=[scenario.league,JSON.stringify(scenario.rows),JSON.stringify(proof)];
  const count=async(table,week=1)=>Number((await query(`select count(*) as n from ${table} where league_id=$1 and gameweek=$2`,[scenario.league,week])).rows[0].n);
  await a.query('begin');
  assert.equal((await a.query(sql,args)).rows[0].published,18);
  // The whole archive and new market are atomic: none is visible before commit.
  for(const table of ['finalized_gameweek_locks','finalized_gameweek_audit','lineup_gameweek_substitutions']) {
    assert.equal(await count(table),0,`${table} must remain invisible before commit`);
  }
  assert.equal(await count('league_transaction_windows',2),0,'Next window must not become visible early');
  assert.equal(await count('league_player_scores',2),0,'Next-week zero rows must not become visible early');
  const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
  const second=b.query(sql,args);
  let waiting=false;
  for(let attempt=0;attempt<100;attempt++) {
    const state=(await query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
    if(state?.wait_event_type==='Lock') {waiting=true;break;}
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(waiting,true,'Second connection must wait for first complete settlement/rollover transaction');
  await a.query('commit');
  assert.equal((await second).rows[0].published,0,'Overlapping publisher becomes an idempotent replay');
  assert.equal(await count('finalized_gameweek_locks'),1);
  assert.equal(await count('finalized_gameweek_audit'),1);
  assert.equal(await count('lineup_gameweek_substitutions'),4);
  assert.equal(await count('league_transaction_windows',2),1);
  assert.equal(await count('league_transaction_windows',3),0,'Delayed concurrent settlement cannot skip a round');
  assert.equal(await count('league_player_scores',2),18);
  const lock=(await query('select snapshot from finalized_gameweek_locks where league_id=$1',[scenario.league])).rows[0].snapshot;
  assert.equal(lock.scores.length,18);
  assert.equal(lock.substitutions.length,4);
  assert.equal(Number(lock.matchups[0].home_score),68);
  assert.equal(lock.lineups.filter(row=>row.is_star_pick).length,0,'Substitute does not inherit captain');
  assert.equal(lock.lineups.filter(row=>row.is_starter).length,11);
  const window=(await query('select * from league_transaction_windows where league_id=$1 and gameweek=2',[scenario.league])).rows[0];
  assert.notEqual(window.priority_randomized_at,null);
  const priorities=(await query('select waiver_priority from league_members where league_id=$1 order by waiver_priority',[scenario.league])).rows;
  assert.deepEqual(priorities,[{waiver_priority:1},{waiver_priority:2}]);
  assert.equal((await b.query(sql,args)).rows[0].published,0,'Additional replay stays a no-op');
  assert.deepEqual((await query('select * from league_transaction_windows where league_id=$1 and gameweek=2',[scenario.league])).rows[0],window,'Replay preserves deadlines and one-time randomization');
  assert.deepEqual((await query('select snapshot from finalized_gameweek_locks where league_id=$1',[scenario.league])).rows[0].snapshot,lock,'Replay preserves exact archive');
  console.log('PASS: two real PostgreSQL connections overlap actual settlement, archive and rollover; atomic visibility, one lock/audit/window, four same-position subs, unchanged deadlines, no skipped delayed round.');
} finally {
  // Roll back an open assertion-failure transaction before ending clients so a
  // waiting publisher cannot delay cleanup until its statement timeout expires.
  await Promise.all(clients.map(client=>client.query('rollback').catch(()=>{})));
  await Promise.all(clients.map(client=>client.end()));
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}
