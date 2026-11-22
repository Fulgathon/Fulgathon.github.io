-- Donations through TipeeeStream (Twitch never sees them).
-- TipeeeStream has no webhooks, so the tipeee-donations Edge Function polls its
-- events API every 15 seconds and passes new donations to record_event().
-- Donations are in euros: 5 € = +1 minute (same as the earlier 25 lei).

update public.rates set per = 5, label = 'Donație 5 €' where key = 'donation';
comment on column public.stats.raised is 'Donations, in euros';

-- Where polling has got to. "started" is set on the first run, so donations
-- made before the connection never count; "since" is the newest donation seen
-- (each run looks back two minutes from it; the donation id dedupes repeats).
create table private.tipeee_state (
  id          integer primary key default 1 check (id = 1),
  username    text not null default 'icemanlucky',
  started     timestamptz,
  since       timestamptz,
  last_run    timestamptz,
  last_count  integer not null default 0,
  last_error  text
);
insert into private.tipeee_state (id) values (1);

-- What the Edge Function needs. The API key lives in Vault as tipeee_api_key
-- (the function also accepts a TIPEEE_API_KEY Edge Function secret).
create or replace function public.tipeee_config()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'username', t.username,
    'started', t.started,
    'since', t.since,
    'api_key', (select decrypted_secret from vault.decrypted_secrets where name = 'tipeee_api_key'),
    'cron_secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret'),
    'timer_status', (select status from public.timer where id = 1),
    'timer_started', (select starts_at from public.timer where id = 1)
  )
  from private.tipeee_state t where t.id = 1;
$$;

create or replace function public.tipeee_mark(p_since timestamptz, p_count integer, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.tipeee_state
    set started = coalesce(started, p_since), since = greatest(coalesce(since, p_since), coalesce(p_since, since)), last_run = now(), last_count = coalesce(p_count, 0), last_error = p_error
    where id = 1;
$$;

revoke execute on function public.tipeee_config() from public, anon, authenticated;
revoke execute on function public.tipeee_mark(timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.tipeee_config() to service_role;
grant execute on function public.tipeee_mark(timestamptz, integer, text) to service_role;

-- Every 15 seconds.
select cron.schedule('icemaraton-tipeee', '15 seconds', $$
  select net.http_post(
    url := (select functions_url from private.settings where id = 1) || '/tipeee-donations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
$$);
