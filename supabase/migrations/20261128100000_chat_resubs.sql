-- Resubs without the "Share" button (owner, 24 Nov 2026).
--
-- Twitch sends no event for a resub the viewer doesn't share in chat. But every chat
-- message carries the subscriber badge with the viewer's cumulative months. When that
-- number goes up, the sub renewed. twitch-eventsub reads chat (channel.chat.message) and
-- calls chat_sub_months(); when it answers 'credit', the function records a 'resub' event.
--
-- No double counting:
--   * a shared resub (channel.subscription.message, with cumulative_months) and the badge
--     both go through credited_months: whichever comes first counts, the other is skipped;
--   * a new or gifted sub (channel.subscribe) is already counted by its own event (the
--     gifter's for gifts), so the next badge increase is only remembered (skip_next).
-- Badges are remembered from now on, also before the start, so on 20 Dec regular chatters
-- already have a baseline. Time is credited only while the marathon is live.
--
-- Also: viewers.is_subscriber follows Twitch at once (sub, gift received, sub ended)
-- instead of waiting for the next page visit.

create table private.sub_months (
  twitch_id        text primary key,
  login            text,
  months           integer not null default 0,
  credited_months  integer not null default 0,
  skip_next        boolean not null default false,
  updated_at       timestamptz not null default now()
);
alter table private.sub_months enable row level security;
revoke all on private.sub_months from public, anon, authenticated;

-- A chat message from a subscriber with p_months cumulative months.
-- Returns 'baseline' (first time seen), 'same', 'skipped' (already counted elsewhere or
-- the marathon isn't live) or 'credit' (record a resub now; credited_months is reserved).
create or replace function public.chat_sub_months(p_user_id text, p_login text, p_months integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.sub_months%rowtype;
  t public.timer%rowtype;
begin
  if p_user_id is null or p_months is null or p_months < 1 then
    return 'same';
  end if;

  select * into s from private.sub_months where twitch_id = p_user_id for update;
  if not found then
    -- Unknown whether this month renewed before or during the marathon: remember it,
    -- don't credit it, but leave it open for a shared resub message of the same month.
    insert into private.sub_months (twitch_id, login, months, credited_months)
    values (p_user_id, lower(p_login), p_months, p_months - 1)
    on conflict (twitch_id) do nothing;
    return 'baseline';
  end if;

  if p_months <= s.months then
    return 'same';
  end if;

  update private.sub_months
    set months = p_months, login = coalesce(lower(p_login), login), updated_at = now()
    where twitch_id = p_user_id;

  if s.skip_next then
    update private.sub_months set skip_next = false, credited_months = greatest(credited_months, p_months)
      where twitch_id = p_user_id;
    return 'skipped';
  end if;

  if s.credited_months >= p_months then
    return 'skipped';
  end if;

  select * into t from public.timer where id = 1;
  if t.status <> 'live' then
    update private.sub_months set credited_months = p_months where twitch_id = p_user_id;
    return 'skipped';
  end if;

  update private.sub_months set credited_months = p_months where twitch_id = p_user_id;
  return 'credit';
end;
$$;

-- A shared resub (channel.subscription.message). true = record it; false = the chat badge
-- already counted this month.
create or replace function public.resub_shared(p_user_id text, p_login text, p_months integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  s private.sub_months%rowtype;
begin
  if p_user_id is null or p_months is null or p_months < 1 then
    return true;
  end if;
  select * into s from private.sub_months where twitch_id = p_user_id for update;
  if found and s.credited_months >= p_months then
    return false;
  end if;
  -- A new or gifted sub seen in the last 2 days is already counted by its own event
  -- (Twitch can also offer the share message for it).
  if found and s.skip_next and s.updated_at > now() - interval '2 days' then
    update private.sub_months
      set skip_next = false, months = greatest(months, p_months), credited_months = p_months, updated_at = now()
      where twitch_id = p_user_id;
    return false;
  end if;
  insert into private.sub_months (twitch_id, login, months, credited_months)
  values (p_user_id, lower(p_login), p_months, p_months)
  on conflict (twitch_id) do update
    set months = greatest(private.sub_months.months, excluded.months),
        credited_months = excluded.credited_months,
        skip_next = false,
        login = coalesce(excluded.login, private.sub_months.login),
        updated_at = now();
  return true;
end;
$$;

-- channel.subscribe (new sub or gift received) and channel.subscription.end.
create or replace function public.sub_status_changed(p_user_id text, p_login text, p_is_sub boolean, p_tier text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return;
  end if;

  update public.viewers
    set is_subscriber = p_is_sub,
        sub_tier = case when p_is_sub then coalesce(p_tier, sub_tier) else null end,
        sub_checked_at = now()
    where twitch_id = p_user_id;

  if p_is_sub then
    -- This sub is counted by its own event; the badge increase it causes is not a resub.
    insert into private.sub_months (twitch_id, login, months, credited_months, skip_next)
    values (p_user_id, lower(p_login), 0, 0, true)
    on conflict (twitch_id) do update
      set skip_next = true, login = coalesce(excluded.login, private.sub_months.login), updated_at = now();
  end if;
end;
$$;

revoke all on function public.chat_sub_months(text, text, integer) from public, anon, authenticated;
revoke all on function public.resub_shared(text, text, integer) from public, anon, authenticated;
revoke all on function public.sub_status_changed(text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.chat_sub_months(text, text, integer) to service_role;
grant execute on function public.resub_shared(text, text, integer) to service_role;
grant execute on function public.sub_status_changed(text, text, boolean, text) to service_role;

-- /mod → Conexiuni: «Resubs din chat».
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
    'httpCalls', (select count(*) from net._http_response where created > now() - interval '30 minutes'),
    -- Resubs read from chat badges: permission, chatters remembered, resubs found.
    'resubs', jsonb_build_object(
      'canRead', coalesce((select (decrypted_secret::jsonb -> 'scopes') ? 'user:read:chat' from vault.decrypted_secrets where name = 'twitch_broadcaster_token'), false),
      'tracked', (select count(*) from private.sub_months where months > 0),
      'lastSeen', (select max(updated_at) from private.sub_months),
      'found', (select count(*) from public.events where external_id like 'chatbadge:%'))
  );
end; $$;

