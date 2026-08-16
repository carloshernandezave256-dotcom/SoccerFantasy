create function public.delete_league(p_league_id uuid,p_confirm_name text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid());v_name text;
begin
  select l.name into v_name from public.leagues l
  where l.id=p_league_id and l.commissioner_id=v_user for update;
  if not found then raise exception 'Only the commissioner can delete this league';end if;
  if trim(p_confirm_name)<>v_name then raise exception 'League name confirmation did not match';end if;
  delete from public.leagues where id=p_league_id;
  return true;
end$$;

revoke all on function public.delete_league(uuid,text) from public,anon;
grant execute on function public.delete_league(uuid,text) to authenticated;
comment on function public.delete_league(uuid,text) is 'Commissioner-only permanent league deletion; dependent league activity cascades.';
