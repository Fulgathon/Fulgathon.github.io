-- Project renamed FULGATHON -> ICEMARATON: the scheduled jobs' names and the
-- name shown on manual time entries. The jobs keep their schedule and command.
select cron.schedule('icemaraton-minute', schedule, command) from cron.job where jobname = 'fulgathon-minute';
select cron.unschedule('fulgathon-minute') from cron.job where jobname = 'fulgathon-minute';
select cron.schedule('icemaraton-watch-time', schedule, command) from cron.job where jobname = 'fulgathon-watch-time';
select cron.unschedule('fulgathon-watch-time') from cron.job where jobname = 'fulgathon-watch-time';

-- Same as in 20261120100000_go_live.sql, with the new name.
create or replace function public.mod_add_time(p_minutes numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if (select status from public.timer where id = 1) <> 'live' then
    raise exception 'timer_not_live' using errcode = 'P0001';
  end if;
  perform public.record_event('manual', 'manual', null, null, null, 'ICEMARATON', null, 1, null, round(p_minutes * 60)::integer);
end; $$;

update public.events set user_name = 'ICEMARATON' where user_name = 'FULGATHON';
