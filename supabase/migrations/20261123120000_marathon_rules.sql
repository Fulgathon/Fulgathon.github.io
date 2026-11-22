-- Owner's notes, 23 Nov 2026:
--   * Time rates: Tier 1/Prime +6 min, Tier 2 +12, Tier 3 +18, gift +6 each,
--     400 bits +4 min, 1 € +6 min.
--   * Dates: 20 Dec 2026 12:00 → scheduled end 10 Jan 2027 12:00 (Romania).
--   * "Milestone Maraton": the goals are unlocked by the donation total (€),
--     and moderators edit the list on /mod.
--   * Wheel: subscribers who watched 2+ hours that day (Romania time) get one
--     spin per day, while the marathon is live. Snowflakes are no longer used.
--   * Donors leaderboard.

-- Rates ---------------------------------------------------------------------
update public.rates set seconds = 360,  per = 1   where key = 'tier1';
update public.rates set seconds = 720,  per = 1   where key = 'tier2';
update public.rates set seconds = 1080, per = 1   where key = 'tier3';
update public.rates set seconds = 360,  per = 1   where key = 'gift';
update public.rates set seconds = 240,  per = 400 where key = 'bits';
update public.rates set seconds = 360,  per = 1, label = 'Donație 1 €' where key = 'donation';

-- Dates (only while the marathon hasn't started) ----------------------------
update public.timer
  set starts_at = '2026-12-20 12:00:00 Europe/Bucharest',
      scheduled_end = '2027-01-10 12:00:00 Europe/Bucharest',
      updated_at = now()
  where id = 1 and status = 'upcoming';

-- Milestones by donations ---------------------------------------------------
comment on table public.goals is 'Milestone Maraton: threshold = donation total in euros';
-- Same titles as before as placeholders; amounts are now euros. Moderators edit them on /mod.
update public.goals set unlocked_at = null
  where threshold > (select raised from public.stats where id = 1);

create or replace function public.record_event(
  p_source       text,
  p_kind         text,
  p_external_id  text    default null,
  p_user_id      text    default null,
  p_user_login   text    default null,
  p_user_name    text    default null,
  p_tier         text    default null,
  p_quantity     numeric default 1,
  p_currency     text    default null,
  p_seconds      integer default null   -- manual adjustments only (can be negative)
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  t         public.timer%rowtype;
  r         public.rates%rowtype;
  ev        public.events%rowtype;
  rate_key  text;
  secs      integer := 0;
  doubled   boolean := false;
begin
  -- Serialise all time changes on the single timer row.
  select * into t from public.timer where id = 1 for update;

  if p_external_id is not null then
    select * into ev from public.events where external_id = p_external_id;
    if found then
      return ev;  -- already processed
    end if;
  end if;

  if p_kind = 'manual' then
    secs := coalesce(p_seconds, 0);
  else
    rate_key := case
      when p_kind in ('sub', 'resub') then
        case coalesce(p_tier, '1000') when '2000' then 'tier2' when '3000' then 'tier3' else 'tier1' end
      when p_kind in ('gift', 'bits', 'donation') then p_kind
    end;
    select * into r from public.rates where key = rate_key;
    if found then
      secs := floor(coalesce(p_quantity, 0) / r.per * r.seconds);
    end if;
  end if;

  if t.status <> 'live' or t.ends_at is null then
    secs := 0;
  elsif secs > 0 and now() >= t.double_from and now() < t.double_until then
    secs := secs * 2;
    doubled := true;
  end if;

  if secs <> 0 then
    update public.timer
      set ends_at = ends_at + make_interval(secs => secs), updated_at = now()
      where id = 1;
  end if;

  update public.stats set
    subs = subs + case
      when p_kind in ('sub', 'resub') then 1
      when p_kind = 'gift' then floor(coalesce(p_quantity, 0))::integer
      else 0 end,
    bits = bits + case when p_kind = 'bits' then floor(coalesce(p_quantity, 0))::integer else 0 end,
    raised = raised + case when p_kind = 'donation' then coalesce(p_quantity, 0) else 0 end,
    updated_at = now()
  where id = 1;

  -- Milestone Maraton: unlocked by the donation total (euros).
  update public.goals
    set unlocked_at = now()
    where unlocked_at is null
      and threshold <= (select s.raised from public.stats s where s.id = 1);

  insert into public.events (source, kind, external_id, user_id, user_login, user_name, tier, quantity, currency, seconds_added, doubled)
  values (p_source, p_kind, p_external_id, p_user_id, lower(p_user_login), p_user_name, p_tier, coalesce(p_quantity, 1), p_currency, secs, doubled)
  returning * into ev;

  return ev;
end;
$$;

-- Replace the whole list (title + € amount per milestone), sorted by amount.
-- Milestones already reached keep their unlock time; newly reachable ones unlock now.
create or replace function public.mod_set_goals(p_goals jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old     jsonb;
  total   numeric;
begin
  perform private.require_moderator();
  if jsonb_typeof(p_goals) is distinct from 'array' or jsonb_array_length(p_goals) > 40 then
    raise exception 'bad_goals' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_goals) g
    where coalesce(btrim(g ->> 'title'), '') = '' or length(g ->> 'title') > 140
       or coalesce(g ->> 'threshold', '') !~ '^[0-9]{1,7}$' or (g ->> 'threshold')::integer <= 0
  ) then
    raise exception 'bad_goals' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(title || '|' || threshold, unlocked_at), '{}'::jsonb) into old
    from public.goals where unlocked_at is not null;
  select s.raised into total from public.stats s where s.id = 1;

  delete from public.goals where true;
  insert into public.goals (position, title, threshold, unlocked_at)
  select (row_number() over (order by (g ->> 'threshold')::integer))::smallint,
         btrim(g ->> 'title'),
         (g ->> 'threshold')::integer,
         case when (g ->> 'threshold')::integer <= total
              then coalesce((old ->> (btrim(g ->> 'title') || '|' || (g ->> 'threshold')))::timestamptz, now()) end
  from jsonb_array_elements(p_goals) g;
exception when unique_violation then
  raise exception 'duplicate_amount' using errcode = 'P0001';
end; $$;

-- Daily wheel ---------------------------------------------------------------
create table public.watch_daily (
  twitch_id  text not null,
  day        date not null,
  minutes    integer not null default 0 check (minutes >= 0),
  primary key (twitch_id, day)
);
alter table public.watch_daily enable row level security;
revoke all on public.watch_daily from anon, authenticated;
grant all on public.watch_daily to service_role;

-- Watch time from chat presence: total minutes (leaderboard) and minutes per
-- Romanian calendar day (wheel).
create or replace function public.credit_watch_time(p_viewers jsonb, p_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  credited integer;
  today    date := (now() at time zone 'Europe/Bucharest')::date;
begin
  if p_minutes is null or p_minutes <= 0 or p_minutes > 60 then
    raise exception 'p_minutes must be between 1 and 60';
  end if;

  with input as (
    select distinct on (x ->> 'id') x ->> 'id' as id, lower(x ->> 'login') as login, x ->> 'name' as name
    from jsonb_array_elements(coalesce(p_viewers, '[]'::jsonb)) as x
    where x ->> 'id' is not null and x ->> 'login' is not null
  )
  insert into public.watch_time as w (twitch_id, login, display_name, minutes)
  select id, login, name, p_minutes from input
  on conflict (twitch_id) do update set
    minutes = w.minutes + excluded.minutes,
    login = excluded.login,
    display_name = coalesce(excluded.display_name, w.display_name),
    updated_at = now();
  get diagnostics credited = row_count;

  insert into public.watch_daily as d (twitch_id, day, minutes)
  select distinct on (x ->> 'id') x ->> 'id', today, p_minutes
  from jsonb_array_elements(coalesce(p_viewers, '[]'::jsonb)) as x
  where x ->> 'id' is not null and x ->> 'login' is not null
  on conflict (twitch_id, day) do update set minutes = d.minutes + excluded.minutes;

  return credited;
end;
$$;

drop function if exists public.wheel_status();
create function public.wheel_status()
returns table (is_subscriber boolean, minutes_today integer, minutes_needed integer, spun_today boolean, spins_available integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select v.twitch_id, v.is_subscriber,
           coalesce((select d.minutes from public.watch_daily d
                     where d.twitch_id = v.twitch_id and d.day = (now() at time zone 'Europe/Bucharest')::date), 0) as minutes_today,
           exists (select 1 from public.spins s
                   where s.twitch_id = v.twitch_id
                     and (s.created_at at time zone 'Europe/Bucharest')::date = (now() at time zone 'Europe/Bucharest')::date) as spun_today
    from public.viewers v where v.id = (select auth.uid())
  )
  select is_subscriber, minutes_today, 120, spun_today,
         case when is_subscriber and minutes_today >= 120 and not spun_today
                   and (select t.status from public.timer t where t.id = 1) = 'live' then 1 else 0 end
  from me;
$$;

-- Spin: the server checks the rules and picks the prize (weighted).
create or replace function public.spin()
returns table (spin_id bigint, prize_position smallint, full_label text, is_win boolean, spins_left integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me            public.viewers%rowtype;
  p             public.prizes%rowtype;
  today         date := (now() at time zone 'Europe/Bucharest')::date;
  watched       integer;
  total_weight  integer;
  pick          integer;
  new_id        bigint;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found or me.twitch_id is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  -- One spin at a time per viewer (double clicks).
  perform pg_advisory_xact_lock(hashtext('spin:' || me.twitch_id));

  if (select status from public.timer where id = 1) is distinct from 'live' then
    raise exception 'wheel_closed' using errcode = 'P0001';
  end if;
  if not me.is_subscriber then
    raise exception 'not_subscriber' using errcode = 'P0001';
  end if;
  select d.minutes into watched from public.watch_daily d where d.twitch_id = me.twitch_id and d.day = today;
  if coalesce(watched, 0) < 120 then
    raise exception 'not_enough_watch' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.spins s where s.twitch_id = me.twitch_id
             and (s.created_at at time zone 'Europe/Bucharest')::date = today) then
    raise exception 'already_spun' using errcode = 'P0001';
  end if;

  select sum(weight) into total_weight from public.prizes where weight > 0;
  if coalesce(total_weight, 0) = 0 then
    raise exception 'no_prizes' using errcode = 'P0001';
  end if;
  pick := floor(random() * total_weight)::integer;
  for p in select * from public.prizes where weight > 0 order by position loop
    exit when pick < p.weight;
    pick := pick - p.weight;
  end loop;

  insert into public.spins (twitch_id, user_login, prize_position)
    values (me.twitch_id, coalesce(me.login, me.display_name, me.twitch_id), p.position)
    returning id into new_id;

  return query select new_id, p.position, p.full_label, p.is_win, 0;
end;
$$;

-- Donors leaderboard ----------------------------------------------------------
create view public.leaderboard_donations with (security_invoker = on) as
  select coalesce(user_login, lower(user_name)) as user_login, max(user_name) as user_name, round(sum(quantity))::integer as total
  from public.events
  where kind = 'donation' and coalesce(user_name, '') not in ('', 'Anonim')
  group by coalesce(user_login, lower(user_name))
  order by total desc
  limit 10;
grant select on public.leaderboard_donations to anon, authenticated;

-- Who may call what ---------------------------------------------------------
revoke execute on function public.mod_set_goals(jsonb), public.wheel_status(), public.credit_watch_time(jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.mod_set_goals(jsonb), public.wheel_status() to authenticated;
grant execute on function public.mod_set_goals(jsonb), public.wheel_status(), public.credit_watch_time(jsonb, integer) to service_role;
