begin;

create or replace function public.reorder_waiver_claims(p_league_id uuid,p_claim_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare
  v_user uuid:=(select auth.uid());
  v_week integer;
  v_count integer;
  v_offset integer;
begin
  if v_user is null then raise exception 'Authentication required';end if;
  select gameweek into v_week
  from public.league_transaction_windows
  where league_id=p_league_id and now()<waiver_process_at
  order by gameweek desc limit 1;
  if v_week is null then raise exception 'Waiver claims are closed';end if;

  select count(*),coalesce(max(claim_rank),0)+count(*)+1
  into v_count,v_offset
  from public.waiver_claims
  where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';

  if v_count<>coalesce(cardinality(p_claim_ids),0)
    or cardinality(p_claim_ids)<>cardinality(array(select distinct unnest(p_claim_ids)))
    or exists(
      select 1 from unnest(p_claim_ids) x
      left join public.waiver_claims c on c.id=x
      where c.id is null or c.league_id<>p_league_id or c.gameweek<>v_week or c.user_id<>v_user or c.status<>'pending'
    ) then raise exception 'Submit every pending claim exactly once';
  end if;

  -- Keep the temporary ranks positive and outside the current rank range so both
  -- the positive-rank check and pending-rank unique index remain valid.
  update public.waiver_claims
  set claim_rank=claim_rank+v_offset
  where league_id=p_league_id and gameweek=v_week and user_id=v_user and status='pending';

  update public.waiver_claims c
  set claim_rank=o.rank
  from unnest(p_claim_ids) with ordinality o(id,rank)
  where c.id=o.id and c.league_id=p_league_id and c.gameweek=v_week and c.user_id=v_user and c.status='pending';
end$$;

revoke all on function public.reorder_waiver_claims(uuid,uuid[]) from public,anon;
grant execute on function public.reorder_waiver_claims(uuid,uuid[]) to authenticated;

commit;
