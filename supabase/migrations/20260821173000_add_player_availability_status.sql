alter table public.players
  add column if not exists injured boolean not null default false,
  add column if not exists injury_type text,
  add column if not exists injury_reason text,
  add column if not exists expected_return date,
  add column if not exists injury_updated_at timestamptz;

comment on column public.players.injured is 'Current API-Football injury or suspension availability flag.';
comment on column public.players.injury_type is 'Current API-Football availability type, such as Injury or Suspension.';
comment on column public.players.injury_reason is 'Current API-Football injury/suspension reason when supplied.';
comment on column public.players.expected_return is 'Provider-derived expected/end date from API-Football sidelined data when supplied.';
