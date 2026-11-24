-- Rehearsal («Repetiție», owner 24 Nov 2026): Iceman sets up the overlay pieces in OBS before
-- the marathon and needs to see them react without going live. A moderator starts a rehearsal
-- from /mod; for up to 2 hours the overlay runs a practice clock (tag «TEST») that reacts to:
--   * test buttons on /mod: a donation, a gift wave, freeze, Ora dublă (and their stops);
--   * real TipeeeStream donations polled by tipeee-donations while the marathon isn't live
--     (e.g. a 1 € test donation): they play in the overlay and add practice time only.
-- Nothing touches the real timer, events, stats or feed. The state travels to the overlay in
-- public_state as the part 'rehearsal' (the overlay polls every 3 s).

insert into private.state_parts (part, version, data) values ('rehearsal', 0, 'null'::jsonb)
  on conflict (part) do nothing;

create or replace function private.rehearsal_get()
returns jsonb language sql stable security definer set search_path = '' as $$
  select data from private.state_parts where part = 'rehearsal';
$$;

-- Active = started and not past its end.
create or replace function private.rehearsal_active(d jsonb)
returns boolean language sql stable as $$
  select d is not null and jsonb_typeof(d) = 'object' and (d ->> 'until') is not null and (d ->> 'until')::timestamptz > now();
$$;

create or replace function private.rehearsal_put(d jsonb)
returns void language sql security definer set search_path = '' as $$
  update private.state_parts set version = version + 1, data = d, updated_at = now() where part = 'rehearsal';
$$;

-- Time added to the practice clock, doubled during a practice Ora dublă (like record_event).
create or replace function private.rehearsal_gain(d jsonb, p_kind text, p_user text, p_amount numeric, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  dbl boolean := (d ->> 'doubleUntil') is not null and (d ->> 'doubleUntil')::timestamptz > now();
  secs integer := p_seconds * (case when dbl then 2 else 1 end);
  n integer := coalesce((d -> 'last' ->> 'n')::integer, 0) + 1;
begin
  return d
    || jsonb_build_object('endsAt', (d ->> 'endsAt')::timestamptz + make_interval(secs => secs))
    || jsonb_build_object('last', jsonb_build_object('n', n, 'kind', p_kind, 'user', p_user, 'amount', p_amount,
         'seconds', secs, 'doubled', dbl, 'at', now()));
end; $$;

create or replace function public.mod_rehearsal(p_action text, p_minutes integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := private.rehearsal_get();
  t public.timer%rowtype;
  hrs numeric := coalesce((select a.start_hours from private.autopilot a where a.id = 1), 24);
  m integer := greatest(1, least(coalesce(p_minutes, 10), 240));
  rate integer := coalesce((select (r.seconds / r.per)::integer from public.rates r where r.key = 'donation'), 360);
  paused timestamptz;
begin
  perform private.require_moderator();
  select * into t from public.timer where id = 1;
  if p_action = 'start' then
    -- Only while the real marathon isn't running: on stream the real clock is what counts.
    if t.status = 'live' then raise exception 'rehearsal_while_live' using errcode = 'P0001'; end if;
    d := jsonb_build_object('until', now() + interval '2 hours', 'endsAt', now() + make_interval(secs => (hrs * 3600)::integer),
      'pausedUntil', null, 'doubleFrom', null, 'doubleUntil', null, 'last', null, 'seen', '[]'::jsonb, 'by', private.me_login());
  elsif p_action = 'stop' then
    d := 'null'::jsonb;
  else
    if not private.rehearsal_active(d) then raise exception 'rehearsal_off' using errcode = 'P0001'; end if;
    paused := (d ->> 'pausedUntil')::timestamptz;
    case p_action
      when 'donation' then d := private.rehearsal_gain(d, 'donation', 'TEST', 10, 10 * rate);
      when 'gift' then d := private.rehearsal_gain(d, 'gift', 'TEST', 20, 20 * coalesce((select (r.seconds / r.per)::integer from public.rates r where r.key = 'gift'), 360));
      when 'freeze' then
        d := d || jsonb_build_object('endsAt', (d ->> 'endsAt')::timestamptz + make_interval(mins => m),
                                     'pausedUntil', greatest(coalesce(paused, now()), now()) + make_interval(mins => m));
      when 'unfreeze' then
        if paused is not null and paused > now() then
          d := d || jsonb_build_object('endsAt', (d ->> 'endsAt')::timestamptz - (paused - now()), 'pausedUntil', null);
        end if;
      when 'double' then d := d || jsonb_build_object('doubleFrom', now(), 'doubleUntil', now() + make_interval(mins => m));
      when 'nodouble' then d := d || jsonb_build_object('doubleFrom', null, 'doubleUntil', null);
      else raise exception 'bad_rehearsal' using errcode = 'P0001';
    end case;
  end if;
  perform private.rehearsal_put(d);
  return d;
end; $$;

-- tipeee-donations: a donation seen while the marathon isn't live plays in an active rehearsal
-- (once per donation). Returns true when it was used.
create or replace function public.tipeee_rehearsal(p_id text, p_user text, p_amount numeric, p_currency text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := private.rehearsal_get();
  rate integer := coalesce((select (r.seconds / r.per)::integer from public.rates r where r.key = 'donation'), 360);
begin
  if not private.rehearsal_active(d) or (select status from public.timer where id = 1) = 'live' then return false; end if;
  if coalesce(d -> 'seen', '[]'::jsonb) ? p_id then return false; end if;
  -- Any currency is fine here: it's practice, nothing is counted.
  d := private.rehearsal_gain(d, 'donation', left(coalesce(nullif(btrim(p_user), ''), 'Anonim'), 40), p_amount,
         greatest(0, round(p_amount * rate))::integer);
  d := d || jsonb_build_object('seen', coalesce(d -> 'seen', '[]'::jsonb) || to_jsonb(p_id));
  perform private.rehearsal_put(d);
  return true;
end; $$;

revoke all on function private.rehearsal_get(), private.rehearsal_active(jsonb), private.rehearsal_put(jsonb),
  private.rehearsal_gain(jsonb, text, text, numeric, integer) from public, anon, authenticated;
revoke all on function public.mod_rehearsal(text, integer) from public, anon;
grant execute on function public.mod_rehearsal(text, integer) to authenticated;
revoke all on function public.tipeee_rehearsal(text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.tipeee_rehearsal(text, text, numeric, text) to service_role;
