-- Owner decisions of 23 Nov 2026 on docs/BUGS.md («zero is final, protect Iceman, euros only»).
-- Applied 23 Nov 2026 with the owner's OK (as «owner_decisions»). Every existing function keeps its signature,
-- so its grants stay as they are; the two new functions get explicit grants below.
--
--   B-08  Zero is final: once ends_at has passed, record_event adds nothing and ends the timer
--         at once; «+ min» and «Îngheață» refuse with timer_ended.
--   B-30  Protect Iceman: mod_set_moderator can't remove the broadcaster login.
--   B-09  Euros only: record_event refuses non-EUR donations; tipeee-donations stores them in
--         private.skipped_donations, /mod shows them under «De făcut acum» for a manual decision.

-- B-08 + B-09 -----------------------------------------------------------------
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
  p_seconds      integer default null
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
  select * into t from public.timer where id = 1 for update;

  if p_external_id is not null then
    select * into ev from public.events where external_id = p_external_id;
    if found then
      return ev;
    end if;
  end if;

  -- B-09 «euros only»: a donation in another currency never reaches the clock or Strâns.
  -- (tipeee-donations sends those to private.skipped_donations for a moderator instead.)
  if p_kind = 'donation' and upper(coalesce(p_currency, 'EUR')) <> 'EUR' then
    raise exception 'not_eur' using errcode = 'P0001';
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
  elsif t.ends_at <= now() and (t.paused_until is null or t.paused_until <= now()) then
    -- B-08 «zero is final»: the clock already reached zero. Nothing more is added, and the
    -- marathon ends now instead of at the next minute_tick (which used to leave a ~1 min gap).
    secs := 0;
    update public.timer set status = 'ended', updated_at = now() where id = 1;
  elsif secs > 0 and p_kind <> 'manual' and now() >= t.double_from and now() < t.double_until then
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

create or replace function public.freeze_timer(p_seconds integer default 300)
returns public.timer language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
begin
  if p_seconds is null or p_seconds <= 0 then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  select * into t from public.timer where id = 1 for update;
  if t.status <> 'live' then
    raise exception 'timer is not live';
  end if;
  -- B-08: at zero there is nothing left to freeze (minute_tick ends it within the minute).
  if t.ends_at is null or (t.ends_at <= now() and (t.paused_until is null or t.paused_until <= now())) then
    raise exception 'timer_ended' using errcode = 'P0001';
  end if;
  update public.timer set
    ends_at = ends_at + make_interval(secs => p_seconds),
    paused_until = greatest(coalesce(paused_until, now()), now()) + make_interval(secs => p_seconds),
    updated_at = now()
  where id = 1
  returning * into t;
  return t;
end; $$;

create or replace function public.mod_add_time(p_minutes numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
begin
  perform private.require_moderator();
  select * into t from public.timer where id = 1;
  if t.status <> 'live' then
    raise exception 'timer_not_live' using errcode = 'P0001';
  end if;
  -- B-08: zero is final, a moderator can't bring the clock back either.
  if t.ends_at is null or (t.ends_at <= now() and (t.paused_until is null or t.paused_until <= now())) then
    raise exception 'timer_ended' using errcode = 'P0001';
  end if;
  perform public.record_event('manual', 'manual', null, null, null, 'ICEMARATON', null, 1, null, round(p_minutes * 60)::integer);
end; $$;

-- B-30 -----------------------------------------------------------------------
create or replace function public.mod_set_moderator(p_login text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l text := lower(btrim(p_login));
begin
  perform private.require_moderator();
  -- Iceman's own account always stays a moderator.
  if not p_on and l = (select lower(btrim(s.broadcaster_login)) from private.settings s where s.id = 1) then
    raise exception 'protected_broadcaster' using errcode = 'P0001';
  end if;
  update public.viewers set is_moderator = p_on where login = l;
  update private.settings set
    moderator_logins = case when p_on then array(select distinct unnest(moderator_logins || l))
                            else array_remove(moderator_logins, l) end,
    updated_at = now()
  where id = 1;
end; $$;

-- B-09 -----------------------------------------------------------------------
create table if not exists private.skipped_donations (
  external_id text primary key,
  user_name   text not null,
  amount      numeric not null,
  currency    text not null,
  donated_at  timestamptz,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz,
  handled_by  text
);

-- Called by tipeee-donations (service role only) for a donation that isn't in euros.
create or replace function public.tipeee_skip(p_external_id text, p_user_name text, p_amount numeric, p_currency text, p_at timestamptz)
returns void language sql security definer set search_path = '' as $$
  insert into private.skipped_donations (external_id, user_name, amount, currency, donated_at)
  values (p_external_id, coalesce(nullif(btrim(p_user_name), ''), 'Anonim'), p_amount, upper(p_currency), p_at)
  on conflict (external_id) do nothing;
$$;
revoke all on function public.tipeee_skip(text, text, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tipeee_skip(text, text, numeric, text, timestamptz) to service_role;

-- A moderator decided (added time by hand or not): it leaves «De făcut acum».
create or replace function public.mod_skipped_done(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update private.skipped_donations
    set handled_at = now(), handled_by = (select v.login from public.viewers v where v.id = (select auth.uid()))
    where external_id = p_id and handled_at is null;
end; $$;
revoke all on function public.mod_skipped_done(text) from public, anon;
grant execute on function public.mod_skipped_done(text) to authenticated, service_role;

-- mod_health: as before, plus the donations waiting for a decision.
create or replace function public.mod_health()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  return jsonb_build_object(
    'now', now(),
    'timer', (select jsonb_build_object('status', status, 'online', stream_online) from public.timer where id = 1),
    'tipeee', (select jsonb_build_object('lastRun', last_run, 'lastCount', last_count, 'error', last_error, 'started', started) from private.tipeee_state limit 1),
    'watch', (select jsonb_build_object('lastRun', max(at), 'chatters', (select chatters from public.stream_samples order by at desc limit 1)) from public.stream_samples),
    'twitch', (select jsonb_build_object('lastEvent', max(created_at)) from public.events where source = 'twitch'),
    'donation', (select jsonb_build_object('lastEvent', max(created_at)) from public.events where source = 'donation'),
    'skipped', coalesce((select jsonb_agg(jsonb_build_object('id', external_id, 'user', user_name, 'amount', amount, 'currency', currency, 'at', coalesce(donated_at, created_at)) order by created_at)
      from private.skipped_donations where handled_at is null), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('job', j.jobname, 'status', d.status, 'at', d.start_time,
        'message', left(coalesce(d.return_message, ''), 160)) order by j.jobname)
      from cron.job j
      left join lateral (select status, start_time, return_message from cron.job_run_details r where r.jobid = j.jobid order by start_time desc limit 1) d on true
      where j.jobname like 'icemaraton%'), '[]'::jsonb),
    'httpErrors', coalesce((select jsonb_agg(jsonb_build_object('status', status_code, 'error', left(coalesce(error_msg, ''), 160), 'at', created) order by created desc)
      from (select status_code, error_msg, created from net._http_response
            where created > now() - interval '30 minutes' and (status_code is null or status_code >= 400)
            order by created desc limit 10) x), '[]'::jsonb),
    'httpCalls', (select count(*) from net._http_response where created > now() - interval '30 minutes')
  );
end; $$;
