-- Daily check-in with channel points: when a viewer redeems the custom reward
-- "Check-in ICEMARATON" on Twitch (EventSub → twitch-eventsub), that day
-- counts toward their streak even if they watched less than 30 minutes.
-- Also: Twitch's channel.update notification updates "Acum pe stream" at once.

create table private.checkins (
  twitch_id  text not null,
  day        date not null,
  login      text,
  created_at timestamptz not null default now(),
  primary key (twitch_id, day)
);

create or replace function public.record_checkin(p_user_id text, p_login text, p_name text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_user_id is null then return false; end if;
  insert into private.checkins (twitch_id, day, login)
  values (p_user_id, (now() at time zone 'Europe/Bucharest')::date, lower(p_login))
  on conflict do nothing;
  get diagnostics n = row_count;
  -- Keep a name for them even if they never chatted (for the Fidelii list).
  insert into public.watch_time (twitch_id, login, display_name, minutes) values (p_user_id, lower(p_login), p_name, 0)
  on conflict (twitch_id) do nothing;
  if n > 0 then perform private.refresh_parts(array['loyal']); end if;
  return n > 0;
end; $$;
revoke all on function public.record_checkin(text, text, text) from public, anon, authenticated;

create or replace function public.save_stream_title(p_title text, p_game text)
returns void language sql security definer set search_path = '' as $$
  update private.stream_info set title = left(p_title, 200), game = left(p_game, 100), updated_at = now()
  where id = 1 and (title, game) is distinct from (left(p_title, 200), left(p_game, 100));
$$;
revoke all on function public.save_stream_title(text, text) from public, anon, authenticated;

-- A day counts for the streak with 30+ minutes in chat OR a check-in.
create or replace function private.loyalty(p_twitch_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with days as (
    select day from public.watch_daily where twitch_id = p_twitch_id and minutes >= 30
    union
    select day from private.checkins where twitch_id = p_twitch_id
  ), islands as (
    select min(day) as first_day, max(day) as last_day, count(*)::integer as len
    from (select day, day - (row_number() over (order by day))::integer as grp from days) x
    group by grp
  ), today as (
    select (now() at time zone 'Europe/Bucharest')::date as d
  ), info as (
    select
      coalesce((select minutes from public.watch_time where twitch_id = p_twitch_id), 0) as minutes,
      coalesce((select len from islands, today where last_day >= today.d - 1 order by last_day desc limit 1), 0) as streak,
      coalesce((select max(len) from islands), 0) as best,
      (select count(*)::integer from days) as days,
      coalesce((select minutes from private.watch_night where twitch_id = p_twitch_id), 0) as night,
      exists (select 1 from public.watch_daily w, public.timer t
              where w.twitch_id = p_twitch_id and t.id = 1 and t.starts_at is not null
                and w.day = (t.starts_at at time zone 'Europe/Bucharest')::date) as og,
      (select count(*)::integer from private.checkins where twitch_id = p_twitch_id) as checkins
  )
  select jsonb_build_object(
    'hours', minutes / 60, 'streak', streak, 'best', best, 'days', days, 'checkins', checkins,
    'badges', to_jsonb(array_remove(array[
      case when og then 'og' end,
      case when night >= 60 then 'night' end,
      case when minutes >= 6000 then 'h100' when minutes >= 3000 then 'h50' when minutes >= 600 then 'h10' end,
      case when best >= 7 then 'streak7' end
    ], null)))
  from info;
$$;
