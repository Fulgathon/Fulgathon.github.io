-- Only Iceman starts and ends the subathon (owner, 24 Nov 2026). Moderators keep every
-- other control. "Starting" covers the three ways the clock can open:
--   * «Pornește acum» (mod_start_timer)
--   * switching auto start on or off (mod_autopilot_set, key autoStart)
--   * moving the start time while auto start is on (mod_set_schedule), since that
--     would open the clock at a moderator's chosen moment.
-- The broadcaster is private.settings.broadcaster_login (same login protected by B-30).

create or replace function private.is_broadcaster()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select lower(v.login) = lower(btrim(s.broadcaster_login))
    from public.viewers v, private.settings s
    where v.id = (select auth.uid()) and s.id = 1), false);
$$;

create or replace function private.require_broadcaster()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if not private.is_broadcaster() then
    raise exception 'only_broadcaster' using errcode = '42501';
  end if;
end; $$;

revoke execute on function private.is_broadcaster(), private.require_broadcaster() from public, anon, authenticated;

create or replace function public.mod_start_timer(p_hours numeric, p_scheduled_end timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_broadcaster();
  perform public.start_timer(round(p_hours * 3600)::integer, p_scheduled_end);
end; $$;

create or replace function public.mod_end_timer()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_broadcaster();
  update public.timer set status = 'ended', updated_at = now() where id = 1;
end; $$;

create or replace function public.mod_set_schedule(p_starts_at timestamptz, p_scheduled_end timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if (select a.auto_start from private.autopilot a where a.id = 1)
     and p_starts_at is distinct from (select t.starts_at from public.timer t where t.id = 1)
     and not private.is_broadcaster() then
    raise exception 'only_broadcaster' using errcode = '42501';
  end if;
  update public.timer set starts_at = p_starts_at, scheduled_end = p_scheduled_end, updated_at = now() where id = 1;
end; $$;

-- Same as 20261129100000_mod_autopilot.sql plus the auto start check.
create or replace function public.mod_autopilot_set(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  hook text;
begin
  perform private.require_moderator();
  if p ? 'autoStart'
     and (p ->> 'autoStart')::boolean is distinct from (select a.auto_start from private.autopilot a where a.id = 1)
     and not private.is_broadcaster() then
    raise exception 'only_broadcaster' using errcode = '42501';
  end if;
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
