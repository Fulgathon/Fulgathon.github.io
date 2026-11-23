-- /mod on autopilot (owner, 24 Nov 2026: "Iceman will have maximum of 3 people that will
-- help … I want as much automatic processes as possible").
--
-- Everything here runs from one new cron job, icemaraton-autopilot (every minute):
--   1. Auto start: the clock starts by itself at the scheduled start (switch on /mod).
--   2. Plan: Ora dublă, secret codes and freezes are planned ahead and switch on by themselves.
--   3. Vote autopilot: once a day, the first time the stream is online after the set hour,
--      a round opens with 2 easy / 2 medium / 1 hard challenge from different categories.
--   4. Bingo auto-ticks: events the site can see itself (milestone unlocked, Ora dublă,
--      a big donation, a gift wave, the clock passing N hours, a secret code, euros raised).
--   5. Alerts in Discord: whatever needs a person (connection down, prize won, donation in
--      another currency, bingo ready to draw, a planned item missed), throttled per kind.
-- Plus, for /mod: a shared preparation checklist, suggestions that clean themselves
-- (blocked words and duplicates are refused), «Aprobă tot», and per-item bingo rules.
-- Moderators only change settings through mod_* functions (moderator check inside).

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table private.autopilot (
  id               smallint primary key default 1 check (id = 1),
  auto_start       boolean not null default false,
  start_hours      numeric not null default 24 check (start_hours > 0 and start_hours <= 500),
  vote_on          boolean not null default false,
  vote_at          time not null default '20:00',       -- Romania time
  vote_minutes     integer not null default 60 check (vote_minutes between 10 and 720),
  last_vote_day    date,                                 -- Romania date of the last auto round
  discord_webhook  text check (discord_webhook is null or discord_webhook ~ '^https://(discord\.com|discordapp\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$'),
  alert_state      jsonb not null default '{}'::jsonb,   -- per kind: last sent / watermarks
  updated_at       timestamptz not null default now(),
  updated_by       text
);
insert into private.autopilot (id) values (1);

create table private.plan (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('double', 'code', 'freeze')),
  at          timestamptz not null,
  minutes     integer check (minutes between 1 and 720),
  until_at    timestamptz,
  sponsor     text check (sponsor is null or length(sponsor) <= 60),
  created_by  text,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  result      text,
  check (kind <> 'freeze' or until_at > at),
  check (kind = 'freeze' or minutes is not null)
);
create index plan_due_idx on private.plan (at) where done_at is null;

create table private.mod_checklist (
  key      text primary key check (length(key) <= 40),
  done_by  text,
  done_at  timestamptz not null default now()
);

alter table public.bingo_items add column auto_rule jsonb
  check (auto_rule is null or (jsonb_typeof(auto_rule) = 'object' and auto_rule ->> 't' in ('milestone', 'double', 'donation', 'gift', 'hours', 'code', 'raised')));

alter table private.autopilot enable row level security;
alter table private.plan enable row level security;
alter table private.mod_checklist enable row level security;
revoke all on private.autopilot, private.plan, private.mod_checklist from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------
create or replace function private.me_login()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select v.login from public.viewers v where v.id = (select auth.uid())), 'autopilot');
$$;

-- A secret code on stream (same as «Arată un cod nou pe stream», without the moderator check).
create or replace function private.show_code(p_sponsor text, p_minutes integer, p_by text)
returns public.secret_codes language plpgsql security definer set search_path = '' as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
  r public.secret_codes%rowtype;
begin
  if p_minutes is null or p_minutes not between 1 and 60 then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::integer, 1);
      if i = 3 then c := c || '-'; end if;
    end loop;
    exit when not exists (select 1 from public.secret_codes where code = c);
  end loop;
  update public.secret_codes set expires_at = now() where expires_at > now();
  insert into public.secret_codes (code, sponsor, expires_at, created_by)
    values (c, left(nullif(btrim(coalesce(p_sponsor, '')), ''), 60), now() + make_interval(mins => p_minutes), p_by)
    returning * into r;
  return r;
end; $$;

create or replace function public.mod_code_show(p_sponsor text, p_minutes integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.secret_codes%rowtype;
begin
  perform private.require_moderator();
  r := private.show_code(p_sponsor, p_minutes, private.me_login());
  return jsonb_build_object('code', r.code, 'sponsor', r.sponsor, 'expires_at', r.expires_at);
end; $$;

-- Ora dublă with its sponsor, recorded for the sponsor report (same as mod_double_hour).
create or replace function private.double_hour(p_from timestamptz, p_minutes integer, p_sponsor text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s text := left(nullif(btrim(coalesce(p_sponsor, '')), ''), 60);
begin
  perform public.set_double_hour(p_from, p_minutes);
  update public.timer set double_sponsor = s where id = 1;
  insert into public.double_hours (starts_at, ends_at, sponsor)
    values (p_from, p_from + make_interval(mins => p_minutes), s);
end; $$;

-- A message to the moderators' Discord channel. With p_every, at most once per p_every for
-- p_kind; without it (one-off messages: a prize, a donation), always and nothing is kept.
-- Never raises: an alert must not stop the autopilot.
create or replace function private.alert(p_kind text, p_text text, p_every interval default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  a private.autopilot%rowtype;
  last timestamptz;
begin
  select * into a from private.autopilot where id = 1;
  if a.discord_webhook is null then return false; end if;
  if p_every is not null then
    last := (a.alert_state -> 'sent' ->> p_kind)::timestamptz;
    if last is not null and last > now() - p_every then return false; end if;
  end if;
  perform net.http_post(
    url := a.discord_webhook,
    body := jsonb_build_object('content', left(p_text, 1900), 'username', 'ICEMARATON /mod',
                               'allowed_mentions', jsonb_build_object('parse', '[]'::jsonb)),
    headers := jsonb_build_object('Content-Type', 'application/json'));
  if p_every is not null then
    update private.autopilot
      set alert_state = jsonb_set(alert_state, '{sent}', coalesce(alert_state -> 'sent', '{}'::jsonb) || jsonb_build_object(p_kind, now()))
      where id = 1;
  end if;
  return true;
exception when others then
  return false;
end; $$;

-- 2 easy, 2 medium, 1 hard, each from a different category (same mix as /mod's proposal);
-- topped up to 5 when a level runs short.
create or replace function private.pick_round()
returns integer[] language plpgsql volatile security definer set search_path = '' as $$
declare
  picked integer[] := '{}';
  cats   text[] := '{}';
  lv     record;
  c      record;
begin
  for lv in select * from (values ('ușor', 2), ('mediu', 2), ('greu', 1)) as x(level, n) loop
    for c in
      select id, category from public.challenges
      where status = 'pool' and votable and level = lv.level and not (category = any (cats))
      order by random()
    loop
      exit when (select count(*) from public.challenges where id = any (picked) and level = lv.level) >= lv.n;
      if not (c.category = any (cats)) then
        picked := picked || c.id;
        cats := cats || c.category;
      end if;
    end loop;
  end loop;
  -- Too few of a level (there are few hard ones): top up to 5, new categories first.
  if cardinality(picked) < 5 then
    for c in
      select id, category from public.challenges
      where status = 'pool' and votable and not (id = any (picked))
      order by (category = any (cats)), random()
    loop
      exit when cardinality(picked) >= 5;
      picked := picked || c.id;
      cats := cats || c.category;
    end loop;
  end if;
  return picked;
end; $$;

-- Whether a bingo rule has happened.
create or replace function private.bingo_rule_hit(r jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
  since timestamptz;
begin
  select * into t from public.timer where id = 1;
  since := coalesce(t.starts_at, '-infinity'::timestamptz);
  if t.status = 'upcoming' then return false; end if;
  case r ->> 't'
    when 'milestone' then
      return exists (select 1 from public.goals g where g.position = (r ->> 'n')::integer and g.unlocked_at is not null);
    when 'double' then
      return exists (select 1 from public.double_hours d where d.starts_at <= now() and d.starts_at >= since);
    when 'donation' then
      return exists (select 1 from public.events e where e.kind = 'donation' and e.created_at >= since
                     and e.quantity >= (r ->> 'eur')::numeric);
    when 'gift' then
      return exists (select 1 from public.events e where e.kind = 'gift' and e.created_at >= since
                     and e.quantity >= (r ->> 'n')::numeric);
    when 'hours' then
      return t.status = 'live' and t.ends_at - now() >= make_interval(hours => (r ->> 'h')::integer);
    when 'code' then
      return exists (select 1 from public.secret_codes s where s.shown_at >= since);
    when 'raised' then
      return (select s.raised from public.stats s where s.id = 1) >= (r ->> 'eur')::numeric;
    else
      return false;
  end case;
exception when others then
  return false;
end; $$;

-- ---------------------------------------------------------------------------
-- The tick (every minute)
-- ---------------------------------------------------------------------------
create or replace function private.autopilot_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  a      private.autopilot%rowtype;
  t      public.timer%rowtype;
  p      private.plan%rowtype;
  local  timestamp := now() at time zone 'Europe/Bucharest';
  ids    integer[];
  rid    integer;
  secs   integer;
  n      integer;
  wm     bigint;
  txt    text;
  rec    record;
begin
  select * into a from private.autopilot where id = 1 for update;
  select * into t from public.timer where id = 1;

  -- 1. Auto start at the scheduled start (not more than 6 h late: a forgotten switch must
  --    not start the marathon days later).
  if a.auto_start and t.status = 'upcoming' and t.starts_at is not null
     and t.starts_at <= now() and t.starts_at > now() - interval '6 hours' then
    perform public.start_timer(round(a.start_hours * 3600)::integer, null);
    perform private.alert('started', format('Cronometrul a pornit singur cu %s ore.', a.start_hours));
    select * into t from public.timer where id = 1;
  end if;

  -- 2. Planned Ora dublă / codes / freezes.
  for p in select * from private.plan where done_at is null and at <= now() order by at for update skip locked loop
    begin
      if p.at < now() - interval '30 minutes' then
        update private.plan set done_at = now(), result = 'missed' where id = p.id;
        perform private.alert('missed', format('Nu s-a putut porni la timp: %s din %s (cronometrul nu era pornit).',
          case p.kind when 'double' then 'Ora dublă' when 'code' then 'codul secret' else 'înghețul' end,
          to_char(p.at at time zone 'Europe/Bucharest', 'DD.MM HH24:MI')));
        continue;
      end if;
      if t.status <> 'live' or (t.ends_at <= now() and (t.paused_until is null or t.paused_until <= now())) then
        continue;   -- waits (up to 30 minutes) for the clock
      end if;
      if p.kind = 'double' then
        perform private.double_hour(p.at, p.minutes, p.sponsor);
      elsif p.kind = 'code' then
        perform private.show_code(p.sponsor, least(p.minutes, 60), 'autopilot');
      else
        secs := floor(extract(epoch from (p.until_at - greatest(coalesce(t.paused_until, now()), now()))))::integer;
        if secs > 0 then perform public.freeze_timer(secs); end if;
        select * into t from public.timer where id = 1;
      end if;
      update private.plan set done_at = now(), result = 'done' where id = p.id;
    exception when others then
      update private.plan set done_at = now(), result = left('error: ' || sqlerrm, 200) where id = p.id;
    end;
  end loop;

  -- 3. Vote autopilot: once per Romania day, the first time the stream is online after vote_at.
  if a.vote_on and t.status = 'live' and t.stream_online
     and local::time >= a.vote_at and (a.last_vote_day is null or a.last_vote_day < local::date)
     and not exists (select 1 from public.vote_rounds where now() < closes_at) then
    ids := private.pick_round();
    if coalesce(array_length(ids, 1), 0) >= 2 then
      insert into public.vote_rounds (number, opens_at, closes_at)
        values ((select coalesce(max(number), 0) + 1 from public.vote_rounds), now(), now() + make_interval(mins => a.vote_minutes))
        returning id into rid;
      insert into public.round_challenges (round_id, challenge_id, position)
        select rid, c, o::smallint from unnest(ids) with ordinality as x (c, o);
      update public.challenges set status = 'in_round' where id = any (ids);
      update private.autopilot set last_vote_day = local::date where id = 1;
    else
      perform private.alert('vote_pool', 'Votul automat nu a putut deschide runda: nu mai sunt destule provocări în listă.', interval '24 hours');
    end if;
  end if;

  -- 4. Bingo auto-ticks.
  update public.bingo_items b set happened_at = now()
    where b.happened_at is null and b.auto_rule is not null and private.bingo_rule_hit(b.auto_rule);

  -- 5. Alerts (only when a Discord webhook is set).
  if a.discord_webhook is not null then
    if not exists (select 1 from vault.decrypted_secrets where name = 'twitch_broadcaster_token') then
      perform private.alert('streamer', 'Contul de streamer nu e conectat: subs, biții și statusul live nu ajung pe site. Iceman apasă «Reconectează» pe /mod.', interval '6 hours');
    end if;
    if exists (select 1 from private.tipeee_state where last_error is not null or last_run < now() - interval '3 minutes') then
      perform private.alert('tipeee', 'Donațiile TipeeeStream nu mai sunt citite (vezi /mod → Conexiuni).', interval '30 minutes');
    end if;
    if t.status = 'live' and t.stream_online
       and coalesce((select max(at) from public.stream_samples), '-infinity') < now() - interval '15 minutes' then
      perform private.alert('watch', 'Timpul privit nu s-a mai numărat de 15 minute, deși Iceman e live (vezi /mod → Conexiuni).', interval '30 minutes');
    end if;

    -- New wheel prizes to give.
    wm := coalesce((a.alert_state ->> 'spin')::bigint, 0);
    n := 0;
    for rec in
      select s.id, s.user_login, z.win_label from public.spins s join public.prizes z on z.position = s.prize_position
      where s.id > wm and z.is_win and s.fulfilled_at is null order by s.id limit 10
    loop
      perform private.alert('spin', format('Premiu de dat: %s a câștigat «%s». Marcați «Dat» pe /mod după ce îl trimiteți.', rec.user_login, coalesce(rec.win_label, 'premiu')));
      wm := rec.id;
      n := n + 1;
    end loop;
    if n < 10 then select greatest(wm, coalesce(max(id), 0)) into wm from public.spins; end if;
    -- New donations in another currency.
    txt := coalesce(a.alert_state ->> 'skipped', '');
    for rec in
      select external_id, user_name, amount, currency, created_at from private.skipped_donations
      where handled_at is null and created_at > coalesce(nullif(txt, '')::timestamptz, '-infinity') order by created_at limit 10
    loop
      perform private.alert('skip', format('Donație în altă monedă: %s · %s %s. Nu a adăugat timp; hotărâți pe /mod.', rec.user_name, rec.amount, rec.currency));
      txt := rec.created_at::text;
    end loop;
    -- Bingo ready to draw.
    select count(*) into n from public.bingo_picks bp
      where not exists (select 1 from unnest(bp.items) i
                        where not exists (select 1 from public.bingo_items b where b.id = i and b.happened_at is not null));
    if n > 0 and not exists (select 1 from public.bingo_draws)
       and (select closes_at from public.bingo_settings where id = 1) <= now() then
      perform private.alert('bingo', format('Bingo: %s %s toate cele 5 evenimente. Trageți la sorți pe /mod.', n, case when n = 1 then 'jucător are' else 'jucători au' end), interval '12 hours');
    end if;
    update private.autopilot
      set alert_state = alert_state || jsonb_build_object('spin', wm) || case when txt <> '' then jsonb_build_object('skipped', txt) else '{}'::jsonb end
      where id = 1;
  end if;
end; $$;

select cron.schedule('icemaraton-autopilot', '* * * * *', $$select private.autopilot_tick()$$);

-- ---------------------------------------------------------------------------
-- /mod: settings, plan, alerts, checklist
-- ---------------------------------------------------------------------------
create or replace function public.mod_autopilot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a private.autopilot%rowtype;
begin
  perform private.require_moderator();
  select * into a from private.autopilot where id = 1;
  return jsonb_build_object(
    'autoStart', a.auto_start, 'startHours', a.start_hours,
    'voteOn', a.vote_on, 'voteAt', to_char(a.vote_at, 'HH24:MI'), 'voteMinutes', a.vote_minutes, 'lastVoteDay', a.last_vote_day,
    'hasWebhook', a.discord_webhook is not null,
    'updatedAt', a.updated_at, 'updatedBy', a.updated_by,
    'plan', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'at', p.at, 'minutes', p.minutes,
        'until', p.until_at, 'sponsor', p.sponsor, 'by', p.created_by, 'done', p.done_at, 'result', p.result) order by p.at)
      from (select * from private.plan where done_at is null or done_at > now() - interval '2 days') p), '[]'::jsonb),
    'checklist', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('by', c.done_by, 'at', c.done_at)) from private.mod_checklist c), '{}'::jsonb)
  );
end; $$;

-- Partial update: only the keys present are changed. discordWebhook '' clears it.
create or replace function public.mod_autopilot_set(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  hook text;
begin
  perform private.require_moderator();
  if p ? 'discordWebhook' then
    hook := nullif(btrim(coalesce(p ->> 'discordWebhook', '')), '');
    if hook is not null and hook !~ '^https://(discord\.com|discordapp\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
      raise exception 'bad_webhook' using errcode = 'P0001';
    end if;
  end if;
  update private.autopilot set
    auto_start   = coalesce((p ->> 'autoStart')::boolean, auto_start),
    start_hours  = coalesce((p ->> 'startHours')::numeric, start_hours),
    vote_on      = coalesce((p ->> 'voteOn')::boolean, vote_on),
    vote_at      = coalesce((p ->> 'voteAt')::time, vote_at),
    vote_minutes = coalesce((p ->> 'voteMinutes')::integer, vote_minutes),
    discord_webhook = case when p ? 'discordWebhook' then hook else discord_webhook end,
    updated_at = now(), updated_by = private.me_login()
  where id = 1;
exception
  when check_violation then raise exception 'bad_autopilot' using errcode = 'P0001';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'bad_autopilot' using errcode = 'P0001';
end; $$;

create or replace function public.mod_alert_test()
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if (select discord_webhook from private.autopilot where id = 1) is null then
    raise exception 'no_webhook' using errcode = 'P0001';
  end if;
  return private.alert('test',
    format('Test de la %s: alertele ICEMARATON ajung aici.', private.me_login()));
end; $$;

create or replace function public.mod_plan_add(p_kind text, p_at timestamptz, p_minutes integer default null,
                                               p_until timestamptz default null, p_sponsor text default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  new_id bigint;
begin
  perform private.require_moderator();
  if p_at is null or p_at < now() - interval '1 minute' then
    raise exception 'plan_in_past' using errcode = 'P0001';
  end if;
  if p_kind = 'code' and (p_minutes is null or p_minutes not between 1 and 60) then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  if p_kind = 'double' and (p_minutes is null or p_minutes not between 1 and 720) then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  if p_kind = 'freeze' and (p_until is null or p_until <= p_at) then
    raise exception 'bad_until' using errcode = 'P0001';
  end if;
  insert into private.plan (kind, at, minutes, until_at, sponsor, created_by)
    values (p_kind, p_at, case when p_kind = 'freeze' then null else p_minutes end,
            case when p_kind = 'freeze' then p_until end,
            left(nullif(btrim(coalesce(p_sponsor, '')), ''), 60), private.me_login())
    returning id into new_id;
  return new_id;
exception when check_violation then
  raise exception 'bad_plan' using errcode = 'P0001';
end; $$;

create or replace function public.mod_plan_del(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  delete from private.plan where id = p_id and done_at is null;
end; $$;

create or replace function public.mod_checklist_set(p_key text, p_done boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if p_key is null or length(p_key) > 40 then raise exception 'bad_key' using errcode = 'P0001'; end if;
  if p_done then
    insert into private.mod_checklist (key, done_by) values (p_key, private.me_login())
      on conflict (key) do update set done_by = excluded.done_by, done_at = now();
  else
    delete from private.mod_checklist where key = p_key;
  end if;
end; $$;

-- Bingo: a rule that ticks an event by itself (null removes it).
create or replace function public.mod_bingo_rule(p_id integer, p_rule jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if p_rule is not null and (
       jsonb_typeof(p_rule) <> 'object'
       or p_rule ->> 't' not in ('milestone', 'double', 'donation', 'gift', 'hours', 'code', 'raised')
       or (p_rule ->> 't' in ('milestone', 'gift', 'hours') and coalesce((p_rule ->> case p_rule ->> 't' when 'hours' then 'h' else 'n' end)::numeric, 0) <= 0)
       or (p_rule ->> 't' in ('donation', 'raised') and coalesce((p_rule ->> 'eur')::numeric, 0) <= 0)) then
    raise exception 'bad_rule' using errcode = 'P0001';
  end if;
  update public.bingo_items set auto_rule = p_rule where id = p_id;
exception when invalid_text_representation then
  raise exception 'bad_rule' using errcode = 'P0001';
end; $$;

-- ---------------------------------------------------------------------------
-- Suggestions that clean themselves, and «Aprobă tot»
-- ---------------------------------------------------------------------------
-- Comparison key for suggestions: lower case, no diacritics, letters and digits only.
create or replace function private.text_key(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(translate(lower(coalesce(p, '')), 'ăâîșțşţ', 'aaistst'), '[^a-z0-9]', '', 'g');
$$;

create or replace function public.suggest(p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me      public.viewers%rowtype;
  recent  integer;
  new_id  bigint;
  k       text := private.text_key(p_body);
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if not me.is_subscriber then
    raise exception 'not_subscribed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('suggest:' || me.id::text));
  select count(*) into recent from public.suggestions
    where viewer_id = me.id and created_at > now() - interval '10 minutes';
  if recent >= 3 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  -- Automatic clean-up: no links, phone numbers or blocked words; nothing already proposed.
  if public.name_blocked(p_body) then
    raise exception 'blocked_text' using errcode = 'P0001';
  end if;
  if length(k) >= 3 and (
       exists (select 1 from public.suggestions s where s.status <> 'rejected' and private.text_key(s.body) = k)
       or exists (select 1 from public.challenges c where private.text_key(c.title) = k)) then
    raise exception 'duplicate' using errcode = 'P0001';
  end if;
  insert into public.suggestions (viewer_id, body) values (me.id, btrim(p_body))
    returning id into new_id;
  return new_id;
end; $$;

create or replace function public.mod_review_all(p_approve boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  n integer := 0;
begin
  perform private.require_moderator();
  for s in select id from public.suggestions where status = 'pending' order by created_at loop
    perform public.mod_review_suggestion(s.id, p_approve);
    n := n + 1;
  end loop;
  return n;
end; $$;

-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
revoke all on function private.me_login(), private.show_code(text, integer, text), private.double_hour(timestamptz, integer, text),
  private.alert(text, text, interval), private.pick_round(), private.bingo_rule_hit(jsonb), private.autopilot_tick(), private.text_key(text)
  from public, anon, authenticated;
revoke all on function public.mod_autopilot(), public.mod_autopilot_set(jsonb), public.mod_alert_test(),
  public.mod_plan_add(text, timestamptz, integer, timestamptz, text), public.mod_plan_del(bigint),
  public.mod_checklist_set(text, boolean), public.mod_bingo_rule(integer, jsonb), public.mod_review_all(boolean),
  public.mod_code_show(text, integer)
  from public, anon;
grant execute on function public.mod_autopilot(), public.mod_autopilot_set(jsonb), public.mod_alert_test(),
  public.mod_plan_add(text, timestamptz, integer, timestamptz, text), public.mod_plan_del(bigint),
  public.mod_checklist_set(text, boolean), public.mod_bingo_rule(integer, jsonb), public.mod_review_all(boolean),
  public.mod_code_show(text, integer)
  to authenticated;
revoke all on function public.suggest(text) from public, anon;
grant execute on function public.suggest(text) to authenticated;
