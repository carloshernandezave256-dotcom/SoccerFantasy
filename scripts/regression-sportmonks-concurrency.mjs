import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Use only a disposable PostgreSQL instance. This harness creates an isolated DB;
// it must not be pointed at production or a shared operational server.
const url=process.env.TEST_DATABASE_URL;
if(!url)throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL server.');
const admin=new pg.Client({connectionString:url});await admin.connect();
const name=`sportmonks_identity_${Date.now()}`;
const isolated=new URL(url);isolated.pathname=`/${name}`;
const clients=[];
try{
 await admin.query(`create database ${name}`);
 const make=async()=>{const c=new pg.Client({connectionString:isolated.href});await c.connect();clients.push(c);return c};
 const setup=await make();
 await setup.query(`do $$begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
 end$$;
 create schema auth;
 create function auth.jwt() returns jsonb language sql as $$select '{"role":"service_role"}'::jsonb$$;
 create table public.players(id bigint primary key,full_name text,club text,competition text,
  photo_url text,api_football_id bigint,provider_id text,nationality text,sportmonks_id bigint unique);
 create table public.sportmonks_player_profiles(sportmonks_id bigint primary key,player_id bigint references public.players(id),
  club text not null,competition text not null,raw_data jsonb not null,observed_at timestamptz not null default now());
 insert into public.players(id,full_name,club,competition,api_football_id,provider_id)
 values(1,'Concurrent Player','Home','Premier League',1001,'api-football:1001');`);
 await setup.query(await readFile(new URL('../supabase/migrations/20261021180735_harden_sportmonks_identity_mapping.sql',import.meta.url),'utf8'));
 await setup.query(await readFile(new URL('../supabase/migrations/20261021193443_qualify_sportmonks_profile_nationality.sql',import.meta.url),'utf8'));
 const a=await make(),b=await make();
 for(const c of [a,b])await c.query("set statement_timeout='10s'");
 const sql='select public.sync_sportmonks_profiles($1::jsonb) result';
 const payload=id=>[JSON.stringify([{club:'Home',competition:'Premier League',player:{id,name:'Concurrent Player'}}])];
 await a.query('begin');
 assert.equal((await a.query(sql,payload(901))).rows[0].result.playerMap['901'],1);
 const pid=(await b.query('select pg_backend_pid() pid')).rows[0].pid;
 const second=b.query(sql,payload(902));
 let waiting=false;
 for(let i=0;i<100;i++){
  const state=(await setup.query('select wait_event_type from pg_stat_activity where pid=$1',[pid])).rows[0];
  if(state?.wait_event_type==='Lock'){waiting=true;break}
  await new Promise(r=>setTimeout(r,20));
 }
 assert.equal(waiting,true,'Concurrent sync must wait until first identity decision commits');
 assert.equal((await setup.query('select count(*)::int n from players')).rows[0].n,1,'Ordinary reads must remain available');
 await a.query('commit');
 const result=(await second).rows[0].result;
 assert.equal(result.mapped,0);assert.equal(result.unresolved,1);
 assert.equal(result.issues[0].reason,'insufficient_identity_evidence');
 assert.deepEqual(result.issues[0].candidateIds,[1]);
 assert.equal((await setup.query('select sportmonks_id from players where id=1')).rows[0].sportmonks_id,'901');
 assert.deepEqual((await setup.query('select sportmonks_id,player_id from sportmonks_player_profiles order by sportmonks_id')).rows,
  [{sportmonks_id:'901',player_id:'1'},{sportmonks_id:'902',player_id:null}]);
 console.log('PASS: real overlapping identity syncs serialize; second provider ID cannot steal an identity, and ordinary reads are not blocked.');
}finally{
 for(const c of clients)await c.end();
 await admin.query(`drop database if exists ${name} with (force)`);
 await admin.end();
}
