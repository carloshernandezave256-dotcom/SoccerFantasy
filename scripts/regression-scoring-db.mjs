import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
const read=path=>readFile(new URL(`../${path}`,import.meta.url),'utf8');
const L='10000000-0000-0000-0000-000000000001',U='20000000-0000-0000-0000-000000000001';
let checks=0;
const query=(sql,args)=>db.query(sql,args);
const scalar=async(sql,args)=>Object.values((await query(sql,args)).rows[0])[0];
const verify=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
try{
 await db.exec(await read('supabase/tests/market-bootstrap.sql'));
 await db.exec(await read('supabase/tests/scoring-bootstrap.sql'));
 await db.exec(await read('supabase/migrations/20260918050601_hardened_scoring_finalization.sql'));
 await db.exec(await read('supabase/migrations/20260918055758_isolate_late_week_settlement.sql'));
 await db.exec(await read('supabase/migrations/20260918094000_batch_scoring_settlement.sql'));
 await db.exec(await read('supabase/migrations/20260918095000_refresh_complete_dnp_evidence.sql'));
 await db.exec(await read('supabase/migrations/20260918161018_bench_priority_autosubs.sql'));
 await db.exec(`create trigger apply_final_score_auto_substitutions after insert or update of status,minutes,fantasy_points on public.league_player_scores for each row execute function private.apply_final_score_auto_substitutions();`);
 await db.exec(`select set_config('request.jwt.claim.role','service_role',false);
 insert into leagues values('${L}','draft','Premier League','All Top Five');
 insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',2,date_trunc('day',now())-interval '1 day');
 insert into league_headline_fixtures values
 ('${L}',1,'Premier League',2,date_trunc('day',now())-interval '1 day','FT'),
 ('${L}',2,'La Liga',3,date_trunc('day',now())-interval '1 day','FT'),
 ('${L}',3,'La Liga',1,date_trunc('day',now()),'FT'),
 ('${L}',4,'La Liga',1,date_trunc('day',now())-interval '14 days','FT'),
 ('${L}',20,'Serie A',1,now()+interval '14 days','NS'),
 ('${L}',21,'Bundesliga',1,now()+interval '14 days','NS'),
 ('${L}',22,'Ligue 1',1,now()+interval '14 days','NS');
 insert into players values(100,true,'GK','A'),(101,true,'GK','A');
 insert into lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order,bench_order)
 values('${L}','${U}',100,true,true,1,null),('${L}','${U}',101,false,false,null,1);
 `);
 const fixtures=()=>query(`select * from public.scoring_week_fixtures('${L}',2::smallint) order by fixture_id`);
 await db.exec("delete from league_headline_fixtures where fixture_id=21");
 verify((await fixtures()).rows,[]);
 await db.exec(`insert into league_headline_fixtures values('${L}',21,'Bundesliga',1,now()+interval '14 days','NS');`);
 verify((await fixtures()).rows.map(r=>Number(r.fixture_id)),[1,2]);
 // A new old-round catch-up fixture cannot change frozen membership.
 await db.exec(`insert into league_headline_fixtures values('${L}',5,'La Liga',1,now(),'FT');`);
 verify((await fixtures()).rows.map(r=>Number(r.fixture_id)),[1,2]);
 verify(await scalar(`select private.gameweek_scoring_fixtures_final('${L}',2::smallint)`),false);
 verify(await scalar(`select private.lineup_changes_locked('${L}')`),true);
 const stamp=await scalar('select now()');
 const evidence=async(id,complete,ids,version=stamp)=>query('select public.record_fixture_stat_evidence($1,$2,$3,$4,$5)',[id,version,complete,'test evidence',ids]);
 await evidence(1,true,[101]);await evidence(2,true,[101]);
 // Claimed completeness without matching persisted stats cannot finalize.
 verify(await scalar(`select private.gameweek_scoring_fixtures_final('${L}',2::smallint)`),false);
 await query('insert into football_fixture_player_stats values(1,101,$1),(2,101,$1)',[stamp]);
 const rows=[{league_id:L,gameweek:2,player_id:100,minutes:0,fantasy_points:0,status:'final',data_complete:true,source_updated_at:stamp},
 {league_id:L,gameweek:2,player_id:101,minutes:90,fantasy_points:8,status:'final',data_complete:true,source_updated_at:stamp}];
 const publish=async(data=rows,proof)=>query('select public.publish_gameweek_scores($1,$2,$3,$4)',[L,2,JSON.stringify(data),JSON.stringify(proof??(await fixtures()).rows)]);
 // Downgrade before publication: incomplete response keeps captain and XI intact.
 await evidence(1,false,[101]);
 await publish();
 verify(await scalar('select count(*)::int from finalized_gameweek_locks'),0);
 verify(await scalar('select count(*)::int from lineup_gameweek_substitutions'),0);
 verify(await scalar('select bool_and(not data_complete and status=\'live\') from league_player_scores'),true);
 await evidence(1,true,[101]);
 // Opening the next market must not let late settlement edit its live lineup.
 await db.exec(`insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',3,now()+interval '7 days');`);
 const editableBefore=(await query('select * from lineup_players order by player_id')).rows;
 // Complete response permits the actual same-position captain DNP substitution.
 await publish();
 verify((await query('select * from lineup_players order by player_id')).rows,editableBefore);
 verify(await scalar('select count(*)::int from finalized_gameweek_locks'),1);
 verify(await scalar('select count(*)::int from lineup_gameweek_substitutions'),1);
 verify((await query('select player_id,is_starter,is_star_pick from lineup_gameweek_players order by player_id')).rows,
 [{player_id:100,is_starter:false,is_star_pick:false},{player_id:101,is_starter:true,is_star_pick:false}]);
 verify(await scalar(`select private.lineup_changes_locked('${L}')`),false);
 // Repeated settlement and a corrected/catch-up publication cannot rewrite final week.
 await query(`select public.settle_final_gameweek('${L}',2::smallint)`);
 verify(await scalar('select count(*)::int from lineup_gameweek_substitutions'),1);
 await publish([{...rows[0],minutes:90,fantasy_points:99}]);
 verify(Number(await scalar('select fantasy_points from league_player_scores where player_id=100')),0);
 await db.exec(`delete from league_transaction_windows where league_id='${L}' and gameweek=3;`);
 // A separate open week verifies evidence-version rejection and postponement behavior.
 await db.exec(`insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',3,date_trunc('day',now())-interval '1 day');
 insert into league_headline_fixtures values('${L}',6,'Premier League',3,date_trunc('day',now()),'PST');`);
 verify((await query(`select fixture_id from public.scoring_week_fixtures('${L}',3::smallint) order by fixture_id`)).rows.map(r=>Number(r.fixture_id)),[2,6]);
 verify(await scalar(`select private.gameweek_scoring_fixtures_final('${L}',3::smallint)`),false);
 await db.exec(`update league_headline_fixtures set kickoff=now()+interval '14 days',status='FT' where fixture_id=6;`);
 verify(await scalar(`select status from private.gameweek_scoring_fixtures('${L}',3::smallint) where fixture_id=6`),'EXCLUDED');
 const proof=(await query(`select * from public.scoring_week_fixtures('${L}',3::smallint)`)).rows;
 await evidence(2,false,[101],new Date(new Date(stamp).getTime()+1000).toISOString());
 await assert.rejects(query('select public.publish_gameweek_scores($1,$2,$3,$4)',[L,3,JSON.stringify(rows.map(r=>({...r,gameweek:3}))),JSON.stringify(proof)]),/evidence changed/);checks++;

 // Corrected provider data can settle an open week, while the old one stays frozen.
 const correctedStamp=new Date(new Date(stamp).getTime()+1000).toISOString();
 await query('update football_fixture_player_stats set source_updated_at=$1 where fixture_id=2',[correctedStamp]);
 await evidence(2,true,[101],correctedStamp);
 const correctedProof=(await query(`select * from public.scoring_week_fixtures('${L}',3::smallint)`)).rows;
 await query('select public.publish_gameweek_scores($1,$2,$3,$4)',[L,3,JSON.stringify(rows.map(r=>({...r,gameweek:3,source_updated_at:correctedStamp,fantasy_points:r.player_id===100?4:8,minutes:90}))),JSON.stringify(correctedProof)]);
 verify(Number(await scalar('select fantasy_points from league_player_scores where gameweek=3 and player_id=100')),4);
 verify(Number(await scalar('select fantasy_points from league_player_scores where gameweek=2 and player_id=100')),0);
 verify(await scalar('select count(*)::int from finalized_gameweek_locks'),2);
 // A wholly postponed week is excluded after its original window, not held for a catch-up months later.
 await db.exec(`update leagues set player_pool='Premier League';
 insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',4,date_trunc('day',now())-interval '8 days');
 insert into league_headline_fixtures values('${L}',7,'Premier League',4,date_trunc('day',now())-interval '8 days','PST');`);
 const excludedProof=(await query(`select * from public.scoring_week_fixtures('${L}',4::smallint)`)).rows;
 verify(excludedProof.map(f=>f.status),['EXCLUDED']);
 verify((await query('select * from public.excluded_scoring_leagues()')).rows,[{league_id:L}]);
 await query('select public.publish_gameweek_scores($1,$2,$3,$4)',[L,4,JSON.stringify(rows.map(r=>({...r,gameweek:4,minutes:0,fantasy_points:0}))),JSON.stringify(excludedProof)]);
 verify(await scalar('select count(*)::int from finalized_gameweek_locks'),3);
 // Regression for the production Week 4 mismatch: Friday counts, larger midweek does not.
 const L2='10000000-0000-0000-0000-000000000002';
 await db.exec(`insert into leagues values('${L2}','draft','Premier League','All Top Five');
 insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L2}',4,'2026-01-10T14:00Z');
 insert into league_headline_fixtures values
 ('${L2}',1001,'Premier League',4,'2026-01-10T14:00Z','FT'),
 ('${L2}',1002,'La Liga',5,'2026-01-09T19:00Z','FT'),
 ('${L2}',1003,'La Liga',5,'2026-01-11T19:00Z','FT'),
 ('${L2}',1004,'Serie A',4,'2026-01-10T19:00Z','FT'),
 ('${L2}',1005,'Bundesliga',3,'2026-01-10T19:00Z','FT'),
 ('${L2}',1006,'Ligue 1',4,'2026-01-10T19:00Z','FT');
 insert into league_headline_fixtures select '${L2}',2000+i,'La Liga',6,'2026-01-14T19:00Z'::timestamptz,'NS' from generate_series(1,10) i;`);
 verify((await query(`select fixture_id from public.scoring_week_fixtures('${L2}',4::smallint) order by fixture_id`)).rows.map(r=>Number(r.fixture_id)),[1001,1002,1003,1004,1005,1006]);
 const diagnostic=await scalar(`select public.gameweek_reconciliation_status('${L2}',4::smallint)`);
 verify(diagnostic.state,'pending');verify(diagnostic.membershipFrozen,true);verify(diagnostic.fixtures.length,6);
 await db.exec(`insert into league_player_scores(league_id,gameweek,player_id,status,source,source_updated_at,minutes,stats_received,data_complete)
 values('${L}',99,100,'final','api-football-verified-not-in-matchday-squad','2026-01-01',0,false,false);
 update league_player_scores set source='api-football-fixture-sum',source_updated_at='2026-02-01',data_complete=false where gameweek=99;`);
 verify(await scalar('select source from league_player_scores where gameweek=99'),'api-football-verified-not-in-matchday-squad');
 await db.exec(`update league_player_scores set source='api-football-fixture-sum',source_updated_at='2026-02-01',data_complete=true where gameweek=99;`);
 verify(await scalar('select source from league_player_scores where gameweek=99'),'api-football-fixture-sum');
 verify(await scalar("select source_updated_at='2026-02-01'::timestamptz from league_player_scores where gameweek=99"),true);
 await db.exec('set role authenticated');
 await assert.rejects(query(`select public.scoring_week_fixtures('${L}',2::smallint)`),/permission denied/);checks++;
 console.log(`${checks} actual PostgreSQL scoring/finalization checks passed.`);
}finally{await db.close()}
