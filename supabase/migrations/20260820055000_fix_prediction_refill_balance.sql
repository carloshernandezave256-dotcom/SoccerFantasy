create or replace function public.claim_prediction_refill(p_league_id uuid)
returns table(balance integer,granted integer,next_refill_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_week date := date_trunc('week',now() at time zone 'UTC')::date;
  v_granted integer := 0;
  v_balance integer;
  v_last_refill date;
begin
  if v_user is null or not private.is_league_member(p_league_id) then
    raise exception 'Join this league before making predictions';
  end if;

  insert into public.prediction_wallets(league_id,user_id,balance,last_refill_week)
  values(p_league_id,v_user,0,null)
  on conflict(league_id,user_id) do nothing;

  select w.balance,w.last_refill_week
  into v_balance,v_last_refill
  from public.prediction_wallets w
  where w.league_id=p_league_id and w.user_id=v_user
  for update;

  if v_last_refill is null or v_last_refill<v_week then
    v_granted:=greatest(0,least(100,300-v_balance));
    update public.prediction_wallets as w
    set balance=w.balance+v_granted,last_refill_week=v_week,updated_at=now()
    where w.league_id=p_league_id and w.user_id=v_user
    returning w.balance into v_balance;
  end if;

  if v_granted>0 then
    insert into public.prediction_token_ledger(league_id,user_id,amount,reason,reference_id)
    values(p_league_id,v_user,v_granted,'weekly_refill',gen_random_uuid());
  end if;

  return query select v_balance,v_granted,(v_week+7)::timestamp at time zone 'UTC';
end;
$$;
