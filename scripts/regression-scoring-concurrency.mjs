import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Requires a disposable PostgreSQL server; never point this at production.
const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL server.');
const admin=new pg.Client({connectionString:url});await admin.connect();
const name=`scoring_concurrency_${Date.now()}`;
const isolated=new URL(url);isolated.pathname=`/${name}`;
const clients=[];
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
try{
 await admin.query(`create database ${name}`);
 const make=async()=>{const c=new pg.Client({connectionString:isolated.href});await c.connect();clients.push(c);return c};
 const setup=await make();
 // Roles are cluster-wide; the harness is intended for a fresh CI service.
 await setup.query(await read('supabase/tests/market-bootstrap.sql'));
 await setup.query(await read('supabase/tests/scoring-bootstrap.sql'));
 await setup.query(await read('supabase/migrations/20260918050601_hardened_scoring_finalization.sql'));
 const L='10000000-0000-0000-0000-000000000001',U='20000000-0000-0000-0000-000000000001';
 await setup.query(`select set_config('request.jwt.claim.role','service_role',false);
 insert into leagues values('${L}','draft','Premier League','Premier League');
 insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',4,date_trunc('week',now())-interval '9 days');
 insert into league_headline_fixtures values('${L}',1,'Premier League',4,date_trunc('week',now())-interval '9 days','FT');
 insert into players values(100,true,'GK','A'),(101,true,'GK','A');
 insert into lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order,bench_order)
 values('${L}','${U}',100,true,true,1,null),('${L}','${U}',101,false,false,null,1);`);
 const stamp=new Date().toISOString();
 await setup.query('insert into football_fixture_player_stats values(1,101,$1)',[stamp]);
 await setup.query('select public.record_fixture_stat_evidence(1,$1,true,$2,$3)',[stamp,'Both squads reconciled',[101]]);
 const proof=(await setup.query('select * from public.scoring_week_fixtures($1,4::smallint)',[L])).rows;
 const rows=[{league_id:L,gameweek:4,player_id:100,minutes:0,fantasy_points:0,status:'final',data_complete:true,source_updated_at:stamp},
 {league_id:L,gameweek:4,player_id:101,minutes:90,fantasy_points:8,status:'final',data_complete:true,source_updated_at:stamp}];
 const a=await make(),b=await make();
 for(const c of[a,b])await c.query("select set_config('request.jwt.claim.role','service_role',false);set statement_timeout='10s'");
 const sql='select public.publish_gameweek_scores($1,4::smallint,$2,$3) as published';
 const args=[L,JSON.stringify(rows),JSON.stringify(proof)];
 await a.query('begin');
 assert.equal((await a.query(sql,args)).rows[0].published,2);
 const pid=(await b.query('select pg_backend_pid() as pid')).rows[0].pid;
 const second=b.query(sql,args);
 // Observe a real lock wait on connection B while A's settlement is uncommitted.
 let waiting=false;
 for(let i=0;i<100;i++){
  const state=(await setup.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(state?.wait_event_type==='Lock'){waiting=true;break}
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(waiting,true,'Second connection must wait for first settlement transaction');
 await a.query('commit');
 assert.equal((await second).rows[0].published,0,'Replay must not publish a second time');
 const count=async table=>Number((await setup.query(`select count(*) as n from ${table}`)).rows[0].n);
 assert.equal(await count('finalized_gameweek_locks'),1);
 assert.equal(await count('lineup_gameweek_substitutions'),1);
 assert.deepEqual((await setup.query('select player_id,is_starter,is_star_pick from lineup_gameweek_players order by player_id')).rows,
 [{player_id:'100',is_starter:false,is_star_pick:false},{player_id:'101',is_starter:true,is_star_pick:false}]);
 console.log('PASS: two real PostgreSQL connections overlap publication/settlement; one finalization and substitution, captain not transferred.');
}finally{
 for(const c of clients)await c.end();
 await admin.query(`drop database if exists ${name} with (force)`);
 await admin.end();
}
