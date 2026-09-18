-- Explicit provenance prevents legacy provider flags from surviving a SportMonks refresh.
alter table public.players
 add column if not exists injury_source text,
 add column if not exists injury_started_at date,
 add column if not exists injury_provider_record jsonb;
comment on column public.players.injury_source is 'Provider of the latest availability assessment; null means no provider assessment.';
