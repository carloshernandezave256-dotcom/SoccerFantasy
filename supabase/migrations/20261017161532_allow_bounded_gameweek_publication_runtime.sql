-- Publishing and settling a complete top-five pool can exceed the API default of 8 seconds.
-- Give only the existing server-only publication RPC a bounded 45-second budget.
alter function public.publish_gameweek_scores(uuid,smallint,jsonb,jsonb) set statement_timeout = '45s';
notify pgrst, 'reload schema';
notify pgrst, 'reload config';
