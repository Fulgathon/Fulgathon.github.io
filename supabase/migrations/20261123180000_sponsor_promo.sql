-- Sponsor promotion (owner, 23 Nov 2026):
--   1. "Ora dublă oferită de …": a sponsor on each double hour (+ history for the report).
--   2. Every prize "de la …": sponsor on wheel prizes, milestones and the bingo prize;
--      moderators edit the wheel prizes on /mod.
--   3. "Codul secret": moderators show a code on stream (via the OBS overlay, which
--      reads it with a private key); viewers enter it on the site for a bonus spin.
--   4. Sponsor report: clicks / code copies counted on the site, viewer samples
--      every 5 minutes, donations during sponsored double hours, wins per sponsor.

-- 1. Sponsored double hour ------------------------------------------------------
alter table public.timer add column double_sponsor text;

create table public.double_hours (
  id        bigint generated always as identity primary key,
  starts_at timestamptz not null,
  ends_at   timestamptz not null,
  sponsor   text,
  created_at timestamptz not null default now()
);
alter table public.double_hours enable row level security;
revoke all on public.double_hours from anon, authenticated;
grant all on public.double_hours to service_role;

drop function if exists public.mod_double_hour(timestamptz, integer);
create function public.mod_double_hour(p_from timestamptz, p_minutes integer default 60, p_sponsor text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s text := nullif(btrim(coalesce(p_sponsor, '')), '');
begin
  perform private.require_moderator();
  perform public.set_double_hour(p_from, p_minutes);
  update public.timer set double_sponsor = left(s, 60) where id = 1;
  insert into public.double_hours (starts_at, ends_at, sponsor)
    values (p_from, p_from + make_interval(mins => p_minutes), left(s, 60));
end; $$;

-- 2. Sponsors on prizes, milestones, bingo -----------------------------------------
alter table public.prizes add column sponsor text;
alter table public.goals add column sponsor text;
alter table public.bingo_settings add column prize_sponsor text;

-- The 8 wheel slices: [{short_label, full_label, win_label, sponsor, is_win, weight}] in order.
create or replace function public.mod_set_prizes(p_prizes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  pos integer := 0;
begin
  perform private.require_moderator();
  if jsonb_typeof(p_prizes) is distinct from 'array' or jsonb_array_length(p_prizes) <> 8 then
    raise exception 'need_8' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_prizes) e
             where length(btrim(coalesce(e ->> 'short_label', ''))) not between 1 and 16
                or length(btrim(coalesce(e ->> 'full_label', ''))) not between 1 and 80
                or coalesce(e ->> 'weight', '1') !~ '^[0-9]{1,4}$') then
    raise exception 'bad_prizes' using errcode = 'P0001';
  end if;
  for x in select * from jsonb_array_elements(p_prizes) loop
    update public.prizes set
      short_label = btrim(x ->> 'short_label'),
      full_label = btrim(x ->> 'full_label'),
      win_label = coalesce(nullif(btrim(coalesce(x ->> 'win_label', '')), ''), btrim(x ->> 'full_label')),
      sponsor = left(nullif(btrim(coalesce(x ->> 'sponsor', '')), ''), 60),
      is_win = coalesce((x ->> 'is_win')::boolean, true),
      weight = coalesce((x ->> 'weight')::integer, 1)
    where position = pos;
    pos := pos + 1;
  end loop;
end; $$;

-- Milestones keep working as before, now with an optional sponsor per milestone.
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
  insert into public.goals (position, title, threshold, unlocked_at, sponsor)
  select (row_number() over (order by (g ->> 'threshold')::integer))::smallint,
         btrim(g ->> 'title'),
         (g ->> 'threshold')::integer,
         case when (g ->> 'threshold')::integer <= total
              then coalesce((old ->> (btrim(g ->> 'title') || '|' || (g ->> 'threshold')))::timestamptz, now()) end,
         left(nullif(btrim(coalesce(g ->> 'sponsor', '')), ''), 60)
  from jsonb_array_elements(p_goals) g;
exception when unique_violation then
  raise exception 'duplicate_amount' using errcode = 'P0001';
end; $$;

drop function if exists public.mod_bingo_settings(timestamptz, text);
create function public.mod_bingo_settings(p_closes_at timestamptz, p_prize text, p_prize_sponsor text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.bingo_settings
    set closes_at = p_closes_at,
        prize = coalesce(nullif(btrim(p_prize), ''), prize),
        prize_sponsor = left(nullif(btrim(coalesce(p_prize_sponsor, '')), ''), 60)
    where id = 1;
end; $$;

-- 3. Secret codes and bonus spins -------------------------------------------------
alter table public.viewers add column bonus_spins integer not null default 0 check (bonus_spins >= 0);

create table public.secret_codes (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  sponsor     text,
  shown_at    timestamptz not null default now(),
  expires_at  timestamptz not null,
  created_by  text
);
create table public.code_claims (
  code_id    bigint not null references public.secret_codes (id) on delete cascade,
  viewer_id  uuid not null references public.viewers (id) on delete cascade,
  claimed_at timestamptz not null default now(),
  primary key (code_id, viewer_id)
);
create index code_claims_viewer_idx on public.code_claims (viewer_id);
create table public.code_attempts (
  viewer_id uuid not null references public.viewers (id) on delete cascade,
  at        timestamptz not null default now()
);
create index code_attempts_viewer_at_idx on public.code_attempts (viewer_id, at desc);
alter table public.secret_codes  enable row level security;
alter table public.code_claims   enable row level security;
alter table public.code_attempts enable row level security;
revoke all on public.secret_codes, public.code_claims, public.code_attempts from anon, authenticated;
grant all on public.secret_codes, public.code_claims, public.code_attempts to service_role;

-- Private key the OBS overlay uses to read the current code (only in Iceman's OBS link).
select vault.create_secret(encode(extensions.gen_random_bytes(18), 'hex'), 'overlay_key', 'OBS overlay key for secret codes');

-- Show a new code now, valid p_minutes (default 10). Returns the code.
create or replace function public.mod_code_show(p_sponsor text, p_minutes integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  me text;
  r public.secret_codes%rowtype;
begin
  perform private.require_moderator();
  if p_minutes is null or p_minutes not between 1 and 60 then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  select coalesce(v.login, '') into me from public.viewers v where v.id = (select auth.uid());
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
      if i = 3 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.secret_codes where code = c);
  end loop;
  -- One code on screen at a time: end the previous one.
  update public.secret_codes set expires_at = now() where expires_at > now();
  insert into public.secret_codes (code, sponsor, expires_at, created_by)
    values (c, left(nullif(btrim(coalesce(p_sponsor, '')), ''), 60), now() + make_interval(mins => p_minutes), me)
    returning * into r;
  return jsonb_build_object('code', r.code, 'sponsor', r.sponsor, 'expires_at', r.expires_at);
end; $$;

create or replace function public.mod_code_end()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.secret_codes set expires_at = now() where expires_at > now();
end; $$;

-- Recent codes with how many people claimed each.
create or replace function public.mod_codes()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', c.code, 'sponsor', c.sponsor, 'shown_at', c.shown_at,
                                        'expires_at', c.expires_at, 'claims', (select count(*) from public.code_claims k where k.code_id = c.id))
                     order by c.shown_at desc)
    from (select * from public.secret_codes order by shown_at desc limit 20) c
  ), '[]'::jsonb);
end; $$;

create or replace function public.mod_overlay_key()
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return (select decrypted_secret from vault.decrypted_secrets where name = 'overlay_key');
end; $$;

-- The OBS overlay: the code on screen right now (needs the private key).
create or replace function public.overlay_code(p_key text)
returns table (code text, sponsor text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key is null or p_key is distinct from (select decrypted_secret from vault.decrypted_secrets where name = 'overlay_key') then
    return;
  end if;
  return query select c.code, c.sponsor, c.expires_at from public.secret_codes c
    where c.shown_at <= now() and c.expires_at > now() order by c.shown_at desc limit 1;
end; $$;

-- A viewer enters a code: 1 bonus spin per code. At most 6 tries per minute.
create or replace function public.claim_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.secret_codes%rowtype;
  left_spins integer;
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if (select count(*) from public.code_attempts a where a.viewer_id = me and a.at > now() - interval '1 minute') >= 6 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
  insert into public.code_attempts (viewer_id) values (me);
  delete from public.code_attempts where at < now() - interval '1 day';
  select * into c from public.secret_codes s
    where replace(s.code, '-', '') = norm and s.shown_at <= now() and s.expires_at > now();
  if not found then
    raise exception 'bad_code' using errcode = 'P0001';
  end if;
  begin
    insert into public.code_claims (code_id, viewer_id) values (c.id, me);
  exception when unique_violation then
    raise exception 'already_claimed' using errcode = 'P0001';
  end;
  update public.viewers set bonus_spins = bonus_spins + 1 where id = me returning bonus_spins into left_spins;
  return jsonb_build_object('sponsor', c.sponsor, 'bonus_spins', left_spins);
end; $$;

-- Wheel: the daily spin (sub + 2 h today) plus any bonus spins from codes (anyone logged in).
alter table public.spins add column bonus boolean not null default false;
drop function if exists public.wheel_status();
create function public.wheel_status()
returns table (is_subscriber boolean, minutes_today integer, minutes_needed integer, spun_today boolean, spins_available integer, bonus_spins integer)
language sql stable security definer set search_path = '' as $$
  with me as (
    select v.twitch_id, v.is_subscriber, v.bonus_spins,
           coalesce((select d.minutes from public.watch_daily d
                     where d.twitch_id = v.twitch_id and d.day = (now() at time zone 'Europe/Bucharest')::date), 0) as minutes_today,
           exists (select 1 from public.spins s
                   where s.twitch_id = v.twitch_id and s.bonus = false
                     and (s.created_at at time zone 'Europe/Bucharest')::date = (now() at time zone 'Europe/Bucharest')::date) as spun_today,
           (select t.status from public.timer t where t.id = 1) = 'live' as is_live
    from public.viewers v where v.id = (select auth.uid())
  )
  select is_subscriber, minutes_today, 120, spun_today,
         case when is_live then
           (case when is_subscriber and minutes_today >= 120 and not spun_today then 1 else 0 end) + bonus_spins
         else 0 end,
         bonus_spins
  from me;
$$;


create or replace function public.spin()
returns table (spin_id bigint, prize_position smallint, full_label text, is_win boolean, spins_left integer)
language plpgsql security definer set search_path = '' as $$
declare
  me            public.viewers%rowtype;
  p             public.prizes%rowtype;
  today         date := (now() at time zone 'Europe/Bucharest')::date;
  watched       integer;
  daily_ok      boolean;
  use_bonus     boolean := false;
  total_weight  integer;
  pick          integer;
  new_id        bigint;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found or me.twitch_id is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('spin:' || me.twitch_id));
  select * into me from public.viewers where id = me.id;  -- fresh bonus count under the lock

  if (select status from public.timer where id = 1) is distinct from 'live' then
    raise exception 'wheel_closed' using errcode = 'P0001';
  end if;
  select d.minutes into watched from public.watch_daily d where d.twitch_id = me.twitch_id and d.day = today;
  daily_ok := me.is_subscriber and coalesce(watched, 0) >= 120
    and not exists (select 1 from public.spins s where s.twitch_id = me.twitch_id and s.bonus = false
                    and (s.created_at at time zone 'Europe/Bucharest')::date = today);
  if not daily_ok then
    if me.bonus_spins > 0 then
      use_bonus := true;
    elsif not me.is_subscriber then
      raise exception 'not_subscriber' using errcode = 'P0001';
    elsif coalesce(watched, 0) < 120 then
      raise exception 'not_enough_watch' using errcode = 'P0001';
    else
      raise exception 'already_spun' using errcode = 'P0001';
    end if;
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

  if use_bonus then
    update public.viewers set bonus_spins = bonus_spins - 1 where id = me.id;
  end if;
  insert into public.spins (twitch_id, user_login, prize_position, bonus)
    values (me.twitch_id, coalesce(me.login, me.display_name, me.twitch_id), p.position, use_bonus)
    returning id into new_id;

  return query select new_id, p.position, p.full_label, p.is_win,
    (case when use_bonus then me.bonus_spins - 1 else me.bonus_spins end)::integer;
end; $$;

-- 4. Sponsor report ---------------------------------------------------------------
create table public.sponsor_stats (
  day      date not null default (now() at time zone 'Europe/Bucharest')::date,
  sponsor  text not null,
  kind     text not null check (kind in ('click', 'code_copy')),
  count    integer not null default 0,
  primary key (day, sponsor, kind)
);
create table public.stream_samples (
  at        timestamptz primary key default now(),
  chatters  integer not null
);
alter table public.sponsor_stats  enable row level security;
alter table public.stream_samples enable row level security;
revoke all on public.sponsor_stats, public.stream_samples from anon, authenticated;
grant all on public.sponsor_stats, public.stream_samples to service_role;

-- Counted from the site (no personal data; the site sends each kind once per visit).
create or replace function public.track_sponsor(p_sponsor text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s text := left(btrim(coalesce(p_sponsor, '')), 60);
begin
  if s = '' or p_kind not in ('click', 'code_copy') then return; end if;
  insert into public.sponsor_stats (sponsor, kind, count) values (s, p_kind, 1)
  on conflict (day, sponsor, kind) do update set count = public.sponsor_stats.count + 1;
end; $$;

-- Watch time also records how many people were in chat (for "peak viewers").
create or replace function public.credit_watch_time(p_viewers jsonb, p_minutes integer default 5)
returns integer language plpgsql security definer set search_path = '' as $$
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

  insert into public.stream_samples (chatters) values (credited) on conflict (at) do nothing;
  return credited;
end; $$;

-- Everything per sponsor, for the report on /mod.
create or replace function public.mod_sponsor_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return jsonb_build_object(
    'peak_chatters', (select max(chatters) from public.stream_samples),
    'watch_hours', (select round(coalesce(sum(minutes), 0) / 60.0) from public.watch_time),
    'raised', (select raised from public.stats where id = 1),
    'sponsors', coalesce((
      with names as (
        select sponsor from public.sponsor_stats
        union select sponsor from public.double_hours where sponsor is not null
        union select sponsor from public.secret_codes where sponsor is not null
        union select sponsor from public.prizes where sponsor is not null
        union select sponsor from public.goals where sponsor is not null
        union select prize_sponsor from public.bingo_settings where prize_sponsor is not null
      )
      select jsonb_agg(jsonb_build_object(
        'sponsor', n.sponsor,
        'clicks', (select coalesce(sum(count), 0) from public.sponsor_stats s where s.sponsor = n.sponsor and s.kind = 'click'),
        'code_copies', (select coalesce(sum(count), 0) from public.sponsor_stats s where s.sponsor = n.sponsor and s.kind = 'code_copy'),
        'codes_shown', (select count(*) from public.secret_codes c where c.sponsor = n.sponsor),
        'code_claims', (select count(*) from public.code_claims k join public.secret_codes c on c.id = k.code_id where c.sponsor = n.sponsor),
        'double_hours', (select count(*) from public.double_hours h where h.sponsor = n.sponsor and h.starts_at <= now()),
        'donated_in_hours', (select coalesce(sum(e.quantity), 0) from public.events e join public.double_hours h
                               on e.created_at >= h.starts_at and e.created_at < h.ends_at
                             where h.sponsor = n.sponsor and e.kind = 'donation'),
        'peak_in_hours', (select max(x.chatters) from public.stream_samples x join public.double_hours h
                            on x.at >= h.starts_at and x.at < h.ends_at where h.sponsor = n.sponsor),
        'wins', (select count(*) from public.spins sp join public.prizes p on p.position = sp.prize_position
                 where p.sponsor = n.sponsor and p.is_win),
        'milestones', (select count(*) from public.goals g where g.sponsor = n.sponsor),
        'milestones_unlocked', (select count(*) from public.goals g where g.sponsor = n.sponsor and g.unlocked_at is not null)
      ) order by n.sponsor)
      from names n
    ), '[]'::jsonb)
  );
end; $$;

-- Who may call what -----------------------------------------------------------------
revoke execute on function
  public.mod_double_hour(timestamptz, integer, text), public.mod_set_prizes(jsonb),
  public.mod_bingo_settings(timestamptz, text, text), public.mod_code_show(text, integer), public.mod_code_end(),
  public.mod_codes(), public.mod_overlay_key(), public.overlay_code(text), public.claim_code(text),
  public.wheel_status(), public.track_sponsor(text, text), public.mod_sponsor_report()
  from public, anon, authenticated;
grant execute on function public.overlay_code(text), public.track_sponsor(text, text) to anon, authenticated;
grant execute on function
  public.mod_double_hour(timestamptz, integer, text), public.mod_set_prizes(jsonb),
  public.mod_bingo_settings(timestamptz, text, text), public.mod_code_show(text, integer), public.mod_code_end(),
  public.mod_codes(), public.mod_overlay_key(), public.claim_code(text), public.wheel_status(), public.mod_sponsor_report()
  to authenticated;
grant execute on function
  public.mod_double_hour(timestamptz, integer, text), public.mod_set_prizes(jsonb),
  public.mod_bingo_settings(timestamptz, text, text), public.mod_code_show(text, integer), public.mod_code_end(),
  public.mod_codes(), public.mod_overlay_key(), public.overlay_code(text), public.claim_code(text),
  public.wheel_status(), public.track_sponsor(text, text), public.mod_sponsor_report()
  to service_role;
