-- One cheap public call instead of 16 queries per page per minute.
--
-- The page's public data is split into parts (timer, stats, feed, boards,
-- goals, vote, prizes, wins, bingo). Each part is computed ONCE when its
-- tables change (statement triggers) and cached with a version number in
-- private.state_parts; a part only gets a new version when its data really
-- changed. Browsers call public_state(<versions they have>) every few seconds
-- and get back only the parts that changed, usually a few hundred bytes. The
-- cost per viewer is a primary-key read, whatever happens on stream.
--
-- Leaderboards read running totals (private.supporter_totals, kept by a
-- trigger on events) instead of summing the events table on every request.
-- Every public name goes through public.public_name() (opt-out, moderation).

-- ---------------------------------------------------------------------------
-- Running totals per supporter.
-- ---------------------------------------------------------------------------
create table private.supporter_totals (
  key        text primary key,          -- lower(login), or lower(name) for donors without a login
  user_login text,
  user_name  text,
  subs       integer not null default 0,
  gifts      integer not null default 0,
  bits       integer not null default 0,
  donated    numeric not null default 0,
  seconds    bigint  not null default 0,
  first_at   timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
create index supporter_totals_gifts_idx   on private.supporter_totals (gifts desc);
create index supporter_totals_bits_idx    on private.supporter_totals (bits desc);
create index supporter_totals_donated_idx on private.supporter_totals (donated desc);
create index if not exists watch_time_minutes_idx on public.watch_time (minutes desc);

create or replace function private.add_to_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  k text := lower(btrim(coalesce(nullif(new.user_login, ''), new.user_name, '')));
begin
  if k = '' or k in ('anonim', 'anonymous') then return null; end if;
  insert into private.supporter_totals as t (key, user_login, user_name, subs, gifts, bits, donated, seconds, first_at, last_at)
  values (k, new.user_login, new.user_name,
          case when new.kind in ('sub', 'resub') then 1 else 0 end,
          case when new.kind = 'gift' then floor(new.quantity)::integer else 0 end,
          case when new.kind = 'bits' then floor(new.quantity)::integer else 0 end,
          case when new.kind = 'donation' then new.quantity else 0 end,
          new.seconds_added, new.created_at, new.created_at)
  on conflict (key) do update set
    user_login = coalesce(excluded.user_login, t.user_login),
    user_name  = coalesce(excluded.user_name, t.user_name),
    subs = t.subs + excluded.subs, gifts = t.gifts + excluded.gifts, bits = t.bits + excluded.bits,
    donated = t.donated + excluded.donated, seconds = t.seconds + excluded.seconds,
    last_at = excluded.last_at;
  return null;
end; $$;

create trigger events_add_to_totals after insert on public.events
  for each row execute function private.add_to_totals();

insert into private.supporter_totals (key, user_login, user_name, subs, gifts, bits, donated, seconds, first_at, last_at)
select lower(btrim(coalesce(nullif(user_login, ''), user_name))), max(user_login), max(user_name),
       count(*) filter (where kind in ('sub', 'resub')),
       coalesce(sum(floor(quantity)) filter (where kind = 'gift'), 0),
       coalesce(sum(floor(quantity)) filter (where kind = 'bits'), 0),
       coalesce(sum(quantity) filter (where kind = 'donation'), 0),
       sum(seconds_added), min(created_at), max(created_at)
from public.events
where lower(btrim(coalesce(nullif(user_login, ''), user_name, ''))) not in ('', 'anonim', 'anonymous')
group by 1
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- The parts.
-- ---------------------------------------------------------------------------
create table private.state_parts (
  part       text primary key,
  version    bigint not null default 0,
  data       jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);

-- Top supporters for one total, public names only (hidden ones are skipped).
create or replace function private.top_supporters(p_col text, p_limit integer default 5)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  out jsonb;
begin
  execute format($q$
    select coalesce(jsonb_agg(jsonb_build_array(n, t) order by t desc), '[]'::jsonb) from (
      select n, t from (
        select public.public_name(user_login, user_name) as n, round(%1$I)::bigint as t
        from private.supporter_totals where %1$I > 0 order by %1$I desc limit 30
      ) x where n <> 'Anonim' order by t desc limit %2$s
    ) y $q$, p_col, p_limit) into out;
  return out;
end; $$;

create or replace function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r record;
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
  else
    raise exception 'unknown part %', p_part;
  end case;
end; $$;

-- Recompute parts; bump the version only when the data really changed.
create or replace function private.refresh_parts(p_parts text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  p text;
  d jsonb;
begin
  foreach p in array p_parts loop
    d := coalesce(private.compute_part(p), 'null'::jsonb);
    insert into private.state_parts (part, version, data) values (p, 1, d)
    on conflict (part) do update set version = private.state_parts.version + 1, data = excluded.data, updated_at = now()
      where private.state_parts.data is distinct from excluded.data;
  end loop;
end; $$;

create or replace function private.on_state_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_parts(tg_argv::text[]);
  return null;
end; $$;

create trigger state_timer      after insert or update or delete on public.timer            for each statement execute function private.on_state_change('timer');
create trigger state_stats      after insert or update or delete on public.stats            for each statement execute function private.on_state_change('stats');
create trigger state_events     after insert or update or delete on public.events           for each statement execute function private.on_state_change('feed', 'boards');
create trigger state_watch      after insert or update or delete on public.watch_time       for each statement execute function private.on_state_change('boards');
create trigger state_names      after insert or update or delete on private.name_rules      for each statement execute function private.on_state_change('feed', 'boards', 'wins');
create trigger state_goals      after insert or update or delete on public.goals            for each statement execute function private.on_state_change('goals');
create trigger state_rounds     after insert or update or delete on public.vote_rounds      for each statement execute function private.on_state_change('vote');
create trigger state_round_ch   after insert or update or delete on public.round_challenges for each statement execute function private.on_state_change('vote');
create trigger state_challenges after insert or update or delete on public.challenges       for each statement execute function private.on_state_change('vote');
create trigger state_prizes     after insert or update or delete on public.prizes           for each statement execute function private.on_state_change('prizes', 'wins');
create trigger state_spins      after insert or update or delete on public.spins            for each statement execute function private.on_state_change('wins');
create trigger state_bingo_i    after insert or update or delete on public.bingo_items      for each statement execute function private.on_state_change('bingo');
create trigger state_bingo_s    after insert or update or delete on public.bingo_settings   for each statement execute function private.on_state_change('bingo');
create trigger state_bingo_p    after insert or update or delete on public.bingo_picks      for each statement execute function private.on_state_change('bingo');

select private.refresh_parts(array['timer', 'stats', 'feed', 'boards', 'goals', 'vote', 'prizes', 'wins', 'bingo']);

-- A vote round opens at its time without a write; check the time-based parts every minute.
select cron.schedule('icemaraton-state', '* * * * *', $$select private.refresh_parts(array['vote', 'timer'])$$);

-- ---------------------------------------------------------------------------
-- The public call. p_have = {"timer": 12, "feed": 40, ...} (what the page has).
-- Returns {"v": {all versions}, "parts": {only the parts that changed}}.
-- ---------------------------------------------------------------------------
create or replace function public.public_state(p_have jsonb default '{}'::jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'v', coalesce(jsonb_object_agg(part, version), '{}'::jsonb),
    'parts', coalesce(jsonb_object_agg(part, data) filter (where (coalesce(p_have, '{}'::jsonb) ->> part) is distinct from version::text), '{}'::jsonb),
    'now', now())
  from private.state_parts;
$$;

-- The logged-in viewer's own state in one call (replaces 4 queries).
create or replace function public.my_state(p_round integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.viewers%rowtype;
  w jsonb;
begin
  select * into v from public.viewers where id = auth.uid();
  if not found then return null; end if;
  select to_jsonb(x) into w from public.wheel_status() x limit 1;
  w := coalesce(w, '{}'::jsonb);
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
    'bingo', (select to_jsonb(items) from public.bingo_picks where viewer_id = v.id));
end; $$;

revoke all on function public.public_state(jsonb), public.my_state(integer) from public, anon, authenticated;
grant execute on function public.public_state(jsonb) to anon, authenticated;
grant execute on function public.my_state(integer) to authenticated;

-- The old leaderboard views (still read by the deployed page until the new one
-- ships) now come from the running totals and only show public names.
create or replace view public.leaderboard_gifts with (security_invoker = off) as
  select user_login, public.public_name(user_login, user_name) as user_name, gifts as total
  from private.supporter_totals where gifts > 0 and public.public_name(user_login, user_name) <> 'Anonim'
  order by gifts desc limit 10;
create or replace view public.leaderboard_bits with (security_invoker = off) as
  select user_login, public.public_name(user_login, user_name) as user_name, bits as total
  from private.supporter_totals where bits > 0 and public.public_name(user_login, user_name) <> 'Anonim'
  order by bits desc limit 10;
create or replace view public.leaderboard_donations with (security_invoker = off) as
  select coalesce(user_login, key) as user_login, public.public_name(user_login, user_name) as user_name, round(donated)::integer as total
  from private.supporter_totals where donated > 0 and public.public_name(user_login, user_name) <> 'Anonim'
  order by donated desc limit 10;
create or replace view public.leaderboard_hours with (security_invoker = off) as
  select login as user_login, public.public_name(login, display_name) as user_name, (minutes / 60)::integer as total
  from public.watch_time where public.public_name(login, display_name) <> 'Anonim'
  order by minutes desc limit 10;
