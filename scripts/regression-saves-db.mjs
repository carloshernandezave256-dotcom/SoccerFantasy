import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const read=p=>readFile(new URL(`../${p}`,import.meta.url),'utf8');
const fn=async(file,name)=>{
 const sql=await read(`supabase/migrations/${file}`);
 const start=sql.indexOf(`create or replace function private.${name}(`);
 assert.ok(start>=0,name);
 const tail=sql.slice(start),tag=tail.match(/\bas\s+(\$[a-z_]*\$)/i)[1];
 const end=tail.indexOf(tag,tail.indexOf(tag)+tag.length)+tag.length;
 await db.exec(tail.slice(0,end)+';');
};
const scalar=async sql=>Object.values((await db.query(sql)).rows[0])[0];
const L='10000000-0000-0000-0000-000000000001',A='20000000-0000-0000-0000-000000000001',B='20000000-0000-0000-0000-000000000002';
try{
 await db.exec(await read('supabase/tests/rollover-bootstrap.sql'));
 await db.exec(await read('supabase/migrations/20260829010000_protect_finalized_gameweeks.sql'));
 await db.exec(`drop table football_fixture_player_stats;
 create table football_fixture_player_stats as select * from league_player_scores limit 0;
 alter table football_fixture_player_stats add column fixture_id bigint;`);
 await fn('20260823170717_remove_man_of_the_match.sql','calculate_fantasy_score');
 await fn('20260918090000_sportmonks_scoring_sources.sql','calculate_fixture_player_row');
 await fn('20260828215000_support_multi_fixture_gameweeks.sql','calculate_league_player_row');
 await fn('20260822233000_round_captain_scores_down.sql','manager_gameweek_score');
 await db.exec(`create trigger calculate_fixture_player_score before insert or update on football_fixture_player_stats for each row execute function private.calculate_fixture_player_row();
 create trigger calculate_league_player_score before insert or update on league_player_scores for each row execute function private.calculate_league_player_row();
 insert into leagues values('${L}','draft','Premier League','All Top Five',0);
 insert into auth.users values('${A}'),('${B}');
 insert into players values(1,true,'GK','Milan','Serie A'),(2,true,'DEF','Other','Serie A'),(3,true,'GK','Other','Serie A');
 insert into football_fixture_cache(fixture_id,status) values(10,'FT');
 insert into football_fixture_player_stats(fixture_id,player_id,minutes,saves,completed_passes,goals_conceded) values(10,1,90,5,23,0);
 insert into league_player_scores(league_id,gameweek,player_id,status,minutes,saves,completed_passes,goals_conceded) values('${L}',8,1,'final',90,5,23,0),('${L}',8,2,'final',90,0,23,0);
 insert into lineup_gameweek_players(league_id,gameweek,user_id,player_id,is_starter,is_star_pick) values('${L}',8,'${A}',1,true,true),('${L}',8,'${B}',2,true,false);
 insert into league_matchups(league_id,gameweek,home_user_id,away_user_id,home_score,away_score,status) values('${L}',8,'${A}','${B}',12,7,'final');
 -- Two matches, five saves each: two independent entries, not ten saves rounded together.
 insert into league_player_scores(league_id,gameweek,player_id,source,calculator_version,saves,fantasy_points,score_ledger)
 values('${L}',7,3,'api-football-fixture-sum','fixture-sum-v1',10,2,'[{"code":"saves","detail":"5 saves · 1 FP for every 3","points":1},{"code":"saves","detail":"5 saves · 1 FP for every 3","points":1}]');
 select private.lock_finalized_gameweek('${L}',8::smallint);`);
 assert.equal(Number(await scalar('select fantasy_points from football_fixture_player_stats')),8);
 const migration=await read('supabase/migrations/20261028141342_goalkeeper_save_threshold.sql');
 await db.exec('begin;'+migration+'commit;');
 assert.equal(Number(await scalar('select fantasy_points from football_fixture_player_stats')),9);
 assert.equal(Number(await scalar('select fantasy_points from league_player_scores where player_id=1')),9);
 assert.equal(Number(await scalar('select fantasy_points from league_player_scores where player_id=2')),7);
 assert.equal(Number(await scalar('select fantasy_points from league_player_scores where player_id=3')),4);
 assert.equal(Number(await scalar('select home_score from league_matchups')),13);
 assert.equal(Number(await scalar("select (snapshot->'scores'->0->>'fantasy_points')::numeric from finalized_gameweek_locks")),9);
 assert.equal(Number(await scalar("select count(*) from finalized_gameweek_audit where action='relocked'")),1);
 await assert.rejects(db.exec("update league_player_scores set saves=7 where player_id=1"),/finalized and locked/);
 for(let saves=0;saves<=20;saves++){
  const result=await scalar(`select private.calculate_fantasy_score('GK',90,0,0,0,0,0,0,0,0,${saves},0,1,0,0,0,0,false,true)`);
  assert.equal(Number(result.total),2+Math.max(0,Math.floor((saves-1)/2)));
 }
 await db.exec('begin;'+migration+'commit;');
 assert.equal(Number(await scalar('select fantasy_points from league_player_scores where player_id=3')),4);
 assert.equal(Number(await scalar('select home_score from league_matchups')),13);
 console.log('Save scoring database: thresholds, fixture totals, multi-match rounding, captain totals, audit, snapshots, locks and idempotence passed.');
}catch(error){console.error(error.message,error.query??'');process.exitCode=1}finally{await db.close()}
