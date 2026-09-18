import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(),L='10000000-0000-0000-0000-000000000001',U='20000000-0000-0000-0000-000000000001';
try {
 for(const file of ['tests/market-bootstrap.sql','tests/scoring-bootstrap.sql','migrations/20260918050601_hardened_scoring_finalization.sql','migrations/20260918055758_isolate_late_week_settlement.sql','migrations/20260918161018_bench_priority_autosubs.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
 await db.exec(`insert into leagues values('${L}','draft','Premier League','All Top Five');
 insert into league_transaction_windows(league_id,gameweek,roster_lock_at) values('${L}',5,now()-interval '1 day'),('${L}',6,now()+interval '7 days');
 insert into players values(1,true,'MID','A'),(2,true,'MID','A'),(3,true,'MID','A'),(4,true,'MID','A'),(5,true,'DEF','A'),(6,true,'MID','A'),(7,true,'FWD','A');
 insert into lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order,bench_order) values
 ('${L}','${U}',1,true,true,1,null),('${L}','${U}',2,false,false,null,2),('${L}','${U}',3,false,false,null,3),('${L}','${U}',4,false,false,null,1),('${L}','${U}',5,false,false,null,4),('${L}','${U}',6,true,false,2,null),('${L}','${U}',7,true,false,3,null);
 select private.snapshot_gameweek_lineups('${L}',5::smallint);
 update lineup_players set bench_order=8 where player_id=2;
 insert into league_player_scores(league_id,gameweek,player_id,minutes,fantasy_points,status,data_complete,source_updated_at)
 select '${L}',5,id,case when id in(1,4,6,7) then 0 else 90 end,case when id=2 then -1 else 20 end,'final',id<>3,now() from players;
 `);
 const settle=()=>db.query(`select private.apply_gameweek_auto_substitution_settlement('${L}',5::smallint) n`);
 assert.equal((await settle()).rows[0].n,0,'Incomplete scores wait');
 await db.exec('update league_player_scores set data_complete=true');
 assert.equal((await settle()).rows[0].n,2,'Two MID DNPs get two played MID substitutes');
 const rows=(await db.query('select outgoing_player_id,incoming_player_id,incoming_bench_order from lineup_gameweek_substitutions order by outgoing_player_id')).rows;
 assert.deepEqual(rows,[{outgoing_player_id:1,incoming_player_id:2,incoming_bench_order:2},{outgoing_player_id:6,incoming_player_id:3,incoming_bench_order:3}],'Locked order beats points; skip DNP first choice; no cross-position replacement');
 assert.equal((await db.query('select bench_order from lineup_players where player_id=2')).rows[0].bench_order,8,'Late settlement preserves next week');
 assert.equal((await settle()).rows[0].n,0,'Settlement is idempotent');
 console.log('PASS: frozen priority, points independence, DNP skip, same position, multiple DNPs, incomplete data, late-week isolation, idempotence');
} finally {await db.close()}
