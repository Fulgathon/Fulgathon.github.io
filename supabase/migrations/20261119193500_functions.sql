-- FULGATHON phase 2: server-side logic.
--
-- Two kinds of functions:
--   * For logged-in viewers (callable from the site with supabase.rpc):
--       cast_vote, suggest, spin, wheel_status
--   * For the backend only (service role, i.e. Edge Functions / dashboard):
--       record_event, start_timer, freeze_timer, set_double_hour, credit_watch_time
-- All are SECURITY DEFINER with an empty search_path and fully qualified names.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- New Twitch login -> viewers row.
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.viewers (id, twitch_id, login, display_name)
  values (
    new.id,
    coalesce(meta ->> 'provider_id', meta ->> 'sub'),
    lower(coalesce(meta ->> 'nickname', meta ->> 'preferred_username', meta ->> 'user_name', meta ->> 'name')),
    coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname')
  )
  on conflict do nothing;  -- never block a login over a duplicate
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- record_event: the only way time gets added. Called by the Twitch EventSub
-- and donation Edge Functions (service role).
--   * Dedupes on p_external_id, so Twitch retries are harmless.
--   * Converts the event to seconds with public.rates (proportional for bits
--     and donations), doubles it during "Ora dublă".
--   * Adds time only while the timer is live; events are still recorded.
--   * Keeps stats and goals up to date.
-- Note for the EventSub handler: channel.subscribe also fires for every gift
-- recipient (is_gift = true). Skip those and use channel.subscription.gift.
-- ---------------------------------------------------------------------------
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

  update public.goals
    set unlocked_at = now()
    where unlocked_at is null
      and threshold <= (select s.subs from public.stats s where s.id = 1);

  insert into public.events (source, kind, external_id, user_id, user_login, user_name, tier, quantity, currency, seconds_added, doubled)
  values (p_source, p_kind, p_external_id, p_user_id, lower(p_user_login), p_user_name, p_tier, coalesce(p_quantity, 1), p_currency, secs, doubled)
  returning * into ev;

  return ev;
end;
$$;

-- Start the subathon: the timer goes live with p_seconds on the clock.
create or replace function public.start_timer(p_seconds integer, p_scheduled_end timestamptz default null)
returns public.timer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timer%rowtype;
begin
  if p_seconds is null or p_seconds <= 0 then
    raise exception 'p_seconds must be positive';
  end if;
  update public.timer set
    status = 'live',
    starts_at = now(),
    ends_at = now() + make_interval(secs => p_seconds),
    scheduled_end = coalesce(p_scheduled_end, scheduled_end),
    paused_until = null,
    updated_at = now()
  where id = 1
  returning * into t;
  return t;
end;
$$;

-- "Îngheți timpul": the countdown stands still for p_seconds.
-- Browsers show ends_at - paused_until while now() < paused_until.
create or replace function public.freeze_timer(p_seconds integer default 300)
returns public.timer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timer%rowtype;
begin
  select * into t from public.timer where id = 1 for update;
  if t.status <> 'live' then
    raise exception 'timer is not live';
  end if;
  update public.timer set
    ends_at = ends_at + make_interval(secs => p_seconds),
    paused_until = greatest(coalesce(paused_until, now()), now()) + make_interval(secs => p_seconds),
    updated_at = now()
  where id = 1
  returning * into t;
  return t;
end;
$$;

-- "Ora dublă": added time counts double from p_from for p_minutes.
create or replace function public.set_double_hour(p_from timestamptz, p_minutes integer default 60)
returns public.timer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.timer%rowtype;
begin
  update public.timer set
    double_from = p_from,
    double_until = p_from + make_interval(mins => p_minutes),
    updated_at = now()
  where id = 1
  returning * into t;
  return t;
end;
$$;

-- Watch time from chat presence: the watch-time Edge Function calls this
-- every few minutes with everyone in chat:
--   [{"id": "<twitch user id>", "login": "...", "name": "...", "sub": true}, ...]
-- Every full hour becomes 1 snowflake (2 for subscribers).
create or replace function public.credit_watch_time(p_viewers jsonb, p_minutes integer default 5)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  credited integer;
begin
  if p_minutes is null or p_minutes <= 0 or p_minutes > 60 then
    raise exception 'p_minutes must be between 1 and 60';
  end if;

  with input as (
    select distinct on (x ->> 'id')
      x ->> 'id' as id, lower(x ->> 'login') as login, x ->> 'name' as name
    from jsonb_array_elements(coalesce(p_viewers, '[]'::jsonb)) as x
    where x ->> 'id' is not null and x ->> 'login' is not null
  )
  insert into public.watch_time as w (twitch_id, login, display_name, minutes, minutes_to_flake)
  select id, login, name, p_minutes, p_minutes from input
  on conflict (twitch_id) do update set
    minutes = w.minutes + excluded.minutes,
    minutes_to_flake = w.minutes_to_flake + excluded.minutes_to_flake,
    login = excluded.login,
    display_name = coalesce(excluded.display_name, w.display_name),
    updated_at = now();
  get diagnostics credited = row_count;

  update public.watch_time as w set
    flakes = w.flakes + (w.minutes_to_flake / 60) * case
      when coalesce((i.x ->> 'sub')::boolean, false)
        or exists (select 1 from public.viewers v where v.twitch_id = w.twitch_id and v.is_subscriber)
      then 2 else 1 end,
    minutes_to_flake = w.minutes_to_flake % 60
  from jsonb_array_elements(coalesce(p_viewers, '[]'::jsonb)) as i (x)
  where w.twitch_id = i.x ->> 'id' and w.minutes_to_flake >= 60;

  return credited;
end;
$$;

-- ---------------------------------------------------------------------------
-- Functions for logged-in viewers.
-- ---------------------------------------------------------------------------

-- One vote per subscriber per round; calling again moves the vote.
create or replace function public.cast_vote(p_round integer, p_challenge integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me   public.viewers%rowtype;
  rnd  public.vote_rounds%rowtype;
  old  integer;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if not me.is_subscriber then
    raise exception 'not_subscribed' using errcode = '42501';
  end if;

  -- Lock the round: votes in one round are applied one at a time.
  select * into rnd from public.vote_rounds where id = p_round for update;
  if not found or now() < rnd.opens_at or now() >= rnd.closes_at then
    raise exception 'round_closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.round_challenges where round_id = p_round and challenge_id = p_challenge) then
    raise exception 'not_in_round' using errcode = 'P0001';
  end if;

  select challenge_id into old from public.votes where round_id = p_round and viewer_id = me.id;
  if old = p_challenge then
    return;
  end if;

  if old is not null then
    update public.round_challenges set votes = votes - 1 where round_id = p_round and challenge_id = old;
    update public.votes set challenge_id = p_challenge, updated_at = now() where round_id = p_round and viewer_id = me.id;
  else
    insert into public.votes (round_id, viewer_id, challenge_id) values (p_round, me.id, p_challenge);
  end if;
  update public.round_challenges set votes = votes + 1 where round_id = p_round and challenge_id = p_challenge;
end;
$$;

-- Challenge suggestion from a subscriber (max 3 per 10 minutes).
create or replace function public.suggest(p_body text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  me      public.viewers%rowtype;
  recent  integer;
  new_id  bigint;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if not me.is_subscriber then
    raise exception 'not_subscribed' using errcode = '42501';
  end if;
  select count(*) into recent from public.suggestions
    where viewer_id = me.id and created_at > now() - interval '10 minutes';
  if recent >= 3 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  insert into public.suggestions (viewer_id, body) values (me.id, btrim(p_body))
    returning id into new_id;
  return new_id;
end;
$$;

-- Snowflakes and spins for the logged-in viewer.
create or replace function public.wheel_status()
returns table (flakes integer, spins_available integer, flakes_toward_spin integer, minutes_to_next_flake integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(w.flakes, 0),
    greatest(coalesce(w.flakes, 0) / 3
      - (select count(*) from public.spins s where s.twitch_id = v.twitch_id)::integer, 0),
    coalesce(w.flakes, 0) % 3,
    60 - coalesce(w.minutes_to_flake, 0)
  from public.viewers v
  left join public.watch_time w on w.twitch_id = v.twitch_id
  where v.id = (select auth.uid());
$$;

-- Spin the wheel: the server picks the prize (weighted), the browser only
-- animates to it. 3 snowflakes = 1 spin; snowflakes are never consumed.
create or replace function public.spin()
returns table (spin_id bigint, prize_position smallint, full_label text, is_win boolean, spins_left integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me            public.viewers%rowtype;
  w             public.watch_time%rowtype;
  p             public.prizes%rowtype;
  used          integer;
  total_weight  integer;
  pick          integer;
  new_id        bigint;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found or me.twitch_id is null then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;

  -- Lock this viewer's watch-time row so double clicks can't overspend.
  select * into w from public.watch_time where twitch_id = me.twitch_id for update;
  if not found then
    raise exception 'no_spins' using errcode = 'P0001';
  end if;
  select count(*) into used from public.spins where twitch_id = me.twitch_id;
  if w.flakes / 3 - used <= 0 then
    raise exception 'no_spins' using errcode = 'P0001';
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
    values (me.twitch_id, coalesce(me.login, w.login), p.position)
    returning id into new_id;

  return query select new_id, p.position, p.full_label, p.is_win, (w.flakes / 3 - used - 1)::integer;
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may call what.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.cast_vote(integer, integer),
  public.suggest(text),
  public.spin(),
  public.wheel_status()
  to authenticated;
grant execute on all functions in schema public to service_role;
