alter table public.profiles
  add column if not exists beta_access_granted_at timestamptz;

-- Everyone who already had an account before the closed-beta gate is grandfathered in.
update public.profiles
set beta_access_granted_at = now()
where beta_access_granted_at is null;

create or replace function public.my_beta_access_status()
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.beta_access_granted_at is not null
  )
$$;

revoke all on function public.my_beta_access_status() from public, anon;
grant execute on function public.my_beta_access_status() to authenticated;
