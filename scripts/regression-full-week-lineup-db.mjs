import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Load production SQL, not a duplicate implementation. All data is synthetic.
const migration='20261108045705_full_week_lineup_exceptions.sql';
const migrations=new URL('../supabase/migrations/',import.meta.url);
const readMigration=name=>readFile(new URL(name,migrations),'utf8');
async function loadLatestPriorFunction(name) {
  let definition;
  for(const file of (await readdir(migrations)).filter(f=>f.endsWith('.sql')&&f<migration).sort()) {
    const source=await readMigration(file);
    const pattern=new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.'+name+'\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;','ig');
    for(const match of source.matchAll(pattern)) definition=match[0];
  }
  assert.ok(definition,`Missing previous production function ${name}`);
  await exec(definition);
}

const db=new PGlite();const exec=s=>db.exec(s);const q=async s=>(await db.query(s)).rows;
const league='10000000-0000-0000-0000-000000000010', other='00000000-0000-0000-0000-000000000002',user='00000000-0000-0000-0000-000000000001';
await exec(`create schema private; create schema auth; create role anon; create role authenticated;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table leagues(id uuid primary key,game_format text default 'draft');
create table league_members(league_id uuid,user_id uuid);
create table league_transaction_windows(league_id uuid,gameweek integer,roster_lock_at timestamptz);
create table finalized_gameweek_locks(league_id uuid,gameweek integer);
create table players(id bigint primary key, competition text,club text,full_name text,position text,injured boolean default false);
create table football_fixture_cache(fixture_id bigint,competition text,home_team text,away_team text,kickoff timestamptz,status text);
create table private.gameweek_fixture_members(league_id uuid,gameweek integer,fixture_id bigint,original_kickoff timestamptz);
create table lineup_players(league_id uuid,user_id uuid,player_id bigint,is_starter boolean,is_captain boolean,pitch_order integer,bench_order integer,updated_at timestamptz,unique(league_id,user_id,player_id));
create table lineup_gameweek_players(league_id uuid,gameweek integer,user_id uuid,player_id bigint,is_starter boolean,is_star_pick boolean,pitch_order integer,bench_order integer,captured_at timestamptz);
create table draft_picks(league_id uuid,user_id uuid,player_id bigint);
create table pack_cards(league_id uuid,user_id uuid,player_id bigint,active_slot integer);
create function private.lineup_changes_locked(uuid) returns boolean language sql stable as $$select true$$;`);
for(const f of ['20260918205205_one_week_lineup_exception.sql','20260918210641_expose_player_kickoff_locks.sql'])await exec(await readMigration(f));
await exec(`insert into leagues(id) values('${league}'),('${other}'); insert into league_members values('${league}','${user}'),('${other}','${user}');
insert into league_transaction_windows values('${league}',10,now()-interval '3 days'),('${other}',10,now()-interval '3 days');
insert into private.lineup_edit_exceptions values('${league}',10,'infinity'),('${other}',10,'infinity');
insert into football_fixture_cache values(1,'test','A','B',now()-interval '1 day','FT');
insert into private.gameweek_fixture_members values('${league}',10,1,now()-interval '1 day'),('${other}',10,1,now()-interval '1 day');
select set_config('request.jwt.claim.sub','${user}',false);`);
for(let i=1;i<=12;i++)await exec(`insert into players(id,competition,club,full_name,position) values(${i},'test','A','Player ${i}','${i===1?'GK':i<=5?'DEF':i<=8?'MID':'FWD'}');insert into draft_picks values('${league}','${user}',${i}); insert into lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order,bench_order) values('${league}','${user}',${i},${i<=11},${i===1},${i<=11?i:'null'},${i===12?1:'null'}); insert into lineup_gameweek_players select league_id,10,user_id,player_id,is_starter,is_captain,pitch_order,bench_order,now() from lineup_players where player_id=${i};`);
await exec(`create table league_matchups(league_id uuid,gameweek integer);create table league_player_scores(league_id uuid,gameweek integer);`);
const before=await q('select * from lineup_gameweek_players order by player_id');
await loadLatestPriorFunction('initialize_default_lineup');
await loadLatestPriorFunction('save_partial_pitch_order');
const aclQuery=`select oid,proacl,proowner,prosecdef,proconfig from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) order by oid`;
const originalSecurity=await q(aclQuery);
await exec(await readMigration(migration));
// Manual emergency application followed by tracked migration must be replayable.
await exec(await readMigration(migration));
assert.deepEqual(await q(aclQuery),originalSecurity,'function ACL, owner and security properties preserved');
assert.equal((await q(`select count(*)::int n from private.lineup_edit_exceptions where allow_started_players`))[0].n,0,'feature defaults off');
assert.equal((await q(`select private.exception_player_locked('${league}',10::smallint,1) locked`))[0].locked,true,'default rolling retained');
await exec(`update private.lineup_edit_exceptions set allow_started_players=true where league_id='${league}' and gameweek=10`);
assert.deepEqual(await q('select * from lineup_gameweek_players order by player_id'),before,'activation changes no lineups');
assert.equal((await q(`select private.exception_player_locked('${league}',10::smallint,1) locked`))[0].locked,false);
assert.equal((await q(`select private.exception_player_locked('${league}',9::smallint,1) locked`))[0].locked,true);
assert.equal((await q(`select private.exception_player_locked('${league}',11::smallint,1) locked`))[0].locked,true);
assert.equal((await q(`select private.exception_player_locked('${other}',10::smallint,1) locked`))[0].locked,true);
const locks=await q(`select * from lineup_player_lock_state('${league}')`);assert.equal(locks.length,12);
for(const row of locks){assert.equal(row.locked,false);assert.equal(row.rolling,false);assert.equal(row.locks_at,null);assert.equal(row.locked||Boolean(row.rolling&&row.locks_at&&new Date(row.locks_at)<=Date.now()),false);}
const lock=(await q(`select * from lineup_lock_state('${league}')`))[0];assert.equal(lock.locked,false);assert.equal(lock.locks_at,null);
await exec('begin');
await exec(`select set_lineup_captain('${league}',2); select save_pitch_order('${league}',array[1,3,2,4,5,6,7,8,9,10,11]::bigint[]);select save_lineup('${league}',array[1,3,2,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[],2)`);
assert.equal((await q('select player_id from lineup_gameweek_players where is_star_pick'))[0].player_id,2);
assert.equal((await q('select pitch_order from lineup_gameweek_players where player_id=3'))[0].pitch_order,2);
await exec('rollback');assert.deepEqual(await q('select * from lineup_gameweek_players order by player_id'),before);
for(const mutation of [`update private.lineup_edit_exceptions set expires_at=now()-interval '1 second' where league_id='${league}'`,`insert into finalized_gameweek_locks values('${league}',10)`,`insert into league_transaction_windows values('${league}',11,now()+interval '5 days')`,`update league_transaction_windows set roster_lock_at=now()+interval '1 day' where league_id='${league}'`]){await exec('begin');await exec(mutation);assert.equal((await q(`select private.lineup_exception_week('${league}') w`))[0].w,null);assert.equal((await q(`select private.exception_player_locked('${league}',10::smallint,1) locked`))[0].locked,true);await exec('rollback');}
await exec('begin');
await exec(`update lineup_players set is_starter=false,bench_order=2,pitch_order=null where player_id=11`);
const incompleteBefore=await q('select * from lineup_players order by player_id');
const incompleteSnapshot=await q('select * from lineup_gameweek_players order by player_id');
assert.equal((await q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[]) ok`))[0].ok,false);
assert.deepEqual(await q('select * from lineup_players order by player_id'),incompleteBefore);
assert.deepEqual(await q('select * from lineup_gameweek_players order by player_id'),incompleteSnapshot);
await exec(`select save_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[],1)`);
assert.equal((await q('select count(*)::int n from lineup_gameweek_players where is_starter'))[0].n,11);
assert.equal((await q('select player_id from lineup_gameweek_players where is_star_pick'))[0].player_id,1);
await exec('rollback');
await exec('begin');await exec('delete from lineup_players');
assert.equal((await q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[]) ok`))[0].ok,true);
assert.equal((await q('select count(*)::int n from lineup_gameweek_players where is_starter'))[0].n,11);
await exec('rollback');
await exec('begin');
await exec(`update lineup_players set is_starter=false,bench_order=2,pitch_order=null where player_id=11;select save_partial_pitch_order('${league}',array[2,1,3,4,5,6,7,8,9,10]::bigint[])`);
assert.equal((await q('select count(*)::int n from lineup_gameweek_players where is_starter'))[0].n,10);
assert.equal((await q('select pitch_order from lineup_gameweek_players where player_id=2'))[0].pitch_order,1);
await exec('rollback');
assert.deepEqual(await q('select * from lineup_gameweek_players order by player_id'),before);
await exec('begin');await exec('delete from lineup_players');await exec("update players set position='GK' where id=12");await exec('savepoint invalid');
await assert.rejects(()=>q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,12]::bigint[],array[11]::bigint[])`),/4-3-3/);await exec('rollback to invalid');
await exec('update players set injured=true where id=2');await exec('savepoint injured');
await assert.rejects(()=>q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[])`),/unavailable/);await exec('rollback');
await exec('begin');await exec('delete from lineup_players;delete from draft_picks where player_id=12');await exec('savepoint ownership');
await assert.rejects(()=>q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[])`),/active squad/);await exec('rollback');
await assert.rejects(()=>q(`select save_partial_pitch_order('${league}',array[999]::bigint[])`),/active roster/);
await assert.rejects(()=>q(`select save_partial_pitch_order('${league}',array[1,1]::bigint[])`),/unique players/);
await assert.rejects(()=>q(`select save_partial_pitch_order('${other}',array[1]::bigint[])`),/locked/);
await assert.rejects(()=>q(`select initialize_default_lineup('${other}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[])`),/locked/);
for(const mutation of [`update private.lineup_edit_exceptions set allow_started_players=false where league_id='${league}'`,`insert into finalized_gameweek_locks values('${league}',10)`,`insert into league_transaction_windows values('${league}',11,now()+interval '5 days')`]){
 await exec('begin');await exec(mutation);await exec('savepoint test');
 await assert.rejects(()=>q(`select save_partial_pitch_order('${league}',array[1]::bigint[])`),/locked/);await exec('rollback to test');
 await assert.rejects(()=>q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[])`),/locked/);await exec('rollback');
}
await exec('begin');
await exec(`insert into league_transaction_windows values('${league}',11,now()+interval '5 days'); create or replace function private.lineup_changes_locked(uuid) returns boolean language sql stable as $$select false$$;update lineup_players set is_starter=false where player_id=11`);
assert.equal((await q(`select initialize_default_lineup('${league}',array[1,2,3,4,5,6,7,8,9,10,11]::bigint[],array[12]::bigint[]) ok`))[0].ok,true,'normal future week retains initializer behavior');
await exec('rollback');
console.log('PASS: incomplete initializer preserves all choices; manual save completes 11; empty initializer synchronizes; partial pitch sync; rollback; ownership/duplicate validation; unflagged, finalized, future-week restrictions preserved.');
await exec(`select set_config('request.jwt.claim.sub','',false)`);
await assert.rejects(()=>q(`select * from lineup_player_lock_state('${league}')`),/membership/);
await assert.rejects(()=>q(`select * from lineup_lock_state('${league}')`),/membership/);
console.log('PASS: default rolling; exact league/week; started players; RPC/client lock semantics; mutation synchronization+rollback; expiry/finalization/next-week/pre-window guards; membership.');await db.close();
