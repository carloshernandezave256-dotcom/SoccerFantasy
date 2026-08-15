-- A league's chosen domestic competition defines its fantasy gameweek calendar.
alter table public.leagues
  add column calendar_competition text not null default 'Premier League';

alter table public.leagues add constraint leagues_calendar_competition_check
  check (calendar_competition in ('Premier League','La Liga','Serie A','Bundesliga','Ligue 1'));

create or replace function public.prevent_calendar_competition_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.calendar_competition<>new.calendar_competition then
    raise exception 'The Fantasy Calendar is locked for the season and cannot be changed';
  end if;
  return new;
end$$;

create trigger prevent_calendar_competition_change
before update of calendar_competition on public.leagues
for each row execute function public.prevent_calendar_competition_change();

drop function if exists public.create_league(text,text,smallint,smallint,boolean,smallint,text);
create function public.create_league(
  p_name text,
  p_team_name text,
  p_size smallint,
  p_draft_pick_seconds smallint,
  p_trades_enabled boolean,
  p_lineup_lock_minutes smallint,
  p_game_format text,
  p_calendar_competition text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  if p_draft_pick_seconds not in(30,60,90,120) then raise exception 'Choose a valid draft clock';end if;
  if p_lineup_lock_minutes not in(0,15,30,60) then raise exception 'Choose a valid lineup lock time';end if;
  if p_game_format not in('draft','pack') then raise exception 'Choose Draft League or Pack League';end if;
  if p_calendar_competition not in('Premier League','La Liga','Serie A','Bundesliga','Ligue 1') then raise exception 'Choose one of the five supported Fantasy Calendars';end if;
  v_code:='XI-'||upper(substr(md5(gen_random_uuid()::text),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id,draft_pick_seconds,trades_enabled,lineup_lock_minutes,game_format,calendar_competition)
  values(trim(p_name),v_code,p_size,v_user,p_draft_pick_seconds,p_trades_enabled,p_lineup_lock_minutes,p_game_format,p_calendar_competition) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot) values(v_id,v_user,trim(p_team_name),'commissioner',1);
  if p_game_format='pack' then insert into public.pack_wallets(league_id,user_id) values(v_id,v_user); end if;
  return v_id;
end$$;

drop function if exists public.league_settings(uuid);
create function public.league_settings(p_league_id uuid)
returns table(
  league_name text,
  joining_open boolean,
  draft_pick_seconds smallint,
  trades_enabled boolean,
  lineup_lock_minutes smallint,
  motm_manual boolean,
  calendar_competition text
)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.league_members where league_id=p_league_id and user_id=(select auth.uid())) then
    raise exception 'League membership required';
  end if;
  return query select l.name,l.joining_open,l.draft_pick_seconds,l.trades_enabled,l.lineup_lock_minutes,l.motm_manual,l.calendar_competition
  from public.leagues l where l.id=p_league_id;
end$$;

revoke all on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text),public.league_settings(uuid) from public,anon;
grant execute on function public.create_league(text,text,smallint,smallint,boolean,smallint,text,text),public.league_settings(uuid) to authenticated;
revoke all on function public.prevent_calendar_competition_change() from public,anon,authenticated;

comment on column public.leagues.calendar_competition is
  'Season-locked domestic competition whose official matchweeks define fantasy scoring windows and bye weeks.';
