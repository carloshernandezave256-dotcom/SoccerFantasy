do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'sync-live-fantasy-scores';

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'sync-live-fantasy-scores',
  '*/3 * * * *',
  $job$
    select net.http_get(
      url := 'https://soccer-fantasy.vercel.app/api/cron/scores',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'soccer_fantasy_cron_secret'
          limit 1
        )
      ),
      timeout_milliseconds := 300000
    );
  $job$
);
