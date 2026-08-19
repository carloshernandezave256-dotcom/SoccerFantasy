alter table public.profiles
  add column if not exists legal_disclosure_version text,
  add column if not exists legal_disclosure_accepted_at timestamptz;

create or replace function public.my_legal_disclosure_status()
returns table(legal_disclosure_version text, legal_disclosure_accepted_at timestamptz)
language sql
security definer
set search_path = ''
as $$
  select profile.legal_disclosure_version, profile.legal_disclosure_accepted_at
  from public.profiles profile
  where profile.id = (select auth.uid())
$$;

create or replace function public.accept_legal_disclosure(p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;
  if p_version <> 'beta-1.0' then
    raise exception 'This disclosure version is not current';
  end if;

  update public.profiles
  set legal_disclosure_version = p_version,
      legal_disclosure_accepted_at = now()
  where id = (select auth.uid());

  if not found then
    raise exception 'Account profile not found';
  end if;
end
$$;

revoke all on function public.my_legal_disclosure_status() from public, anon;
revoke all on function public.accept_legal_disclosure(text) from public, anon;
grant execute on function public.my_legal_disclosure_status() to authenticated;
grant execute on function public.accept_legal_disclosure(text) to authenticated;
