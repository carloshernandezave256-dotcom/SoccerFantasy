create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='refresh-fotmob-availability-backup';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end
$$;

-- FotMob is a secondary availability feed. Four checks per day are enough to
-- catch newly reported injuries between API-Football refreshes without making
-- it part of the high-frequency live-score path.
select cron.schedule(
  'refresh-fotmob-availability-backup',
  '37 */6 * * *',
  $job$
    select net.http_post(
      url := 'https://myfantasyxi.com/api/football/sync/fotmob-returns',
      headers := jsonb_build_object(
        'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='soccer_fantasy_cron_secret' limit 1),
        'Content-Type','application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
  $job$
);
