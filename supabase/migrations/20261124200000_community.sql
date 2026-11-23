-- Community parts for the three audiences, all served through public_state:
--   today     today's totals (time added, people, subs, euros), reset at midnight (Romania)
--   loyal     "Fidelii": top watchers by hours, with their daily streak and badges
--   together  the free community goal: hours watched together unlock stream events
--   now       "Acum pe stream": Twitch title + game (watch-time function) or a moderator note
-- Legends are the top 5 of the running totals (boards part, already there).
-- my_state() adds the viewer's own contribution, streak, badges and last event.

-- ---------------------------------------------------------------------------
-- Night shift: minutes watched between 00:00 and 06:00 (Romania), for a badge.
-- ---------------------------------------------------------------------------
create table private.watch_night (
  twitch_id text primary key,
  minutes   integer not null default 0
);

create or replace function private.count_night_minutes()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  delta integer := new.minutes - coalesce(case when tg_op = 'UPDATE' then old.minutes end, 0);
begin
  if delta > 0 and extract(hour from now() at time zone 'Europe/Bucharest') < 6 then
    insert into private.watch_night as n (twitch_id, minutes) values (new.twitch_id, delta)
    on conflict (twitch_id) do update set minutes = n.minutes + excluded.minutes;
  end if;
  return null;
end; $$;
create trigger watch_daily_night after insert or update on public.watch_daily
  for each row execute function private.count_night_minutes();

-- ---------------------------------------------------------------------------
-- Loyalty of one viewer: hours, current and best streak (a day counts from
-- 30 minutes in chat), and badges.
-- ---------------------------------------------------------------------------
create or replace function private.loyalty(p_twitch_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  with days as (
    select day from public.watch_daily where twitch_id = p_twitch_id and minutes >= 30
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
                and w.day = (t.starts_at at time zone 'Europe/Bucharest')::date) as og
  )
  select jsonb_build_object(
    'hours', minutes / 60, 'streak', streak, 'best', best, 'days', days,
    'badges', to_jsonb(array_remove(array[
      case when og then 'og' end,
      case when night >= 60 then 'night' end,
      case when minutes >= 6000 then 'h100' when minutes >= 3000 then 'h50' when minutes >= 600 then 'h10' end,
      case when best >= 7 then 'streak7' end
    ], null)))
  from info;
$$;

-- ---------------------------------------------------------------------------
-- Free community goal (moderators edit the list on /mod).
-- ---------------------------------------------------------------------------
create table public.community_goals (
  position smallint primary key,
  title    text not null,
  hours    integer not null check (hours > 0)
);
alter table public.community_goals enable row level security;
create policy "Public read" on public.community_goals for select to anon, authenticated using (true);
grant select on public.community_goals to anon, authenticated;
-- Examples to edit on /mod.
insert into public.community_goals (position, title, hours) values
  (1, 'Chatul alege jocul pentru o oră', 250),
  (2, 'Karaoke cu chatul', 750),
  (3, 'Stream IRL în oraș', 1500),
  (4, 'Turneu cu comunitatea', 3000);

create or replace function public.mod_set_community_goals(p_goals jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  if jsonb_typeof(p_goals) <> 'array' or jsonb_array_length(p_goals) > 20 then raise exception 'bad_goals'; end if;
  delete from public.community_goals where true;
  insert into public.community_goals (position, title, hours)
  select row_number() over (order by (g ->> 'hours')::integer), left(btrim(g ->> 'title'), 120), (g ->> 'hours')::integer
  from jsonb_array_elements(p_goals) g
  where btrim(coalesce(g ->> 'title', '')) <> '' and (g ->> 'hours')::integer > 0;
end; $$;
revoke all on function public.mod_set_community_goals(jsonb) from public, anon;
grant execute on function public.mod_set_community_goals(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- "Acum pe stream": filled by the watch-time function (Twitch title, game,
-- viewers); a moderator note overrides it for a while ("Pauză 15 min").
-- ---------------------------------------------------------------------------
create table private.stream_info (
  id         smallint primary key default 1 check (id = 1),
  title      text,
  game       text,
  viewers    integer,
  started_at timestamptz,
  note       text,
  note_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into private.stream_info (id) values (1);

create or replace function public.save_stream_info(p_title text, p_game text, p_viewers integer, p_started_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  update private.stream_info set title = left(p_title, 200), game = left(p_game, 100), viewers = p_viewers,
    started_at = p_started_at, updated_at = now()
  where id = 1 and (title, game, viewers, started_at) is distinct from (left(p_title, 200), left(p_game, 100), p_viewers, p_started_at);
$$;
revoke all on function public.save_stream_info(text, text, integer, timestamptz) from public, anon, authenticated;

create or replace function public.mod_set_note(p_note text, p_minutes integer default 60)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  update private.stream_info set
    note = nullif(left(btrim(coalesce(p_note, '')), 140), ''),
    note_until = case when nullif(btrim(coalesce(p_note, '')), '') is null then null
                      else now() + make_interval(mins => least(greatest(coalesce(p_minutes, 60), 1), 1440)) end,
    updated_at = now()
  where id = 1;
end; $$;
revoke all on function public.mod_set_note(text, integer) from public, anon;
grant execute on function public.mod_set_note(text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- The new parts (compute_part is replaced with all cases).
-- ---------------------------------------------------------------------------
create index if not exists events_supporter_key_idx on public.events (lower(coalesce(nullif(user_login, ''), user_name)));

create or replace function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
  midnight timestamptz := (date_trunc('day', now() at time zone 'Europe/Bucharest')) at time zone 'Europe/Bucharest';
begin
  case p_part
  when 'timer' then
    return (select jsonb_build_object(
      'status', status, 'startsAt', starts_at, 'endsAt', ends_at, 'pausedUntil', paused_until,
      'scheduledEnd', scheduled_end, 'doubleFrom', double_from, 'doubleUntil', double_until,
      'doubleSponsor', double_sponsor, 'online', stream_online)
      from public.timer where id = 1);
  when 'stats' then
    return (select jsonb_build_object('subs', subs, 'raised', raised, 'bits', bits) from public.stats where id = 1);
  when 'feed' then
    return coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'tier', tier, 'quantity', quantity, 'currency', currency,
        'seconds', seconds_added, 'doubled', doubled, 'name', public.public_name(user_login, user_name), 'at', created_at)
      order by id desc)
      from (select * from public.events order by id desc limit 20) e), '[]'::jsonb);
  when 'boards' then
    return jsonb_build_object(
      'donations', private.top_supporters('donated'),
      'gifts', private.top_supporters('gifts'),
      'bits', private.top_supporters('bits'),
      'hours', coalesce((select jsonb_agg(jsonb_build_array(n, t) order by t desc) from (
        select n, t from (
          select public.public_name(login, display_name) as n, (minutes / 60) as t
          from public.watch_time where minutes >= 60 order by minutes desc limit 30
        ) x where n <> 'Anonim' order by t desc limit 5) y), '[]'::jsonb));
  when 'goals' then
    return coalesce((select jsonb_agg(jsonb_build_object('title', title, 'threshold', threshold, 'sponsor', sponsor,
      'unlocked', unlocked_at is not null) order by position) from public.goals), '[]'::jsonb);
  when 'vote' then
    select id, number, closes_at into r from public.vote_rounds where opens_at <= now() order by opens_at desc limit 1;
    return jsonb_build_object(
      'round', case when r.id is null then null else jsonb_build_object('id', r.id, 'number', r.number, 'closesAt', r.closes_at) end,
      'challenges', coalesce((select jsonb_agg(jsonb_build_object('id', rc.challenge_id, 'title', c.title, 'desc', c.how, 'votes', rc.votes)
          order by rc.position)
        from public.round_challenges rc join public.challenges c on c.id = rc.challenge_id where rc.round_id = r.id), '[]'::jsonb),
      'upNext', coalesce((select jsonb_agg(jsonb_build_object('title', c.title, 'round', w.number, 'won', w.won, 'total', w.total,
          'when', c.scheduled_for) order by w.number desc)
        from (select vr.number, vr.winner_id,
                     (select coalesce(sum(votes), 0) from public.round_challenges x where x.round_id = vr.id) as total,
                     (select votes from public.round_challenges x where x.round_id = vr.id and x.challenge_id = vr.winner_id) as won
              from public.vote_rounds vr where vr.winner_id is not null order by vr.number desc limit 20) w
        join public.challenges c on c.id = w.winner_id where c.status = 'scheduled'), '[]'::jsonb),
      'completed', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'doneAt', done_at, 'clip', clip_url) order by done_at desc)
        from (select title, done_at, clip_url from public.challenges where status = 'done' order by done_at desc limit 10) d), '[]'::jsonb));
  when 'prizes' then
    return coalesce((select jsonb_agg(jsonb_build_object('position', position, 'short', short_label, 'full', full_label,
      'isWin', is_win, 'sponsor', sponsor) order by position) from public.prizes), '[]'::jsonb);
  when 'wins' then
    return coalesce((select jsonb_agg(jsonb_build_object('user', public.public_name(s.user_login, null), 'prize', p.win_label,
        'sponsor', p.sponsor, 'at', s.created_at) order by s.created_at desc)
      from (select * from public.spins order by created_at desc limit 12) s
      join public.prizes p on p.position = s.prize_position where p.is_win), '[]'::jsonb);
  when 'bingo' then
    return jsonb_build_object(
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'happened', happened_at is not null) order by position)
        from public.bingo_items), '[]'::jsonb),
      'closesAt', (select closes_at from public.bingo_settings where id = 1),
      'prize', (select prize from public.bingo_settings where id = 1),
      'prizeSponsor', (select prize_sponsor from public.bingo_settings where id = 1),
      'players', coalesce((select players from public.bingo_stats()), 0));
  when 'today' then
    return (select jsonb_build_object(
      'day', (now() at time zone 'Europe/Bucharest')::date,
      'seconds', coalesce(sum(seconds_added), 0),
      'people', count(distinct lower(coalesce(nullif(user_login, ''), user_name))) filter (where coalesce(nullif(user_login, ''), user_name) is not null),
      'subs', coalesce(sum(case when kind in ('sub', 'resub') then 1 when kind = 'gift' then floor(quantity) else 0 end), 0),
      'donated', coalesce(sum(quantity) filter (where kind = 'donation'), 0),
      'bits', coalesce(sum(quantity) filter (where kind = 'bits'), 0),
      'events', count(*))
      from public.events where created_at >= midnight);
  when 'loyal' then
    return coalesce((select jsonb_agg(jsonb_build_object('name', n, 'hours', (l ->> 'hours')::integer, 'streak', (l ->> 'streak')::integer,
        'badges', l -> 'badges') order by minutes desc)
      from (select n, minutes, private.loyalty(twitch_id) as l from (
              select twitch_id, minutes, public.public_name(login, display_name) as n
              from public.watch_time where minutes >= 60 order by minutes desc limit 20) x
            where n <> 'Anonim' order by minutes desc limit 5) y), '[]'::jsonb);
  when 'together' then
    return jsonb_build_object(
      'hours', coalesce((select sum(minutes) from public.watch_time), 0) / 60,
      'goals', coalesce((select jsonb_agg(jsonb_build_object('title', title, 'hours', hours) order by hours) from public.community_goals), '[]'::jsonb));
  when 'now' then
    return (select jsonb_build_object(
      'title', title, 'game', game, 'viewers', viewers, 'startedAt', started_at,
      'note', case when note_until > now() then note end, 'noteUntil', case when note_until > now() then note_until end)
      from private.stream_info where id = 1);
  else
    raise exception 'unknown part %', p_part;
  end case;
end; $$;

drop trigger if exists state_events on public.events;
create trigger state_events after insert or update or delete on public.events
  for each statement execute function private.on_state_change('feed', 'boards', 'today');
create trigger state_watch_daily after insert or update or delete on public.watch_daily
  for each statement execute function private.on_state_change('loyal', 'together');
drop trigger if exists state_names on private.name_rules;
create trigger state_names after insert or update or delete on private.name_rules
  for each statement execute function private.on_state_change('feed', 'boards', 'wins', 'loyal');
create trigger state_community_goals after insert or update or delete on public.community_goals
  for each statement execute function private.on_state_change('together');
create trigger state_stream_info after insert or update or delete on private.stream_info
  for each statement execute function private.on_state_change('now');

select private.refresh_parts(array['today', 'loyal', 'together', 'now']);
-- Midnight resets "today"; a moderator note expires on its own.
select cron.alter_job((select jobid from cron.job where jobname = 'icemaraton-state'),
  command := $$select private.refresh_parts(array['vote', 'timer', 'today', 'now'])$$);

-- ---------------------------------------------------------------------------
-- The viewer's own state now includes their contribution and loyalty.
-- ---------------------------------------------------------------------------
create or replace function public.my_state(p_round integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.viewers%rowtype;
  w jsonb;
  t private.supporter_totals%rowtype;
  last_ev record;
begin
  select * into v from public.viewers where id = auth.uid();
  if not found then return null; end if;
  select to_jsonb(x) into w from public.wheel_status() x limit 1;
  w := coalesce(w, '{}'::jsonb);
  select * into t from private.supporter_totals where key = lower(v.login);
  select id, kind, quantity, seconds_added, created_at into last_ev from public.events
    where (v.twitch_id is not null and user_id = v.twitch_id)
       or lower(coalesce(nullif(user_login, ''), user_name)) = lower(v.login)
    order by id desc limit 1;
  return jsonb_build_object(
    'name', coalesce(v.display_name, v.login),
    'login', v.login,
    'isSub', v.is_subscriber,
    'subCheckedAt', v.sub_checked_at,
    'public', not exists (select 1 from private.name_rules where key = lower(v.login) and rule = 'opt_out'),
    'spins', coalesce((w ->> 'spins_available')::integer, 0),
    'minutesToday', coalesce((w ->> 'minutes_today')::integer, 0),
    'spunToday', coalesce((w ->> 'spun_today')::boolean, false),
    'bonusSpins', coalesce((w ->> 'bonus_spins')::integer, 0),
    'myVote', (select challenge_id from public.votes where round_id = p_round and viewer_id = v.id),
    'bingo', (select to_jsonb(items) from public.bingo_picks where viewer_id = v.id),
    'mine', jsonb_build_object('seconds', coalesce(t.seconds, 0), 'subs', coalesce(t.subs, 0), 'gifts', coalesce(t.gifts, 0),
                               'bits', coalesce(t.bits, 0), 'donated', coalesce(t.donated, 0)),
    'loyalty', case when v.twitch_id is null then null else private.loyalty(v.twitch_id) end,
    'lastEvent', case when last_ev.id is null then null else jsonb_build_object('id', last_ev.id, 'kind', last_ev.kind,
                 'quantity', last_ev.quantity, 'seconds', last_ev.seconds_added, 'at', last_ev.created_at) end);
end; $$;
revoke all on function public.my_state(integer) from public, anon;
grant execute on function public.my_state(integer) to authenticated;
