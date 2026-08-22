-- Wake every two minutes. The endpoint itself exits before calling
-- API-Football unless a cached fixture is inside its possible live window.
select cron.alter_job(
  job_id := (
    select jobid from cron.job
    where jobname='sync-live-fantasy-scores'
  ),
  schedule := '*/2 * * * *'
);
