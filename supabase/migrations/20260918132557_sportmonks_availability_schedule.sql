-- Preserve the existing six-hour cadence while making the provider explicit.
do $$
declare job_id bigint; job_schedule text; job_command text;
begin
 select jobid,schedule,replace(command,'/api/football/sync/fotmob-returns','/api/football/sync/injuries')
 into job_id,job_schedule,job_command from cron.job where jobname='refresh-fotmob-availability-backup';
 if job_id is not null then
  perform cron.unschedule(job_id);
  perform cron.schedule('refresh-sportmonks-availability',job_schedule,job_command);
 end if;
end $$;
