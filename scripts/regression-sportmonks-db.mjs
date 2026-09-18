import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
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
 assert.match((await q("select pg_get_functiondef('private.calculate_league_player_row()'::regprocedure) d"))[0].d,/sportmonks-fixture-sum/);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select * from sportmonks_player_profiles'),/permission denied/);
 await assert.rejects(db.query('select public.sync_sportmonks_profiles($1::jsonb)',[profiles]),/permission denied/);
 console.log('SportMonks identity, position preservation, provenance and access-control checks passed.');
}finally{await db.close();}
