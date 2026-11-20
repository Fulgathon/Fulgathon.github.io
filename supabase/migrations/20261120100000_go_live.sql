-- FULGATHON: everything needed to go live once Twitch is connected.
--
--   * private.settings: broadcaster and moderator logins.
--   * Vault secrets (generated here, never in the repo): EventSub signing
--     secret, cron secret, and later the broadcaster's Twitch token.
--   * timer.stream_online, set by Twitch's stream.online/offline events.
--   * Backend-only helpers for the Edge Functions.
--   * Moderator functions for the /mod page.
--   * Scheduled jobs: close finished vote rounds, end the timer at zero,
--     credit watch time every 5 minutes.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Settings and secrets
-- ---------------------------------------------------------------------------
create table private.settings (
  id                 smallint primary key default 1 check (id = 1),
  broadcaster_login  text not null default 'icemanlucky',
  broadcaster_id     text,                       -- filled when the streamer connects
  moderator_logins   text[] not null default array['icemanlucky'],
  functions_url      text not null default 'https://yvbxtsuddjqqoogdoqrx.supabase.co/functions/v1',
  updated_at         timestamptz not null default now()
);
insert into private.settings (id) values (1);

select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'eventsub_secret', 'Signs Twitch EventSub webhooks');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'cron_secret', 'Authenticates the watch-time cron call');

alter table public.timer add column stream_online boolean not null default false;

-- New logins listed in settings.moderator_logins become moderators automatically.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  login text := lower(coalesce(meta ->> 'nickname', meta ->> 'preferred_username', meta ->> 'user_name', meta ->> 'name'));
begin
  insert into public.viewers (id, twitch_id, login, display_name, is_moderator)
  values (
    new.id,
    coalesce(meta ->> 'provider_id', meta ->> 'sub'),
    login,
    coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname'),
    login = any ((select s.moderator_logins from private.settings s where s.id = 1))
  )
  on conflict do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backend-only helpers (service role, used by the Edge Functions)
-- ---------------------------------------------------------------------------
create or replace function public.twitch_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'broadcaster_login', s.broadcaster_login,
    'broadcaster_id', s.broadcaster_id,
    'functions_url', s.functions_url,
    'eventsub_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'eventsub_secret'),
    'cron_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    'token', (select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'twitch_broadcaster_token')
  )
  from private.settings s where s.id = 1;
$$;

-- Store (or refresh) the broadcaster's Twitch token in Vault.
create or replace function public.save_broadcaster_token(p_token jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = 'twitch_broadcaster_token';
  if existing is null then
    perform vault.create_secret(p_token::text, 'twitch_broadcaster_token', 'Broadcaster user token (subs, bits, chatters)');
  else
    perform vault.update_secret(existing, p_token::text);
  end if;
  update private.settings set broadcaster_id = p_token ->> 'user_id', updated_at = now() where id = 1;
end;
$$;

create or replace function public.set_stream_online(p_online boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.timer set stream_online = p_online, updated_at = now() where id = 1;
$$;

create or replace function public.set_viewer_sub(p_viewer uuid, p_is_sub boolean, p_tier text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.viewers
    set is_subscriber = p_is_sub, sub_tier = p_tier, sub_checked_at = now()
    where id = p_viewer;
$$;

-- ---------------------------------------------------------------------------
-- Moderators
-- ---------------------------------------------------------------------------
create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select v.is_moderator from public.viewers v where v.id = (select auth.uid())), false);
$$;

create or replace function private.require_moderator()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_moderator() then
    raise exception 'not_moderator' using errcode = '42501';
  end if;
end;
$$;

-- Moderators see every viewer and suggestion.
create policy "Moderators read all viewers" on public.viewers
  for select to authenticated using ((select public.is_moderator()));
create policy "Moderators read all suggestions" on public.suggestions
  for select to authenticated using ((select public.is_moderator()));

-- Before the start: when it starts (countdown) and the scheduled end.
create or replace function public.mod_set_schedule(p_starts_at timestamptz, p_scheduled_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.timer set starts_at = p_starts_at, scheduled_end = p_scheduled_end, updated_at = now() where id = 1;
end; $$;

create or replace function public.mod_start_timer(p_hours numeric, p_scheduled_end timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform public.start_timer(round(p_hours * 3600)::integer, p_scheduled_end);
end; $$;

-- Add (or, with a negative number, remove) minutes by hand.
create or replace function public.mod_add_time(p_minutes numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if (select status from public.timer where id = 1) <> 'live' then
    raise exception 'timer_not_live' using errcode = 'P0001';
  end if;
  perform public.record_event('manual', 'manual', null, null, null, 'FULGATHON', null, 1, null, round(p_minutes * 60)::integer);
end; $$;

create or replace function public.mod_freeze(p_minutes integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform public.freeze_timer(p_minutes * 60);
end; $$;

create or replace function public.mod_double_hour(p_from timestamptz, p_minutes integer default 60)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform public.set_double_hour(p_from, p_minutes);
end; $$;

create or replace function public.mod_end_timer()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.timer set status = 'ended', updated_at = now() where id = 1;
end; $$;

-- Open a vote round with the given challenges (in display order).
create or replace function public.mod_open_round(p_challenges integer[], p_minutes integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  rid integer;
begin
  perform private.require_moderator();
  if exists (select 1 from public.vote_rounds where now() < closes_at) then
    raise exception 'round_already_open' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_challenges, 1), 0) < 2 then
    raise exception 'need_two_challenges' using errcode = 'P0001';
  end if;
  insert into public.vote_rounds (number, opens_at, closes_at)
    values ((select coalesce(max(number), 0) + 1 from public.vote_rounds), now(), now() + make_interval(mins => p_minutes))
    returning id into rid;
  insert into public.round_challenges (round_id, challenge_id, position)
    select rid, c, o::smallint from unnest(p_challenges) with ordinality as t (c, o);
  update public.challenges set status = 'in_round' where id = any (p_challenges);
  return rid;
end; $$;

-- Close a round (now, if still open), pick the winner, schedule it.
create or replace function private.finish_round(p_round integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  winner integer;
begin
  update public.vote_rounds set closes_at = least(closes_at, now()) where id = p_round;
  select challenge_id into winner from public.round_challenges
    where round_id = p_round order by votes desc, position asc limit 1;
  update public.vote_rounds set winner_id = winner where id = p_round;
  update public.challenges set status = 'scheduled' where id = winner;
  update public.challenges set status = 'pool'
    where status = 'in_round' and id in (select challenge_id from public.round_challenges where round_id = p_round) and id <> winner;
  return winner;
end; $$;

create or replace function public.mod_close_round(p_round integer)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return private.finish_round(p_round);
end; $$;

-- Change a challenge: schedule it ("Diseară, 22:00"), mark it done (with clip), veto it, or put it back.
create or replace function public.mod_set_challenge(p_id integer, p_status text, p_scheduled_for text default null, p_clip text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.challenges set
    status = p_status,
    scheduled_for = coalesce(p_scheduled_for, scheduled_for),
    clip_url = coalesce(nullif(p_clip, ''), clip_url),
    done_at = case when p_status = 'done' then coalesce(done_at, now()) else null end
  where id = p_id;
end; $$;

-- Approve (turns it into a votable challenge) or reject a suggestion.
create or replace function public.mod_review_suggestion(p_id bigint, p_approve boolean)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  sg     public.suggestions%rowtype;
  author text;
  new_id integer;
begin
  perform private.require_moderator();
  select * into sg from public.suggestions where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
  update public.suggestions set status = case when p_approve then 'approved' else 'rejected' end where id = p_id;
  if not p_approve then return null; end if;
  select coalesce(display_name, login) into author from public.viewers where id = sg.viewer_id;
  insert into public.challenges (id, category, category_name, title, how, level, votable)
    values ((select coalesce(max(id), 0) + 1 from public.challenges), 'propuneri', 'Propuneri din chat',
            sg.body, 'Propusă de ' || coalesce(author, 'un abonat') || '.', 'mediu', true)
    returning id into new_id;
  return new_id;
end; $$;

create or replace function public.mod_fulfil_spin(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.spins set fulfilled_at = now() where id = p_id and fulfilled_at is null;
end; $$;

-- Add or remove a moderator by Twitch login (works before they've logged in).
create or replace function public.mod_set_moderator(p_login text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  l text := lower(btrim(p_login));
begin
  perform private.require_moderator();
  update public.viewers set is_moderator = p_on where login = l;
  update private.settings set
    moderator_logins = case when p_on then array(select distinct unnest(moderator_logins || l))
                            else array_remove(moderator_logins, l) end,
    updated_at = now()
  where id = 1;
end; $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs
-- ---------------------------------------------------------------------------
-- Every minute: finish rounds whose time is up; end the subathon at zero.
create or replace function private.minute_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare
  r integer;
begin
  for r in select id from public.vote_rounds where winner_id is null and closes_at <= now() loop
    perform private.finish_round(r);
  end loop;
  update public.timer set status = 'ended', updated_at = now()
    where status = 'live' and ends_at < now() and (paused_until is null or paused_until < now());
end; $$;

select cron.schedule('fulgathon-minute', '* * * * *', 'select private.minute_tick()');

-- Every 5 minutes: ask the watch-time Edge Function to credit everyone in chat.
-- (The function itself does nothing unless the subathon is live and the stream online.)
select cron.schedule('fulgathon-watch-time', '*/5 * * * *', $$
  select net.http_post(
    url := (select functions_url from private.settings where id = 1) || '/watch-time',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$$);

-- ---------------------------------------------------------------------------
-- Who may call what (re-applied: new functions default to PUBLIC execute).
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.cast_vote(integer, integer), public.suggest(text), public.spin(), public.wheel_status(),
  public.is_moderator(),
  public.mod_set_schedule(timestamptz, timestamptz), public.mod_start_timer(numeric, timestamptz),
  public.mod_add_time(numeric), public.mod_freeze(integer), public.mod_double_hour(timestamptz, integer),
  public.mod_end_timer(), public.mod_open_round(integer[], integer), public.mod_close_round(integer),
  public.mod_set_challenge(integer, text, text, text), public.mod_review_suggestion(bigint, boolean),
  public.mod_fulfil_spin(bigint), public.mod_set_moderator(text, boolean)
  to authenticated;
grant execute on all functions in schema public to service_role;
