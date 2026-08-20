create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='sync-live-fantasy-scores';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  select jobid into existing_job from cron.job where jobname='refresh-football-schedules';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;

-- The endpoint wakes every three minutes, but its cache gate makes zero external
-- football requests unless a known fixture is inside its possible live window.
select cron.schedule(
  'sync-live-fantasy-scores',
  '*/3 * * * *',
  $job$
    select net.http_get(
      url := 'https://myfantasyxi.com/api/cron/scores',
      headers := jsonb_build_object(
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='soccer_fantasy_cron_secret' limit 1)
      ),
      timeout_milliseconds := 300000
    );
  $job$
);

-- Five provider requests per day: one complete schedule for each supported real
-- competition, shared by every current and future fantasy league.
select cron.schedule(
  'refresh-football-schedules',
  '17 8 * * *',
  $job$
    select net.http_get(
      url := 'https://myfantasyxi.com/api/cron/schedules',
      headers := jsonb_build_object(
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='soccer_fantasy_cron_secret' limit 1)
      ),
      timeout_milliseconds := 300000
    );
  $job$
);
