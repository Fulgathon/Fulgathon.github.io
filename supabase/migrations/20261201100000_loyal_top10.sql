-- Fidelii shows the top 10 regulars (owner, 24 Nov 2026), not 5. Same compute_part as
-- 20261125100000_layout_v2.sql plus its own 'loyal' case; everything else is unchanged.

create or replace function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  start_day date := (select (starts_at at time zone 'Europe/Bucharest')::date from public.timer where id = 1);
begin
  case p_part
  when 'feed' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'tier', tier, 'quantity', quantity, 'currency', currency,
        'seconds', seconds_added, 'doubled', doubled, 'name', public.public_name(user_login, user_name), 'at', created_at,
        'line', bubble_line)
      order by id desc)
      from (select * from public.events order by id desc limit 20) e), '[]'::jsonb);
  when 'goals' then
    return coalesce((select jsonb_agg(jsonb_build_object('title', title, 'threshold', threshold, 'sponsor', sponsor,
      'unlocked', unlocked_at is not null, 'doneAt', done_at, 'clip', clip_url, 'when', scheduled_for) order by position)
      from public.goals), '[]'::jsonb);
  when 'lines' then
    return jsonb_build_object(
      'groups', coalesce((select jsonb_object_agg(grp, lines) from (
        select grp, jsonb_agg(line order by position) as lines from public.iceman_lines group by grp) g), '{}'::jsonb),
      'smallDonation', (select small_donation from private.bubble_settings where id = 1));
  when 'advent' then
    return coalesce((select jsonb_agg(jsonb_build_object('day', day, 'note', note, 'clip', clip_url, 'sponsor', sponsor) order by day)
      from public.advent_days), '[]'::jsonb);
  when 'badges' then
    return jsonb_build_object(
      'og', case when start_day is null then 0 else
              (select count(distinct twitch_id) from public.watch_daily where day = start_day) end,
      'h10', (select count(*) from public.watch_time where minutes >= 600),
      'h50', (select count(*) from public.watch_time where minutes >= 3000),
      'h100', (select count(*) from public.watch_time where minutes >= 6000),
      'night', (select count(*) from private.watch_night where minutes >= 60),
      'streak7', (select count(*) from (
        select twitch_id from (
          select twitch_id, day - (row_number() over (partition by twitch_id order by day))::integer as grp
          from (select twitch_id, day from public.watch_daily where minutes >= 30
                union select twitch_id, day from private.checkins) d
        ) x group by twitch_id, grp having count(*) >= 7
      ) y));
  when 'loyal' then
    -- Fidelii: the top 10 by minutes in chat (was 5), hidden names skipped.
    return coalesce((select jsonb_agg(jsonb_build_object('name', n, 'hours', (l ->> 'hours')::integer, 'streak', (l ->> 'streak')::integer,
        'badges', l -> 'badges') order by minutes desc)
      from (select n, minutes, private.loyalty(twitch_id) as l from (
              select twitch_id, minutes, public.public_name(login, display_name) as n
              from public.watch_time where minutes >= 60 order by minutes desc limit 40) x
            where n <> 'Anonim' order by minutes desc limit 10) y), '[]'::jsonb);
  else
    return private.compute_part_base(p_part);
  end case;
end; $$;

select private.refresh_parts(array['loyal']);
