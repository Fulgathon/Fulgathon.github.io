-- Health panel for /mod: is everything still arriving? One call returns the
-- last TipeeeStream poll, the last watch-time run, the last Twitch event,
-- each scheduled job's last run, and recent failed calls to the Edge
-- Functions. /mod turns these into green / amber / red.

create or replace function public.mod_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  return jsonb_build_object(
    'now', now(),
    'timer', (select jsonb_build_object('status', status, 'online', stream_online) from public.timer where id = 1),
    'tipeee', (select jsonb_build_object('lastRun', last_run, 'lastCount', last_count, 'error', last_error, 'started', started) from private.tipeee_state limit 1),
    'watch', (select jsonb_build_object('lastRun', max(at), 'chatters', (select chatters from public.stream_samples order by at desc limit 1)) from public.stream_samples),
    'twitch', (select jsonb_build_object('lastEvent', max(created_at)) from public.events where source = 'twitch'),
    'donation', (select jsonb_build_object('lastEvent', max(created_at)) from public.events where source = 'donation'),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.jobname, 'status', d.status, 'at', d.start_time,
        'message', left(coalesce(d.return_message, ''), 160)) order by j.jobname)
      from cron.job j
      left join lateral (select status, start_time, return_message from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
      where j.jobname like 'icemaraton%'), '[]'::jsonb),
    'httpErrors', coalesce((select jsonb_agg(jsonb_build_object('status', status_code, 'error', left(coalesce(error_msg, ''), 160), 'at', created) order by created desc)
      from (select status_code, error_msg, created from net._http_response
            where created > now() - interval '30 minutes' and (status_code is null or status_code >= 400)
            order by created desc limit 10) x), '[]'::jsonb),
    'httpCalls', (select count(*) from net._http_response where created > now() - interval '30 minutes')
  );
end; $$;
revoke all on function public.mod_health() from public, anon;
grant execute on function public.mod_health() to authenticated;

-- cron.job_run_details grows by ~6,000 rows a day (TipeeeStream every 15 s): keep 3 days.
select cron.schedule('icemaraton-cron-cleanup', '23 4 * * *', $$delete from cron.job_run_details where end_time < now() - interval '3 days'$$);
