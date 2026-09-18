import {expect,it} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
it('saves warnings without changing injuries or positions, preserves partial reports, rejects older writes',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create function auth.jwt() returns jsonb language sql as $$select '{"role":"service_role"}'::jsonb$$;create table players(id bigint primary key,competition text,injured boolean,position text);insert into players values(1,'Premier League',false,'MID'),(2,'Premier League',true,'DEF');`);
 await db.exec(await readFile('supabase/migrations/20260918151331_player_doubtful_warnings.sql','utf8'));
 await db.exec(`select apply_doubtful_report('Premier League',array[1,2]::bigint[],now(),true)`);
 let r=(await db.query<Record<string,unknown>>('select * from players order by id')).rows;
 expect(r[0].doubtful_until).toBeTruthy();expect(r[0].injured).toBe(false);expect(r[1].injured).toBe(true);expect(r[1].position).toBe('DEF');
 await db.exec(`select apply_doubtful_report('Premier League',array[]::bigint[],now()-interval '1 minute',true)`);
 expect((await db.query<Record<string,unknown>>('select doubtful_until from players where id=1')).rows[0].doubtful_until).toBeTruthy();
 await db.exec(`select apply_doubtful_report('Premier League',array[1]::bigint[],now(),false)`);
 expect((await db.query<Record<string,unknown>>('select doubtful_until from players where id=2')).rows[0].doubtful_until).toBeTruthy();
 await db.exec(`select apply_doubtful_report('Premier League',array[1]::bigint[],now(),true)`);
 expect((await db.query<Record<string,unknown>>('select doubtful_until from players where id=2')).rows[0].doubtful_until).toBeNull();
 await db.exec('set role authenticated');await expect(db.query<Record<string,unknown>>(`select apply_doubtful_report('Premier League',array[]::bigint[],now(),true)`)).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
},15000);
