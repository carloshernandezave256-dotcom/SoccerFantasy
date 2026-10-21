import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const read = path => readFile(new URL(`../supabase/${path}`, import.meta.url), 'utf8');

// Load the exact migration body rather than maintaining a second implementation.
// Earlier broad migrations also contain unrelated backfills, cron and market RPCs.
async function loadFunction(exec, file, name) {
  const sql = await read(`migrations/${file}`);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([\\s\\S]*?\\bas\\s+(\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;`, 'ig');
  const matches = [...sql.matchAll(pattern)];
  assert.equal(matches.length, 1, `Expected one production definition of ${name} in ${file}`);
  await exec(matches[0][0]);
}

export async function initializeRolloverDatabase(exec) {
  await exec(await read('tests/rollover-bootstrap.sql'));
  // Capture, immutable locks, audit and mutation guards are all the real migration.
  for (const file of [
    '20260829010000_protect_finalized_gameweeks.sql',
    '20260829011500_reject_anonymous_finalized_writes.sql',
    '20260918050601_hardened_scoring_finalization.sql',
    '20260918055758_isolate_late_week_settlement.sql',
    '20260918094000_batch_scoring_settlement.sql',
    '20260918095000_refresh_complete_dnp_evidence.sql',
    '20260918161018_bench_priority_autosubs.sql',
    '20261017161532_allow_bounded_gameweek_publication_runtime.sql',
    '20261017162827_preserve_next_round_after_delayed_settlement.sql',
  ]) await exec(await read(`migrations/${file}`));
  await loadFunction(exec, '20260824164000_finalize_auto_substitutions_after_gameweek.sql', 'private.apply_gameweek_auto_substitutions');
  await loadFunction(exec, '20260822233000_round_captain_scores_down.sql', 'private.manager_gameweek_score');
  await loadFunction(exec, '20260819010000_weekly_star_pick_bonus.sql', 'public.refresh_league_matchup_scores');
  await loadFunction(exec, '20260825184834_randomize_waiver_priority_at_rollover.sql', 'private.randomize_gameweek_waiver_priority');
  await loadFunction(exec, '20260825184834_randomize_waiver_priority_at_rollover.sql', 'private.open_next_gameweek');
  // Exercise independent backlog discovery against real final locks/rollover.
  // Transport, cron and run-journal behavior have their own automation regression.
  for (const name of ['private.gameweek_settlement_diagnostics','public.pending_gameweek_settlements',
    'public.gameweek_reconciliation_status']) {
    await loadFunction(exec,'20261021180402_track_scoring_completion_and_retry_settlement.sql',name);
  }
  await exec(`create trigger apply_final_score_auto_substitutions
    after insert or update of status,minutes,fantasy_points on public.league_player_scores
    for each row execute function private.apply_final_score_auto_substitutions();
    select set_config('request.jwt.claim.role','service_role',false);`);
}

export const manager = '20000000-0000-0000-0000-000000000001';
export const opponent = '20000000-0000-0000-0000-000000000002';
export const leagueId = number => `10000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const positions = ['GK','DEF','DEF','DEF','DEF','MID','MID','MID','FWD','FWD','FWD','GK','DEF','DEF','MID','MID','FWD','FWD'];
const dnps = [1,2,6,9,15,17];
const points = new Map([[12,8],[13,4],[14,20],[16,-1],[18,9]]);

export async function seedRolloverLeague(query, number, {delayed = false, pool = 'All Top Five'} = {}) {
  const league = leagueId(number), base = number * 100;
  await query(`insert into auth.users values($1),($2) on conflict do nothing`, [manager,opponent]);
  await query(`insert into leagues values($1,'draft','Premier League',$2,15)`, [league,pool]);
  await query(`insert into league_members values($1,$2,1),($1,$3,2)`, [league,manager,opponent]);
  await query(`insert into drafts(league_id,status) values($1,'complete')`, [league]);
  for (let index = 0; index < positions.length; index++) {
    const id = base + index + 1;
    await query(`insert into players values($1,true,$2,$3,'Premier League')`, [id,positions[index],`Club ${index % 5}`]);
    await query(`insert into draft_picks values($1,$2,$3,$4)`, [league,manager,id,index+1]);
    await query(`insert into lineup_players(league_id,user_id,player_id,is_starter,is_captain,pitch_order,bench_order)
      values($1,$2,$3,$4,$5,$6,$7)`, [league,manager,id,index<11,index===0,index<11?index+1:null,index>=11?index-10:null]);
  }
  // Last Friday, or the preceding Friday when simulating a week-late provider.
  const kickoff = (await query(`select date_trunc('week',now())-make_interval(days=>$1)+interval '15 hours' as kickoff`, [delayed?10:3])).rows[0].kickoff;
  await query(`insert into league_transaction_windows(league_id,gameweek,waiver_process_at,roster_lock_at,processed_at)
    values($1,1,$2::timestamptz-interval '2 days',$2::timestamptz-interval '15 minutes',now()-interval '2 days')`, [league,kickoff]);
  const competitions = pool === 'All Top Five'
    ? ['Premier League','Premier League','La Liga','Serie A','Bundesliga','Ligue 1']
    : ['Premier League','Premier League'];
  for (let index = 0; index < competitions.length; index++) {
    await query(`insert into league_headline_fixtures values($1,$2,$3,1,$4::timestamptz+make_interval(hours=>$5),'FT')`,
      [league,base+index+1,competitions[index],kickoff,index]);
  }
  // The next scheduled round is already underway for the delayed case, while
  // round 3 is future. The production regression used to skip straight to 3.
  await query(`insert into league_headline_fixtures values
    ($1,$2,'Premier League',2,$4::timestamptz+interval '7 days','NS'),
    ($1,$3,'Premier League',3,$4::timestamptz+interval '14 days','NS')`, [league,base+20,base+21,kickoff]);
  await query(`insert into league_matchups(league_id,gameweek,home_user_id,away_user_id)
    values($1,1,$2,$3),($1,2,$2,$3)`, [league,manager,opponent]);
  const stamp = (await query('select now() as stamp')).rows[0].stamp;
  const rows = positions.map((_, index) => ({
    league_id:league,gameweek:1,player_id:base+index+1,
    minutes:dnps.includes(index+1)?0:90,
    fantasy_points:dnps.includes(index+1)?0:(points.get(index+1)??index+1),
    status:'final',data_complete:true,stats_received:!dnps.includes(index+1),
    source:'integration-fixture-sum',source_updated_at:stamp,
    score_ledger:[],calculator_version:'integration-fixture-values',
  }));
  return {league,base,kickoff,stamp,rows,fixtureIds:competitions.map((_,index)=>base+index+1)};
}

export async function certifyFixture(query, fixture, stamp, playerId, {complete=true, persist=true}={}) {
  await query('select public.record_fixture_stat_evidence($1,$2,$3,$4,$5)', [fixture,stamp,complete,'Synthetic reconciled squads',[playerId]]);
  if (persist) await query(`insert into football_fixture_player_stats(fixture_id,player_id,source_updated_at) values($1,$2,$3)
    on conflict(fixture_id,player_id) do update set source_updated_at=excluded.source_updated_at`, [fixture,playerId,stamp]);
}

export async function publication(query, scenario, rows=scenario.rows, proof) {
  proof ??= (await query('select * from public.scoring_week_fixtures($1,1::smallint)', [scenario.league])).rows;
  return (await query('select public.publish_gameweek_scores($1,1::smallint,$2,$3) as published',
    [scenario.league,JSON.stringify(rows),JSON.stringify(proof)])).rows[0].published;
}

// Replay the real provider -> SQL fixture calculator -> JS weekly aggregation
// -> SQL publication/settlement boundary. esbuild is already in the locked test
// toolchain (Vitest/Vite); bundling resolves the app's extensionless TS imports.
async function runProviderReplay(db, verify) {
  const {build} = await import('esbuild');
  const bundled = await build({
    stdin:{contents:`export {normalizeSportMonks} from './sportmonks-scoring.ts';
      export {buildLeaguePlayerScoreRows} from './live-score-domain.ts';`,
      resolveDir:fileURLToPath(new URL('../src/lib/',import.meta.url)),loader:'ts'},
    bundle:true,format:'esm',platform:'node',write:false,
  });
  const {normalizeSportMonks,buildLeaguePlayerScoreRows} = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
  const query=(sql,args)=>db.query(sql,args);
  // Use a new isolated league so earlier publication-boundary synthetic scores
  // remain unchanged; the real calculator triggers are installed for this replay.
  const scenario=await seedRolloverLeague(query,7,{pool:'Premier League'});
  const statisticalColumns=['minutes','goals','assists','shots_on_target','completed_passes','tackles_won',
    'penalty_goals','penalties_missed','penalties_conceded','saves','penalties_saved','goals_conceded',
    'yellow_cards','second_yellow_cards','red_cards','own_goals'];
  await db.exec(`alter table football_fixture_player_stats ${statisticalColumns.map(column=>`add column ${column} integer default 0`).join(',')},
    add column rating numeric,add column man_of_the_match boolean default false,
    add column fantasy_points numeric not null default 0,add column score_ledger jsonb,
    add column calculator_version text;`);
  await loadFunction(sql=>db.exec(sql),'20260823170717_remove_man_of_the_match.sql','private.calculate_fantasy_score');
  await loadFunction(sql=>db.exec(sql),'20260918090000_sportmonks_scoring_sources.sql','private.calculate_fixture_player_row');
  await loadFunction(sql=>db.exec(sql),'20260828215000_support_multi_fixture_gameweeks.sql','private.calculate_league_player_row');
  const providerMigration=await read('migrations/20260918131015_sportmonks_primary_provider.sql');
  const providerPatch=providerMigration.match(/do \$\$ declare d text; begin[\s\S]*?end \$\$;/g);
  assert.equal(providerPatch?.length,1,'Load exact production SportMonks fixture-sum preservation patch');
  await db.exec(providerPatch[0]);
  await db.exec(`create trigger calculate_fixture_player_score before insert or update on football_fixture_player_stats
    for each row execute function private.calculate_fixture_player_row();
    create trigger calculate_league_player_score before insert or update on league_player_scores
    for each row execute function private.calculate_league_player_row();`);
  for(let index=19;index<=23;index++) await query(`insert into players values($1,true,'DEF','Other Club','Premier League')`,[scenario.base+index]);
  await query(`update league_headline_fixtures set kickoff=$2::timestamptz+interval '2 days' where league_id=$1 and fixture_id=$3`,[scenario.league,scenario.kickoff,scenario.base+2]);
  for(let match=0;match<2;match++) {
    const fixtureId=scenario.fixtureIds[match];
    const kickoff=new Date(new Date(scenario.kickoff).getTime()+match*2*86400000).toISOString();
    const playerMap=Object.fromEntries(Array.from({length:23},(_,index)=>[index+1,scenario.base+(index===22?1:index+2)]));
    const raw={
      id:900000+fixtureId,league_id:8,starting_at:kickoff.slice(0,19).replace('T',' '),state:{state:'FT'},
      participants:[{id:10,name:'Home',meta:{location:'home'}},{id:20,name:'Away',meta:{location:'away'}}],
      scores:[10,20].map(id=>({description:'CURRENT',participant_id:id,score:{goals:0}})),events:[],
      lineups:Array.from({length:23},(_,index)=>({player_id:index+1,player_name:`Synthetic Player ${index+1}`,
        team_id:index<11||index===22?10:20,type_id:index===22?12:11,
        details:index===22?[]:[{type_id:119,data:{value:90}},{type_id:118,data:{value:7}},
          {type_id:80,data:{value:10}},{type_id:116,data:{value:6}}]})),
    };
    const source={fixture_id:fixtureId,sportmonks_id:raw.id,raw_data:raw,player_map:playerMap};
    const context={fixture_id:fixtureId,kickoff,competition_id:39,home_score:0,away_score:0};
    const observedAt=new Date(scenario.stamp).toISOString();
    const normalized=normalizeSportMonks(source,context,observedAt);
    verify(normalized.length,23,'Full provider squads reconcile before scoring');
    verify(normalized.find(row=>row.player_id===scenario.base+1).minutes,0,'Unused provider substitute is verified DNP, not inferred from missing stats');
    await query(`insert into football_fixture_cache(fixture_id,status,kickoff) values($1,'FT',$2)`,[fixtureId,kickoff]);
    await query(`insert into football_fixture_player_stats
      select * from jsonb_populate_recordset(null::public.football_fixture_player_stats,$1::jsonb)`,[JSON.stringify(normalized)]);
    await query('select public.record_fixture_stat_evidence($1,$2,true,$3,$4)',
      [fixtureId,observedAt,'SportMonks lineup, minutes and events reconciled',normalized.map(row=>row.player_id)]);
  }
  // Match PostgREST's JSON wire representation, including exact ISO timestamps.
  const fixtureStats=JSON.parse(JSON.stringify((await query('select * from football_fixture_player_stats where fixture_id=any($1::bigint[]) order by fixture_id,player_id',[scenario.fixtureIds])).rows));
  const proof=JSON.parse(JSON.stringify((await query('select * from public.scoring_week_fixtures($1,1::smallint)',[scenario.league])).rows));
  const rows=buildLeaguePlayerScoreRows({leagueId:scenario.league,gameweek:1,
    playerIds:Array.from({length:23},(_,index)=>scenario.base+index+1),
    // A duplicated page may be returned by transport retries; do not count twice.
    fixtureStats:[...fixtureStats,...fixtureStats],weekFixtures:proof,
    updatedAt:new Date(scenario.stamp).toISOString()});
  const goalkeeper=rows.find(row=>row.player_id===scenario.base+12);
  verify([goalkeeper.minutes,goalkeeper.completed_passes,goalkeeper.fantasy_points],[180,12,10],
    'Real aggregation preserves two fixture scores, not one score calculated from merged stats');
  verify(goalkeeper.score_ledger.map(entry=>[entry.code,entry.points]),
    [['minutes',2],['clean-sheet',3],['minutes',2],['clean-sheet',3]],'Two real SQL calculator ledgers survive weekly aggregation; six passes per fixture never become a false pass point');
  verify(rows.every(row=>row.status==='final'&&row.data_complete),true,'Persisted provider evidence completes the real aggregation gate');
  verify(await publication(query,scenario,rows,proof),23,'Normalized/calculated weekly rows publish through real RPC');
  const archive=(await query('select snapshot from finalized_gameweek_locks where league_id=$1',[scenario.league])).rows[0].snapshot;
  verify(Number(archive.matchups[0].home_score),80,'Final matchup has exact provider-to-database total after goalkeeper auto-sub');
  verify(archive.substitutions.map(row=>[Number(row.outgoing_player_id),Number(row.incoming_player_id)]),
    [[scenario.base+1,scenario.base+12]],'Provider DNP substitutes only same-position reserve');
  const archivedKeeper=archive.scores.find(row=>Number(row.player_id)===scenario.base+12);
  verify([Number(archivedKeeper.fantasy_points),archivedKeeper.calculator_version,archivedKeeper.source],
    [10,'fixture-sum-v1','sportmonks-fixture-sum'],'Production league trigger preserves per-fixture total and provenance');
  verify(archivedKeeper.score_ledger,goalkeeper.score_ledger,'Archive preserves exact calculated ledger');
  verify(Number((await query('select count(*) as n from league_transaction_windows where league_id=$1 and gameweek=2',[scenario.league])).rows[0].n),1,
    'Full provider-to-score path opens real next-week market');
  verify(await publication(query,scenario,rows,proof),0,'Provider replay cannot rewrite archived scores or repeat rollover');
  console.log('PASS: real SportMonks normalization -> SQL fixture scoring/ledger -> JS weekly aggregation -> SQL publication/autosub/archive/rollover');
}

async function run() {
  const db = new PGlite();
  let checks = 0;
  const query = (sql,args) => db.query(sql,args);
  const scalar = async (sql,args) => Object.values((await query(sql,args)).rows[0])[0];
  const verify = (actual,expected,message) => {assert.deepEqual(actual,expected,message);checks++;};
  const rejects = async (promise,pattern) => {await assert.rejects(promise,pattern);checks++;};
  const rowCount = (table,league,week=1) => scalar(`select count(*)::int from ${table} where league_id=$1 and gameweek=$2`,[league,week]);
  const pending = async (scenario,label) => {
    verify(await rowCount('finalized_gameweek_locks',scenario.league),0,`${label}: no final lock`);
    verify(await rowCount('lineup_gameweek_substitutions',scenario.league),0,`${label}: no premature subs`);
    verify(await rowCount('league_transaction_windows',scenario.league,2),0,`${label}: no premature rollover`);
    verify(await scalar('select private.lineup_changes_locked($1)',[scenario.league]),true,`${label}: lineup stays locked`);
  };
  try {
    await initializeRolloverDatabase(sql=>db.exec(sql));
    const s = await seedRolloverLeague(query,1);
    const proof = () => query('select * from public.scoring_week_fixtures($1,1::smallint) order by fixture_id',[s.league]);
    const before = (await query('select * from lineup_players where league_id=$1 order by player_id',[s.league])).rows;
    // Missing a whole competition must not silently make the fantasy week ready.
    await query('delete from league_headline_fixtures where league_id=$1 and fixture_id=$2',[s.league,s.base+5]);
    verify((await proof()).rows,[],'Incomplete season schedule must not freeze');
    await rejects(publication(query,s),/Week fixtures are not frozen/);
    await query(`insert into league_headline_fixtures values($1,$2,'Bundesliga',1,$3::timestamptz+interval '4 hours','FT')`,[s.league,s.base+5,s.kickoff]);
    await query('update league_headline_fixtures set status=null where league_id=$1 and fixture_id=$2',[s.league,s.base+2]);
    verify((await proof()).rows.map(row=>Number(row.fixture_id)),s.fixtureIds,'All five competitions freeze together');
    // Later schedule additions cannot alter the locked scoring membership.
    await query(`insert into league_headline_fixtures values($1,$2,'La Liga',1,$3::timestamptz+interval '6 hours','FT')`,[s.league,s.base+30,s.kickoff]);
    verify((await proof()).rows.map(row=>Number(row.fixture_id)),s.fixtureIds,'Fixture membership is immutable');
    for (const id of s.fixtureIds) await certifyFixture(query,id,s.stamp,s.base+12);
    await publication(query,s);
    await pending(s,'Null fixture status');
    verify(await scalar(`select bool_and(status='live' and not data_complete) from league_player_scores where league_id=$1`,[s.league]),true,'Caller final flags cannot override null fixture status');
    await query(`update league_headline_fixtures set status='FT' where league_id=$1 and fixture_id=$2`,[s.league,s.base+2]);
    await query('delete from private.fixture_stat_evidence where fixture_id=$1',[s.base+2]);
    await publication(query,s);
    await pending(s,'Missing evidence');
    await certifyFixture(query,s.base+2,s.stamp,s.base+12,{complete:false});
    await publication(query,s);
    await pending(s,'Explicitly incomplete evidence');
    await certifyFixture(query,s.base+2,s.stamp,s.base+12);
    await query('delete from football_fixture_player_stats where fixture_id=$1',[s.base+2]);
    await publication(query,s);
    await pending(s,'Claimed evidence missing persisted stats');
    verify((await query('select * from lineup_players where league_id=$1 order by player_id',[s.league])).rows,before,'Incomplete publication leaves editable XI intact');
    await certifyFixture(query,s.base+2,s.stamp,s.base+12);
    await rejects(publication(query,s,s.rows.slice(1)),/Publication omits a locked player/);
    await pending(s,'Omitted locked player');
    await publication(query,s,s.rows.map(row=>row.player_id===s.base+1?{...row,source_updated_at:null}:row));
    await pending(s,'Null locked-player observation timestamp');
    const staleProof = (await proof()).rows;
    const later = new Date(new Date(s.stamp).getTime()+1000).toISOString();
    await certifyFixture(query,s.base+2,later,s.base+12);
    await rejects(publication(query,s,s.rows,staleProof),/Fixture evidence changed/);
    await publication(query,s);
    await pending(s,'Stale locked-player observation timestamp');
    s.rows=s.rows.map(row=>({...row,source_updated_at:later}));
    verify(await publication(query,s),18,'Complete batch publishes all 18 owned players');
    verify(await rowCount('finalized_gameweek_locks',s.league),1,'One immutable final lock');
    verify(await rowCount('finalized_gameweek_audit',s.league),1,'One archival audit record');
    verify(await rowCount('league_transaction_windows',s.league,2),1,'Real rollover creates next transaction window');
    verify(await rowCount('league_transaction_windows',s.league,3),0,'Only one round opens');
    const subs = (await query(`select outgoing_player_id,incoming_player_id,position,incoming_bench_order,
      carried_to_lineup_at is not null as carried from lineup_gameweek_substitutions where league_id=$1 order by outgoing_player_id`,[s.league])).rows;
    verify(subs.map(row=>({...row,outgoing_player_id:Number(row.outgoing_player_id)-s.base,incoming_player_id:Number(row.incoming_player_id)-s.base})),[
      {outgoing_player_id:1,incoming_player_id:12,position:'GK',incoming_bench_order:1,carried:true},
      {outgoing_player_id:2,incoming_player_id:13,position:'DEF',incoming_bench_order:2,carried:true},
      {outgoing_player_id:6,incoming_player_id:16,position:'MID',incoming_bench_order:5,carried:true},
      {outgoing_player_id:9,incoming_player_id:18,position:'FWD',incoming_bench_order:7,carried:true},
    ],'Same-position subs use frozen priority, skip DNPs and permit negative points');
    verify(await scalar('select count(*)::int from lineup_gameweek_players where league_id=$1 and gameweek=1 and is_starter',[s.league]),11,'Final XI retains 11 starters');
    verify(await scalar('select count(*)::int from lineup_gameweek_players where league_id=$1 and gameweek=1 and is_star_pick',[s.league]),0,'Captain does not transfer to substitute');
    verify(await scalar('select count(*)::int from lineup_players where league_id=$1 and is_captain',[s.league]),0,'Next default XI clears substituted captain');
    verify(Number(await scalar('select home_score from league_matchups where league_id=$1 and gameweek=1',[s.league])),68,'Matchup uses final substituted XI');
    verify(await scalar('select status from league_matchups where league_id=$1 and gameweek=1',[s.league]),'final','Matchup finalized before archival');
    const archive = await scalar('select snapshot from finalized_gameweek_locks where league_id=$1',[s.league]);
    verify(archive.scores.length,18,'Archive includes every published score');
    verify(archive.lineups.length,18,'Archive includes full locked squad');
    verify(archive.substitutions.length,4,'Archive includes completed substitutions');
    verify(Number(archive.matchups[0].home_score),68,'Archive captures final matchup total');
    verify(await scalar(`select bool_and(status='not_started' and source='gameweek-rollover' and fantasy_points=0 and not data_complete)
      from league_player_scores where league_id=$1 and gameweek=2`,[s.league]),true,'Next week seeded with pending zero scores');
    verify(await rowCount('league_player_scores',s.league,2),18,'Every eligible active player is seeded');
    verify(await scalar(`select roster_lock_at=$2::timestamptz+interval '7 days'-interval '15 minutes' and
      waiver_process_at=(date_trunc('week',($2::timestamptz+interval '7 days') at time zone 'America/Los_Angeles')::date+3+time '00:00') at time zone 'America/Los_Angeles'
      from league_transaction_windows where league_id=$1 and gameweek=2`,[s.league,s.kickoff]),true,'Existing LA Thursday waiver and kickoff-minus-lock deadline formulas unchanged');
    verify(await scalar('select private.lineup_changes_locked($1)',[s.league]),false,'Future next-week lineup is editable');
    const windowBefore = (await query('select * from league_transaction_windows where league_id=$1 and gameweek=2',[s.league])).rows;
    const priorityBefore = (await query('select user_id,waiver_priority from league_members where league_id=$1 order by user_id',[s.league])).rows;
    verify(priorityBefore.map(row=>row.waiver_priority).sort(),[1,2],'Waiver priorities form a valid permutation');
    verify(windowBefore[0].priority_randomized_at!==null,true,'Priority randomized on opening');
    verify(await publication(query,s,s.rows.map(row=>({...row,fantasy_points:999}))),0,'Repeat publisher is a no-op');
    verify(await scalar('select public.settle_final_gameweek($1,1::smallint)',[s.league]),0,'Repeat settlement is a no-op');
    verify(await scalar('select private.open_next_gameweek($1,1::smallint)',[s.league]),2,'Repeat rollover returns existing week');
    verify((await query('select * from league_transaction_windows where league_id=$1 and gameweek=2',[s.league])).rows,windowBefore,'Repeat rollover preserves deadlines and randomization timestamp');
    verify((await query('select user_id,waiver_priority from league_members where league_id=$1 order by user_id',[s.league])).rows,priorityBefore,'Repeat rollover does not rerandomize priorities');
    verify(await scalar('select snapshot from finalized_gameweek_locks where league_id=$1',[s.league]),archive,'Replay cannot rewrite archived week');
    for (const [table,change] of [
      ['league_player_scores','fantasy_points=999'],['league_matchups','home_score=999'],
      ['lineup_gameweek_players','is_starter=false'],['lineup_gameweek_substitutions','incoming_points=999'],
    ]) await rejects(query(`update ${table} set ${change} where league_id=$1 and gameweek=1`,[s.league]),/finalized and locked/);
    verify(await rowCount('finalized_gameweek_audit',s.league),1,'Rejected rewrites and replays do not duplicate archival audit');
    console.log('PASS: actual settlement, four same-position subs, matchup archive, guards, rollover, deadlines, evidence gates and repeat publishers');

    // The next kickoff has already passed when old provider data finally arrives.
    const delayed = await seedRolloverLeague(query,2,{delayed:true,pool:'Premier League'});
    for (const id of delayed.fixtureIds) await certifyFixture(query,id,delayed.stamp,delayed.base+12);
    await publication(query,delayed);
    verify(await rowCount('league_transaction_windows',delayed.league,2),1,'Delayed settlement opens the immediate next round even after kickoff');
    verify(await rowCount('league_transaction_windows',delayed.league,3),0,'Delayed settlement must not skip the underway round');
    verify(await scalar(`select roster_lock_at=$2::timestamptz+interval '7 days'-interval '15 minutes' and roster_lock_at<now()
      from league_transaction_windows where league_id=$1 and gameweek=2`,[delayed.league,delayed.kickoff]),true,'Delayed rollover preserves scheduled deadline, not now-based deadline');
    verify(await scalar('select private.lineup_changes_locked($1)',[delayed.league]),true,'Already-started next round remains locked');
    console.log('PASS: delayed finalization preserves the next scheduled round and its original lock');

    // If a later market was already opened, historical settlement is isolated.
    const late = await seedRolloverLeague(query,3,{pool:'Premier League'});
    await query('select private.snapshot_gameweek_lineups($1,1::smallint)',[late.league]);
    await query(`insert into league_transaction_windows(league_id,gameweek,waiver_process_at,roster_lock_at)
      values($1,2,$2::timestamptz+interval '5 days',$2::timestamptz+interval '7 days'-interval '15 minutes')`,[late.league,late.kickoff]);
    await query('update lineup_players set bench_order=8 where league_id=$1 and player_id=$2',[late.league,late.base+13]);
    const laterLineup = (await query('select * from lineup_players where league_id=$1 order by player_id',[late.league])).rows;
    for (const id of late.fixtureIds) await certifyFixture(query,id,late.stamp,late.base+12);
    await publication(query,late);
    verify((await query('select * from lineup_players where league_id=$1 order by player_id',[late.league])).rows,laterLineup,'Late settlement cannot overwrite next-week edits');
    verify(await rowCount('lineup_gameweek_substitutions',late.league),4,'Late settlement still settles historical same-position substitutes');
    verify(await scalar('select bool_and(carried_to_lineup_at is null) from lineup_gameweek_substitutions where league_id=$1',[late.league]),true,'Historical-only swaps are not marked as carried');
    verify(Number(await scalar('select incoming_player_id from lineup_gameweek_substitutions where league_id=$1 and outgoing_player_id=$2',[late.league,late.base+2])),late.base+13,'Historical frozen bench order beats edited current order');
    console.log('PASS: late historical settlement preserves new-week lineup edits');

    // A late provider cancellation can legitimately exclude the entire original
    // frozen window. No made-up player evidence is needed to archive zero scores.
    const excluded = await seedRolloverLeague(query,5,{delayed:true,pool:'Premier League'});
    await query(`update league_headline_fixtures set status='PST' where league_id=$1 and gameweek=1`,[excluded.league]);
    const excludedProof = (await query('select * from public.scoring_week_fixtures($1,1::smallint)',[excluded.league])).rows;
    verify(excludedProof.map(row=>row.status),['EXCLUDED','EXCLUDED'],'Postponed fixtures expire out of their original frozen window');
    await publication(query,excluded,excluded.rows.map(row=>({...row,minutes:0,fantasy_points:0,stats_received:false})),excludedProof);
    verify(await rowCount('finalized_gameweek_locks',excluded.league),1,'Entirely excluded week can archive');
    verify(await rowCount('lineup_gameweek_substitutions',excluded.league),0,'No played substitutes are invented for excluded week');
    verify(await rowCount('league_transaction_windows',excluded.league,2),1,'Entirely excluded week actually rolls over');
    verify(Number(await scalar('select home_score from league_matchups where league_id=$1 and gameweek=1',[excluded.league])),0,'Excluded-week final matchup is zero');

    // An error at the last step must not strand a final lock without the next
    // market. Inject only a synthetic table constraint, then retry the same RPC.
    const retry = await seedRolloverLeague(query,6,{pool:'Premier League'});
    for (const id of retry.fixtureIds) await certifyFixture(query,id,retry.stamp,retry.base+12);
    const retryLineup = (await query('select * from lineup_players where league_id=$1 order by player_id',[retry.league])).rows;
    await db.exec(`alter table league_transaction_windows add constraint test_rollover_failure
      check(not(league_id='${retry.league}'::uuid and gameweek=2))`);
    await rejects(publication(query,retry),/test_rollover_failure/);
    await pending(retry,'Rollover failure rolls back whole publication');
    verify(await rowCount('finalized_gameweek_audit',retry.league),0,'Failed rollover leaves no audit artifact');
    verify(await rowCount('league_player_scores',retry.league),0,'Failed rollover leaves no partial published scores');
    verify(await rowCount('lineup_gameweek_players',retry.league),0,'Failed rollover leaves no partial lineup snapshot');
    verify((await query('select * from lineup_players where league_id=$1 order by player_id',[retry.league])).rows,retryLineup,'Failed rollover restores editable lineup');
    await db.exec('alter table league_transaction_windows drop constraint test_rollover_failure');
    verify(await publication(query,retry),18,'Retry after recoverable rollover failure succeeds');
    verify(await rowCount('finalized_gameweek_locks',retry.league),1,'Successful retry archives exactly once');
    verify(await rowCount('league_transaction_windows',retry.league,2),1,'Successful retry opens exactly one next window');
    console.log('PASS: entirely postponed weeks roll over; publication rolls back atomically on calendar failure and safely retries');

    // The automation fix must discover a ready old week independently of the
    // provider retry queue and finish using the real settlement/rollover RPC.
    const backlog=await seedRolloverLeague(query,8,{delayed:true,pool:'Premier League'});
    for(const id of backlog.fixtureIds) await certifyFixture(query,id,backlog.stamp,backlog.base+12);
    await publication(query,backlog,backlog.rows.map(row=>({...row,source_updated_at:null})));
    const pendingBacklog=async()=> (await query('select * from public.pending_gameweek_settlements() where league_id=$1 and gameweek=1',[backlog.league])).rows;
    verify((await pendingBacklog())[0].fixtures_ready,true,'Backlog fixture proof is independently ready');
    verify((await pendingBacklog())[0].settlement_ready,false,'Backlog cannot settle scores with missing timestamp');
    await query('update league_player_scores set source_updated_at=$2 where league_id=$1 and gameweek=1',[backlog.league,backlog.stamp]);
    verify((await query('select * from public.pending_scoring_fixtures()')).rows,[],'No provider fixture retry is necessary or available');
    verify((await pendingBacklog())[0].settlement_ready,true,'Independent pending-week RPC finds the ready stored scores');
    verify(await scalar('select public.settle_final_gameweek($1,1::smallint)',[backlog.league]),4,'Retry-ready week executes actual four-sub settlement');
    verify(await pendingBacklog(),[],'Successful retry disappears from pending-week discovery');
    verify(await rowCount('finalized_gameweek_locks',backlog.league),1,'Backlog retry creates actual final archive lock');
    verify(await rowCount('league_transaction_windows',backlog.league,2),1,'Backlog retry creates actual immediate next window');
    verify(await rowCount('league_transaction_windows',backlog.league,3),0,'Backlog retry never skips the delayed round');
    console.log('PASS: independent ready-week discovery settles/archives/rolls over without provider retry candidates');

    // New leagues still begin at a future round; only existing weeks can catch up.
    const fresh = leagueId(4);
    await query(`insert into leagues values($1,'draft','Premier League','Premier League',15)`,[fresh]);
    await query(`insert into league_headline_fixtures values
      ($1,401,'Premier League',1,now()-interval '7 days','FT'),
      ($1,402,'Premier League',2,now()+interval '7 days','NS')`,[fresh]);
    verify(await scalar('select private.refresh_league_calendar($1)',[fresh]),null,'Incomplete draft cannot activate calendar');
    await query(`insert into drafts(league_id,status) values($1,'complete')`,[fresh]);
    verify(await scalar('select private.refresh_league_calendar($1)',[fresh]),2,'New completed draft starts at future kickoff');
    verify(await rowCount('league_transaction_windows',fresh),0,'New league does not create an old round');
    await runProviderReplay(db,verify);
    console.log(`${checks} real PostgreSQL-engine rollover integration assertions passed (PGlite; multi-connection overlap is a separate PostgreSQL CI test).`);
  } finally {await db.close();}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run();
