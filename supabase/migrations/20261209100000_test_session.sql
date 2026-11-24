-- «Mod test» (owner, 24 Nov 2026): a moderator turns the whole site into a test before the marathon.
-- The real code runs on fake data (site, /mod, every OBS piece, the cron jobs), and «Oprește testul»
-- puts everything back exactly as it was.
--   * Start: every table in public and private is copied into the schema test_backup, except the
--     ones listed in private.test_keep() (identity and preparation: moderators, logins, the prep
--     checklist, TipeeeStream's read position, the cached public state, the test session itself).
--     New tables are included automatically.
--   * Stop (or by itself at «until», at the latest 30 minutes before the real start): the copied
--     tables are emptied and refilled from the copy in one transaction, with the row triggers off
--     (so totals aren't counted twice). Viewers keep their accounts; their sub status and bonus
--     spins go back. Fake viewers made by the test are deleted.
--   * While it runs: any moderator may also start/end the (test) marathon, Twitch chat lines are
--     not sent, Discord alerts are marked «TEST», and the part 'test' tells the site and overlay
--     to show the TEST banner.
--   * Only before the marathon (timer 'upcoming'). Real Twitch/TipeeeStream activity during a test
--     counts only inside the test, as before the start nothing real counts anyway.

create schema if not exists test_backup;
revoke all on schema test_backup from public, anon, authenticated;

create table private.test_session (
  id            smallint primary key default 1 check (id = 1),
  started_at    timestamptz,                       -- null = no test running
  until         timestamptz,
  hard_until    timestamptz,                       -- 30 min before the real start: never later
  by_login      text,
  tables        text[] not null default '{}',      -- 'schema.table' copied at the start
  stream_online boolean,                           -- the real LIVE flag at the start
  stream_forced boolean not null default false,    -- the test switched LIVE by hand
  forced_subs   uuid[] not null default '{}',      -- viewers the test made subscriber / not
  seq           integer not null default 0         -- fake names counter
);
insert into private.test_session (id) values (1);
create table private.test_fakes (id uuid primary key, created_at timestamptz not null default now());
alter table private.test_session enable row level security;
alter table private.test_fakes enable row level security;

insert into private.state_parts (part, version, data) values ('test', 0, 'null'::jsonb)
  on conflict (part) do nothing;

-- Tables a test never copies or restores.
create or replace function private.test_keep()
returns text[] language sql immutable as $$
  select array['private.test_session', 'private.test_fakes', 'private.state_parts', 'private.tipeee_state',
               'private.settings', 'private.mod_checklist', 'public.viewers'];
$$;

create or replace function private.test_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select started_at is not null from private.test_session where id = 1), false);
$$;

create or replace function private.test_publish()
returns void language plpgsql security definer set search_path = '' as $$
declare
  s private.test_session%rowtype;
  d jsonb;
begin
  select * into s from private.test_session where id = 1;
  d := case when s.started_at is null then 'null'::jsonb
       else jsonb_build_object('on', true, 'startedAt', s.started_at, 'until', s.until, 'hardUntil', s.hard_until, 'by', s.by_login,
                               'streamForced', s.stream_forced) end;
  update private.state_parts set version = version + 1, data = d, updated_at = now()
    where part = 'test' and data is distinct from d;
end; $$;

-- Copy every table (except test_keep) into test_backup.
create or replace function private.test_save()
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  r record;
  saved text[] := '{}';
begin
  drop schema if exists test_backup cascade;
  create schema test_backup;
  revoke all on schema test_backup from public;
  for r in
    select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition and n.nspname in ('public', 'private')
      and not ((n.nspname || '.' || c.relname) = any (private.test_keep()))
    order by 1, 2
  loop
    execute format('create table test_backup.%I as table %I.%I', r.s || '__' || r.t, r.s, r.t);
    saved := saved || (r.s || '.' || r.t);
  end loop;
  create table test_backup.viewers_game as
    select id, is_subscriber, sub_tier, sub_checked_at, bonus_spins from public.viewers;
  -- What the site and overlay were showing (put back as it was, no recompute needed).
  create table test_backup.state_parts_copy as select part, data from private.state_parts;
  return saved;
end; $$;

-- Put the copied tables back (one transaction: all or nothing).
create or replace function private.test_restore_data(p_tables text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  t text;
  todo text[] := p_tables;
  ready text[];
  cols text;
  real_online boolean := (select stream_online from public.timer where id = 1);
  s private.test_session%rowtype;
begin
  select * into s from private.test_session where id = 1;
  if cardinality(p_tables) = 0 then return; end if;
  foreach t in array p_tables loop
    if to_regclass(t) is null or to_regclass('test_backup.' || replace(t, '.', '__')) is null then
      raise exception 'test_backup_missing %', t using errcode = 'P0001';
    end if;
  end loop;
  foreach t in array p_tables loop execute format('alter table %s disable trigger user', t); end loop;
  execute 'truncate ' || (select string_agg(x, ', ') from unnest(p_tables) x);
  -- Parents before children (foreign keys).
  while cardinality(todo) > 0 loop
    select coalesce(array_agg(x), '{}') into ready from unnest(todo) x
      where not exists (
        select 1 from pg_constraint c
        where c.contype = 'f' and c.conrelid = to_regclass(x) and c.confrelid <> c.conrelid
          and (c.confrelid::regclass::text) = any (todo));
    if cardinality(ready) = 0 then raise exception 'test_restore_cycle' using errcode = 'P0001'; end if;
    foreach t in array ready loop
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a
        where a.attrelid = to_regclass(t) and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          and exists (select 1 from pg_attribute b
                      where b.attrelid = to_regclass('test_backup.' || replace(t, '.', '__'))
                        and b.attname = a.attname and not b.attisdropped);
      if cols is not null then
        execute format('insert into %s (%s) overriding system value select %s from test_backup.%I',
                       t, cols, cols, replace(t, '.', '__'));
      end if;
    end loop;
    todo := array(select x from unnest(todo) x where not (x = any (ready)));
  end loop;
  foreach t in array p_tables loop execute format('alter table %s enable trigger user', t); end loop;

  -- Viewers keep their accounts; what the test changed about them goes back.
  update public.viewers v set is_subscriber = g.is_subscriber, sub_tier = g.sub_tier,
    sub_checked_at = g.sub_checked_at, bonus_spins = g.bonus_spins
    from test_backup.viewers_game g where g.id = v.id;
  update public.viewers v set is_subscriber = false, sub_tier = null, sub_checked_at = null, bonus_spins = 0
    where not exists (select 1 from test_backup.viewers_game g where g.id = v.id);
  delete from auth.users where id in (select id from private.test_fakes);
  delete from private.test_fakes;

  -- LIVE on Twitch: the real flag, unless the test switched it by hand.
  update public.timer set stream_online = case when s.stream_forced then coalesce(s.stream_online, false) else real_online end
    where id = 1;
  -- The public state as it was (version bumped so every page fetches it), then the live parts fresh.
  update private.state_parts p set version = p.version + 1, data = c.data, updated_at = now()
    from test_backup.state_parts_copy c
    where c.part = p.part and p.part not in ('test', 'rehearsal', 'otest') and p.data is distinct from c.data;
  update private.state_parts set version = version + 1, data = 'null'::jsonb, updated_at = now()
    where part in ('rehearsal', 'otest') and data is distinct from 'null'::jsonb;
  perform private.refresh_parts(array['timer', 'vote']);
end; $$;

create or replace function private.test_end(p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s private.test_session%rowtype;
begin
  select * into s from private.test_session where id = 1 for update;
  if s.started_at is null then return; end if;
  perform private.test_restore_data(s.tables);
  update private.test_session set started_at = null, until = null, hard_until = null, by_login = null, tables = '{}',
    stream_online = null, stream_forced = false, forced_subs = '{}' where id = 1;
  perform private.test_publish();
  perform private.alert('test', 'Testul s-a oprit (' || p_reason || '). Site-ul e din nou cel real.');
end; $$;

-- Cron: the test ends by itself at «until».
create or replace function private.test_tick()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from private.test_session where id = 1 and started_at is not null and until <= now()) then
    perform private.test_end('timpul testului s-a terminat');
  end if;
end; $$;

-- A fake name: «TestViscol12».
create or replace function private.test_name()
returns text language plpgsql security definer set search_path = '' as $$
declare
  words text[] := array['Viscol', 'Fulg', 'Ger', 'Nea', 'Polar', 'Crivat', 'Omat', 'Sanie', 'Turture', 'Zapada', 'Iarna', 'Brad', 'Chiciura', 'Ren', 'Patina', 'Bruma'];
  n integer;
begin
  update private.test_session set seq = seq + 1 where id = 1 returning seq into n;
  return 'Test' || words[1 + (n % cardinality(words))] || (10 + (n * 37) % 90)::text;
end; $$;

-- Fake viewers (auth user + viewer), each with watch time, a vote in the open round and a bingo
-- line while bingo is open, and now and then a suggestion. All deleted when the test ends.
create or replace function private.test_crowd(p_n integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  i integer;
  uid uuid;
  nm text;
  tid text;
  sub boolean;
  rnd public.vote_rounds%rowtype;
  ch integer;
  line integer[];
  today date := (now() at time zone 'Europe/Bucharest')::date;
  mins integer;
begin
  if (select count(*) from private.test_fakes) + p_n > 500 then raise exception 'test_crowd_full' using errcode = 'P0001'; end if;
  select * into rnd from public.vote_rounds where now() >= coalesce(opens_at, now()) and now() < closes_at order by id desc limit 1;
  for i in 1..p_n loop
    uid := gen_random_uuid();
    nm := private.test_name();
    tid := 'test-' || replace(uid::text, '-', '');
    insert into auth.users (id, instance_id, aud, role, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
      values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              jsonb_build_object('provider', 'icemaraton_test'),
              jsonb_build_object('provider_id', tid, 'nickname', lower(nm), 'full_name', nm), now(), now());
    insert into private.test_fakes (id) values (uid);
    -- handle_new_user made the viewer; make sure it is there.
    insert into public.viewers (id, twitch_id, login, display_name) values (uid, tid, lower(nm), nm) on conflict (id) do nothing;
    sub := random() < 0.7;
    update public.viewers set is_subscriber = sub, sub_tier = case when sub then '1000' end, sub_checked_at = now() where id = uid;
    mins := 10 * (3 + floor(random() * 40))::integer;
    insert into public.watch_time (twitch_id, login, display_name, minutes) values (tid, lower(nm), nm, mins)
      on conflict (twitch_id) do update set minutes = public.watch_time.minutes + excluded.minutes;
    insert into public.watch_daily (twitch_id, day, minutes) values (tid, today, least(mins, 240))
      on conflict (twitch_id, day) do update set minutes = public.watch_daily.minutes + excluded.minutes;
    if sub and rnd.id is not null then
      select challenge_id into ch from public.round_challenges where round_id = rnd.id order by random() limit 1;
      if ch is not null then
        insert into public.votes (round_id, viewer_id, challenge_id) values (rnd.id, uid, ch) on conflict do nothing;
        if found then update public.round_challenges set votes = votes + 1 where round_id = rnd.id and challenge_id = ch; end if;
      end if;
    end if;
    if private.bingo_phase() = 'open' then
      select l into line from private.bingo_lines() l order by random() limit 1;
      if line is not null then
        insert into public.bingo_picks (viewer_id, items) values (uid, line) on conflict (viewer_id) do update set items = excluded.items;
      end if;
    end if;
    if sub and random() < 0.15 then
      insert into public.suggestions (viewer_id, body) values (uid, 'Sugestie de test #' || (select seq from private.test_session where id = 1));
    end if;
  end loop;
  return p_n;
end; $$;

create or replace function public.mod_test(p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s private.test_session%rowtype;
  t public.timer%rowtype;
  me public.viewers%rowtype;
  hrs numeric := greatest(1, least(coalesce((p ->> 'hours')::numeric, 3), 6));
  hard timestamptz;
  nm text;
  n numeric;
  tier text;
  saved text[];
  mins integer;
begin
  perform private.require_moderator();
  select * into s from private.test_session where id = 1 for update;
  select * into t from public.timer where id = 1;
  select * into me from public.viewers where id = (select auth.uid());

  if p_action = 'start' then
    if s.started_at is not null then raise exception 'test_running' using errcode = 'P0001'; end if;
    if t.status <> 'upcoming' then raise exception 'test_while_live' using errcode = 'P0001'; end if;
    hard := case when t.starts_at > now() then t.starts_at - interval '30 minutes' end;
    if hard is not null and hard < now() + interval '15 minutes' then raise exception 'test_too_close' using errcode = 'P0001'; end if;
    saved := private.test_save();
    update private.test_session set started_at = now(), until = least(now() + make_interval(secs => (hrs * 3600)::integer), coalesce(hard, 'infinity')),
      hard_until = hard, by_login = me.login, tables = saved, stream_online = t.stream_online, stream_forced = false,
      forced_subs = '{}', seq = 0 where id = 1;
    -- The practice clock is not needed during a test.
    update private.state_parts set version = version + 1, data = 'null'::jsonb, updated_at = now() where part = 'rehearsal';
    perform private.test_publish();
    perform private.alert('test', 'Test pornit de ' || coalesce(me.login, 'un moderator') || '. Ce se întâmplă acum pe site nu e real și se șterge la oprire.');
    return (select data from private.state_parts where part = 'test');
  end if;

  if s.started_at is null then raise exception 'test_off' using errcode = 'P0001'; end if;

  case p_action
    when 'stop' then
      perform private.test_end('oprit de ' || coalesce(me.login, 'un moderator'));
      return 'null'::jsonb;
    when 'redo' then
      -- From the beginning: back to the saved copy, the test keeps running.
      perform private.test_restore_data(s.tables);
      update private.test_session set stream_forced = false, forced_subs = '{}' where id = 1;
    when 'extend' then
      update private.test_session set until = least(until + interval '1 hour', coalesce(hard_until, 'infinity'), now() + interval '6 hours') where id = 1;
    when 'sub', 'resub', 'gift', 'bits', 'donation' then
      nm := private.test_name();
      n := coalesce((p ->> 'n')::numeric, case p_action when 'gift' then 5 when 'bits' then 400 when 'donation' then 5 else 1 end);
      if n <= 0 or n > 100000 then raise exception 'bad_test_amount' using errcode = 'P0001'; end if;
      tier := case when p_action in ('sub', 'resub') then coalesce(p ->> 'tier', '1000') end;
      perform public.record_event(case when p_action = 'donation' then 'donation' else 'twitch' end, p_action,
        'test-' || gen_random_uuid()::text, 'test-' || lower(nm), lower(nm), nm, tier,
        case when p_action in ('sub', 'resub') then 1 else n end, case when p_action = 'donation' then 'EUR' end, null);
    when 'crowd' then
      perform private.test_crowd(greatest(1, least(coalesce((p ->> 'n')::integer, 25), 100)));
    when 'me_sub' then
      if me.id is null then raise exception 'not_logged_in' using errcode = '28000'; end if;
      update public.viewers set is_subscriber = coalesce((p ->> 'on')::boolean, true),
        sub_tier = case when coalesce((p ->> 'on')::boolean, true) then '1000' end, sub_checked_at = now() where id = me.id;
      update private.test_session set forced_subs = array(select distinct x from unnest(forced_subs || me.id) x) where id = 1;
    when 'me_watch' then
      if me.id is null then raise exception 'not_logged_in' using errcode = '28000'; end if;
      mins := greatest(1, least(coalesce((p ->> 'minutes')::integer, 120), 600));
      insert into public.watch_time (twitch_id, login, display_name, minutes) values (me.twitch_id, me.login, me.display_name, mins)
        on conflict (twitch_id) do update set minutes = public.watch_time.minutes + excluded.minutes, updated_at = now();
      insert into public.watch_daily (twitch_id, day, minutes) values (me.twitch_id, (now() at time zone 'Europe/Bucharest')::date, mins)
        on conflict (twitch_id, day) do update set minutes = public.watch_daily.minutes + excluded.minutes;
    when 'stream' then
      update public.timer set stream_online = coalesce((p ->> 'on')::boolean, not coalesce(stream_online, false)), updated_at = now() where id = 1;
      update private.test_session set stream_forced = true where id = 1;
    else
      raise exception 'bad_test_action' using errcode = 'P0001';
  end case;
  perform private.test_publish();
  return (select data from private.state_parts where part = 'test');
end; $$;

-- During a test any moderator may start and end the (test) marathon: it is all put back.
create or replace function private.require_broadcaster()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if not private.is_broadcaster() and not private.test_active() then
    raise exception 'only_broadcaster' using errcode = '42501';
  end if;
end; $$;

-- Discord alerts during a test say so.
alter function private.alert(text, text, interval) rename to alert_base;
create function private.alert(p_kind text, p_text text, p_every interval default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  return private.alert_base(p_kind, case when private.test_active() then '🧪 TEST · ' || p_text else p_text end, p_every);
end; $$;

-- No Twitch chat lines during a test.
alter function public.chat_line_claim(bigint) set schema private;
alter function private.chat_line_claim(bigint) rename to chat_line_claim_base;
create function public.chat_line_claim(p_event bigint)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if private.test_active() then return null; end if;
  return private.chat_line_claim_base(p_event);
end; $$;

-- The Twitch sub check doesn't undo «Eu: abonat» during a test.
create or replace function public.set_viewer_sub(p_viewer uuid, p_is_sub boolean, p_tier text)
returns void language sql security definer set search_path = '' as $$
  update public.viewers
    set is_subscriber = p_is_sub, sub_tier = p_tier, sub_checked_at = now()
    where id = p_viewer
      and not exists (select 1 from private.test_session s where s.id = 1 and s.started_at is not null and p_viewer = any (s.forced_subs));
$$;

revoke all on function private.test_keep(), private.test_active(), private.test_publish(), private.test_save(),
  private.test_restore_data(text[]), private.test_end(text), private.test_tick(), private.test_name(), private.test_crowd(integer),
  private.alert(text, text, interval), private.alert_base(text, text, interval), private.chat_line_claim_base(bigint)
  from public, anon, authenticated;
revoke all on function public.mod_test(text, jsonb) from public, anon;
grant execute on function public.mod_test(text, jsonb) to authenticated;
revoke all on function public.chat_line_claim(bigint) from public, anon, authenticated;
grant execute on function public.chat_line_claim(bigint) to service_role;

select cron.schedule('icemaraton-test-end', '* * * * *', $$select private.test_tick()$$);
