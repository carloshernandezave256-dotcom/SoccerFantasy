alter table public.players add column if not exists doubtful_checked_at timestamptz,
 add column if not exists doubtful_until timestamptz;
create or replace function public.apply_doubtful_report(p_competition text,p_ids bigint[],p_checked_at timestamptz,p_clear_missing boolean)
returns integer language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'Server access required'; end if;
 if p_competition not in ('Premier League','La Liga','Serie A','Bundesliga','Ligue 1') or p_checked_at is null or p_checked_at>now()+interval '5 minutes' or p_checked_at<now()-interval '10 minutes' then raise exception 'Invalid doubtful report'; end if;
 if p_ids is null or exists(select 1 from unnest(p_ids) i where not exists(select 1 from public.players p where p.id=i and p.competition=p_competition)) then raise exception 'Invalid player mapping'; end if;
 update public.players set doubtful_checked_at=p_checked_at,
  doubtful_until=case when id=any(p_ids) then p_checked_at+interval '48 hours' else null end
 where competition=p_competition and (id=any(p_ids) or (p_clear_missing and doubtful_until is not null))
 and (doubtful_checked_at is null or doubtful_checked_at<=p_checked_at);
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.apply_doubtful_report(text,bigint[],timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.apply_doubtful_report(text,bigint[],timestamptz,boolean) to service_role;
