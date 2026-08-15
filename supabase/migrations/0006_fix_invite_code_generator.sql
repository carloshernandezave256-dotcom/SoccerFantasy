create or replace function public.create_league(p_name text,p_team_name text,p_size smallint)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_id uuid;v_code text;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  if p_size not in(8,10,12) then raise exception 'League size must be 8, 10, or 12';end if;
  v_code:='XI-'||upper(substr(encode(extensions.gen_random_bytes(6),'hex'),1,6));
  insert into public.leagues(name,invite_code,size,commissioner_id) values(trim(p_name),v_code,p_size,v_user) returning id into v_id;
  insert into public.league_members(league_id,user_id,team_name,role,draft_slot) values(v_id,v_user,trim(p_team_name),'commissioner',1);
  return v_id;
end$$;
revoke all on function public.create_league(text,text,smallint) from public,anon;
grant execute on function public.create_league(text,text,smallint) to authenticated;
