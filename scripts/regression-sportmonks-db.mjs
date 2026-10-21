import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema private;
 create function auth.jwt() returns jsonb language sql as $$select '{"role":"service_role"}'::jsonb$$;
 create type public.player_position as enum('GK','DEF','MID','FWD');
 create table players(id bigint primary key,full_name text,club text,competition text,position player_position,photo_url text,api_football_id bigint,provider_id text);
 create table football_fixture_cache(fixture_id bigint primary key,home_team text,away_team text,competition text);
 create table sportmonks_fixture_sources(fixture_id bigint,sportmonks_id bigint,player_map jsonb,raw_data jsonb);
 create function private.calculate_league_player_row() returns trigger language plpgsql as $$begin if new.source='api-football-fixture-sum' then return new;end if;return new;end$$;
 create function private.preserve_verified_dnp_evidence() returns trigger language plpgsql as $$begin if new.source = 'api-football-fixture-sum' then return new;end if;return new;end$$;
 insert into players(id,full_name,club,competition,position,photo_url) values(1,'Alpha Player','Home','Premier League','MID',null),(2,'Duplicate','Home','Premier League','DEF',null),(3,'Duplicate','Home','Premier League','FWD',null);
 insert into football_fixture_cache values(10,'Home','Away','Premier League');
 insert into sportmonks_fixture_sources values(10,100,'{"101":1}','{"participants":[{"id":50,"meta":{"location":"home"}},{"id":51,"meta":{"location":"away"}}]}');`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260918131015_sportmonks_primary_provider.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260918133002_prefer_canonical_sportmonks_players.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260918133548_retain_reviewed_sportmonks_aliases.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261021180735_harden_sportmonks_identity_mapping.sql',import.meta.url),'utf8'));
 const q=async sql=>(await db.query(sql)).rows;
 assert.equal((await q('select sportmonks_id from players where id=1'))[0].sportmonks_id,101);
 assert.equal((await q('select sportmonks_id from football_fixture_cache'))[0].sportmonks_id,100);
 const profiles=JSON.stringify([{club:'Home',competition:'Premier League',player:{id:101,name:'Alpha Player',display_name:'Alpha',position_id:27}},{club:'Home',competition:'Premier League',player:{id:102,name:'Duplicate'}},{club:'Home',competition:'Premier League',player:{id:103,name:'New Unknown'}}]);
 const r=(await db.query('select public.sync_sportmonks_profiles($1::jsonb)',[profiles])).rows[0].sync_sportmonks_profiles;
 assert.equal(r.mapped,1);assert.equal(r.unresolved,2);
 assert.deepEqual(await q('select id,position::text from players order by id'),[{id:1,position:'MID'},{id:2,position:'DEF'},{id:3,position:'FWD'}]);
 assert.equal((await q('select count(*)::int n from sportmonks_player_profiles where player_id is null'))[0].n,2);
 await db.exec(`insert into players(id,full_name,club,competition,position,api_football_id) values
 (4,'Canonical Player','Home','Premier League','MID',400),(5,'Canonical Player','Home','Premier League','FWD',null);`);
 const canonical=(await db.query('select public.sync_sportmonks_profiles($1::jsonb)',[JSON.stringify([{club:'Home',competition:'Premier League',player:{id:104,name:'Canonical Player'}}])])).rows[0].sync_sportmonks_profiles;
 assert.equal(canonical.playerMap['104'],4);
 await db.exec(`insert into sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data) values(105,4,'Home','Premier League','{}');`);
 const alias=(await db.query('select public.sync_sportmonks_profiles($1::jsonb)',[JSON.stringify([{club:'Home',competition:'Premier League',player:{id:105,name:'Provider spelling variant'}}])])).rows[0].sync_sportmonks_profiles;
 assert.equal(alias.playerMap['105'],4);
 assert.equal((await q('select sportmonks_id from players where id=4'))[0].sportmonks_id,104);
 assert.match((await q("select pg_get_functiondef('private.calculate_league_player_row()'::regprocedure) d"))[0].d,/sportmonks-fixture-sum/);

 const sync=async(profiles,namesOnly=false)=>(await db.query('select public.sync_sportmonks_profiles($1::jsonb,$2) result',[JSON.stringify(profiles),namesOnly])).rows[0].result;
 const observation=(id,name,extra={})=>({club:'Home',competition:'Premier League',player:{id,name,...extra}});
 const row=async id=>(await db.query('select * from players where id=$1',[id])).rows[0];
 const profileRow=async id=>(await db.query('select * from sportmonks_player_profiles where sportmonks_id=$1',[id])).rows[0];
 const issue=(result,reason,candidateIds=[])=>{
  assert.equal(result.mapped,0);assert.equal(result.unresolved,1);assert.deepEqual(result.playerMap,{});
  assert.equal(result.issues[0].reason,reason);assert.deepEqual(result.issues[0].candidateIds,candidateIds);
 };

 // Invalid envelopes fail explicitly. Invalid individual observations cannot abort
 // other valid mappings, create a null identity, or turn missing input into success.
 for(const input of [null,{},'bad']) await assert.rejects(sync(input),/Profiles must be an array/);
 await assert.rejects(db.query('select public.sync_sportmonks_profiles(null)'),/Profiles must be an array/);
 await assert.rejects(sync(Array(501).fill(observation(999,'Too many'))),/At most 500/);
 await assert.rejects(sync([],null),/Names-only flag/);
 assert.deepEqual(await sync([]),{mapped:0,unresolved:0,playerMap:{},issues:[]});
 for(const input of [null,{}, {player:null}, {player:[]}]) issue(await sync([input]),'invalid_profile');
 for(const id of [undefined,null,0,-1,'nope','9223372036854775808',1.5]){
  issue(await sync([observation(id,'Bad ID')]),'invalid_sportmonks_id');
 }
 for(const extra of [{club:null},{club:''},{competition:null},{competition:42}]){
  issue(await sync([{...observation(110,'Bad Club'),...extra}]),'missing_club_or_competition');
 }
 for(const extra of [{date_of_birth:'2005-99-99'},{date_of_birth:{}},{nationality_id:0}]){
  issue(await sync([observation(110,'Bad Attributes',extra)]),'invalid_profile_attributes');
 }
 issue(await sync([observation(110,null,{display_name:null,common_name:null})]),'missing_name');
 issue(await sync([observation(111,'Nobody')]),'no_candidate');
 assert.equal((await profileRow(111)).player_id,null);

 await db.exec(`insert into players(id,full_name,club,competition,position,api_football_id,provider_id) values
  (10,'Ambiguous Player','Home','Premier League','MID',1010,'api-football:1010'),
  (11,'Ambiguous Player','Home','Premier League','DEF',1011,'api-football:1011'),
  (12,'Transfer Player','Old Club','La Liga','DEF',1012,'api-football:1012'),
  (13,'Corroborated Player','Old Club','La Liga','MID',1013,'api-football:1013'),
  (14,'Another Player','Home','Premier League','MID',1014,'api-football:1014'),
  (15,'Batch Collision','Home','Premier League','MID',1015,'api-football:1015'),
  (16,'Repeat Player','Home','Premier League','DEF',1016,'api-football:1016'),
  (17,'Wrong Birthday','Old Club','La Liga','DEF',1017,'api-football:1017'),
  (18,'Wrong Nation','Old Club','La Liga','DEF',1018,'api-football:1018'),
  (19,'No Birthday','Old Club','La Liga','DEF',1019,'api-football:1019'),
  (20,'Name Twin','Old Club','La Liga','DEF',1020,'api-football:1020'),
  (21,'Name Twin','Other Club','Premier League','DEF',1021,'api-football:1021'),
  (22,'Never Linked','Home','Premier League','DEF',1022,'api-football:1022'),
  (23,'!!!','Home','Premier League','DEF',1023,'api-football:1023');`);
 issue(await sync([observation(112,'Ambiguous Player')]),'ambiguous_name_match',[10,11]);
 issue(await sync([observation(113,'Transfer Player')]),'insufficient_identity_evidence',[12]);
 assert.equal((await row(12)).club,'Old Club');assert.equal((await row(12)).sportmonks_id,null);

 const evidence={date_of_birth:'1997-04-12',nationality_id:32};
 const link=async(smId,playerId,name,extra={})=>{
  await db.query('insert into sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data) values($1,$2,$3,$4,$5)',
   [smId,playerId,'Old Club','La Liga',JSON.stringify({id:smId,name,...evidence,...extra})]);
 };
 // An exact name, verified linked provider DOB + nationality, and a unique result
 // can follow a transfer or reviewed spelling change. Keep the primary ID intact.
 await link(213,13,'Corroborated Player');
 await db.exec('update players set sportmonks_id=213 where id=13');
 const transfer=await sync([observation(114,'Corroborated Player',{...evidence,display_name:'New Display'})]);
 assert.equal(transfer.playerMap['114'],13);assert.deepEqual(transfer.issues,[]);
 assert.equal((await row(13)).sportmonks_id,213);assert.equal((await row(13)).club,'Home');
 assert.equal((await row(13)).position,'MID');assert.equal((await profileRow(114)).player_id,13);
 const storedName=await sync([{...observation(115,'Corroborated Player',evidence),club:'Another Club'}],true);
 assert.equal(storedName.playerMap['115'],13);assert.equal((await row(13)).club,'Home');

 await link(217,17,'Wrong Birthday',{date_of_birth:'1997-04-13'});
 await link(218,18,'Wrong Nation',{nationality_id:86});
 await link(219,19,'No Birthday',{date_of_birth:null});
 await link(220,20,'Name Twin');await link(221,21,'Name Twin');
 await link(222,22,'Never Linked',{id:999}); // Unverified raw provider ID is not corroboration.
 for(const [id,name,playerId] of [[117,'Wrong Birthday',17],[118,'Wrong Nation',18],[119,'No Birthday',19]]){
  issue(await sync([observation(id,name,evidence)]),'insufficient_identity_evidence',[playerId]);
 }
 issue(await sync([{...observation(122,'Never Linked',evidence),club:'New Club'}]),'insufficient_identity_evidence',[22]);
 issue(await sync([observation(120,'Name Twin',evidence)]),'ambiguous_name_match',[20,21]);
 issue(await sync([observation(123,'---',{display_name:'',common_name:null})]),'missing_name');
 assert.equal((await row(23)).sportmonks_id,null);

 // Existing ID mappings can survive missing names; null/non-string names cannot
 // overwrite a canonical name, and names-only refreshes cannot move a player.
 const before=await row(13);
 assert.equal((await sync([{...observation(213,null,{display_name:null,common_name:{}}),club:'Wrong Club'}],true)).playerMap['213'],13);
 assert.equal((await row(13)).full_name,before.full_name);assert.equal((await row(13)).club,before.club);
 // A sparse refresh must retain immutable corroborating evidence.
 assert.equal((await profileRow(213)).raw_data.date_of_birth,evidence.date_of_birth);
 assert.equal((await profileRow(213)).raw_data.name,'Corroborated Player');
 const kept=await profileRow(213);
 issue(await sync([observation(213,'Other Person',{...evidence,date_of_birth:'2007-01-01'})]),'conflicting_profile_attributes',[13]);
 assert.deepEqual(await profileRow(213),kept);
 await db.exec(`insert into sportmonks_player_profiles(sportmonks_id,player_id,club,competition,raw_data) values(215,13,'Home','Premier League','{}')`);
 issue(await sync([observation(215,'Other Person',{...evidence,date_of_birth:'2007-01-01'})]),'conflicting_profile_attributes',[13]);
 assert.deepEqual((await profileRow(215)).raw_data,{});
 await db.exec('update players set sportmonks_id=214 where id=14');
 await link(214,13,'Corroborated Player');
 issue(await sync([observation(214,'Other Person')]),'identity_mapping_conflict',[13,14]);
 assert.equal((await profileRow(214)).player_id,13);assert.equal((await row(14)).sportmonks_id,214);

 // Nationality can legitimately differ across reviewed aliases (for example,
 // dual-nationality profiles). It must not override an established provider ID.
 // Same-ID nationality changes and any linked DOB contradiction still fail closed.
 await db.exec(`insert into players(id,full_name,club,competition,position,api_football_id,provider_id,sportmonks_id)
  values(24,'Nationality Alias','Home','Premier League','MID',1024,'api-football:1024',224)`);
 await link(224,24,'Nationality Alias');
 await link(225,24,'Nationality Alias',{nationality_id:86});
 const otherNationality=await profileRow(225);
 const directNationality=await sync([observation(224,'Nationality Alias',evidence)]);
 assert.equal(directNationality.playerMap['224'],24);assert.deepEqual(directNationality.issues,[]);
 assert.deepEqual(await profileRow(225),otherNationality,'Direct refresh must not rewrite a reviewed alias');
 const reviewedNationality=await sync([observation(225,'Nationality Alias',{...evidence,nationality_id:86})]);
 assert.equal(reviewedNationality.playerMap['225'],24);assert.deepEqual(reviewedNationality.issues,[]);
 assert.equal((await row(24)).sportmonks_id,224,'Reviewed alias must not replace the primary ID');
 const directKept=await profileRow(224),reviewedKept=await profileRow(225);
 issue(await sync([observation(224,'Nationality Alias',{...evidence,nationality_id:86})]),'conflicting_profile_attributes',[24]);
 issue(await sync([observation(225,'Nationality Alias',evidence)]),'conflicting_profile_attributes',[24]);
 assert.deepEqual(await profileRow(224),directKept);assert.deepEqual(await profileRow(225),reviewedKept);
 // The exception is ONLY for established IDs. A new/transfer match still needs
 // matching nationality corroboration without contradictory stored attributes.
 issue(await sync([{...observation(226,'Nationality Alias',evidence),club:'New Club'}]),'insufficient_identity_evidence',[24]);
 await link(227,24,'Nationality Alias',{date_of_birth:'2007-01-01',nationality_id:86});
 issue(await sync([observation(224,'Nationality Alias',evidence)]),'conflicting_profile_attributes',[24]);
 issue(await sync([observation(225,'Nationality Alias',{...evidence,nationality_id:86})]),'conflicting_profile_attributes',[24]);
 assert.deepEqual(await profileRow(224),directKept);assert.deepEqual(await profileRow(225),reviewedKept);

 // Neither contradictory duplicates nor colliding new IDs gets first-write wins.
 const duplicate=await sync([observation(213,'Corroborated Player'),{...observation(213,'Corroborated Player'),club:'Contradiction'}]);
 assert.equal(duplicate.unresolved,2);assert.equal(duplicate.mapped,0);
 assert.equal(duplicate.issues.every(i=>i.reason==='conflicting_duplicate_profile'),true);
 assert.deepEqual(await profileRow(213),kept);
 const collision=await sync([observation(130,'Batch Collision'),observation(131,'Batch Collision')]);
 assert.equal(collision.unresolved,2);assert.equal(collision.mapped,0);
 assert.equal(collision.issues.every(i=>i.reason==='ambiguous_batch_identity'),true);
 assert.equal((await row(15)).sportmonks_id,null);
 assert.equal((await profileRow(130)).player_id,null);assert.equal((await profileRow(131)).player_id,null);
 const repeated=await sync([observation(132,'Repeat Player'),observation(132,'Repeat Player')]);
 assert.equal(repeated.mapped,2);assert.equal(repeated.unresolved,0);assert.equal(repeated.playerMap['132'],16);
 const partial=await sync([observation(null,'Missing ID'),observation(132,null)]);
 assert.equal(partial.mapped,1);assert.equal(partial.unresolved,1);
 assert.equal(partial.playerMap['132'],16);assert.equal(partial.issues[0].sportmonksId,null);
 // A real service role, not just a mocked role claim, can take the serialization
 // locks using the existing SELECT/INSERT/UPDATE grants, with no security definer.
 await db.exec('grant usage on schema auth to service_role; grant select,update on players to service_role; set role service_role');
 assert.equal((await sync([observation(132,'Repeat Player')])).playerMap['132'],16);
 await db.exec('reset role');

 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from sportmonks_player_profiles'),/permission denied/);
 await assert.rejects(db.query('select public.sync_sportmonks_profiles($1::jsonb)',[profiles]),/permission denied/);
 console.log('SportMonks identity diagnostics, transfer evidence, ambiguity, duplicate protection, provenance and access-control checks passed.');
}finally{await db.close();}
