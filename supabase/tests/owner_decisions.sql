-- Regression checks for 20261127100000_owner_decisions.sql («zero is final, protect Iceman,
-- euros only»). Run AFTER the migration is applied (SQL editor or MCP execute_sql).
-- Everything happens in one DO block that always ends with an exception, so nothing it
-- changes is kept: timer, events, stats, moderators, skipped donations are all rolled back.
-- Success looks like: ERROR: OWNER DECISIONS: ALL CHECKS PASSED (everything rolled back)
do $$
declare
  ev public.events%rowtype;
  t public.timer%rowtype;
  mod_id uuid;
  per_eur integer;
  h jsonb;
  msg text;
begin
  select floor(5 / r.per * r.seconds)::integer into per_eur from public.rates r where r.key = 'donation';

  -- B-08: before zero a donation still adds time...
  update public.timer set status = 'live', ends_at = now() + interval '1 hour', paused_until = null, double_from = null, double_until = null where id = 1;
  ev := public.record_event('donation', 'donation', 'test:before-zero', null, null, 'test', null, 5, 'EUR', null);
  if ev.seconds_added <> per_eur then raise exception 'B-08 FAIL: before zero added % s, expected %', ev.seconds_added, per_eur; end if;

  -- ...after zero it adds nothing and ends the marathon at once.
  update public.timer set status = 'live', ends_at = now() - interval '5 seconds', paused_until = null where id = 1;
  ev := public.record_event('donation', 'donation', 'test:after-zero', null, null, 'test', null, 20, 'EUR', null);
  select * into t from public.timer where id = 1;
  if ev.seconds_added <> 0 then raise exception 'B-08 FAIL: % s added after zero', ev.seconds_added; end if;
  if t.status <> 'ended' then raise exception 'B-08 FAIL: status is % after an event at zero', t.status; end if;
  if t.ends_at > now() then raise exception 'B-08 FAIL: the end moved after zero'; end if;

  -- A frozen clock isn't at zero.
  update public.timer set status = 'live', ends_at = now() + interval '10 minutes', paused_until = now() + interval '5 minutes' where id = 1;
  ev := public.record_event('donation', 'donation', 'test:frozen', null, null, 'test', null, 5, 'EUR', null);
  if ev.seconds_added <> per_eur then raise exception 'B-08 FAIL: frozen clock refused time'; end if;

  -- B-09: only euros.
  begin
    perform public.record_event('donation', 'donation', 'test:ron', null, null, 'test', null, 50, 'RON', null);
    raise exception 'B-09 FAIL: a RON donation was counted';
  exception when others then
    if sqlerrm <> 'not_eur' then raise; end if;
  end;
  perform public.tipeee_skip('test:skip', 'test_user', 50, 'ron', now());
  perform public.tipeee_skip('test:skip', 'test_user', 50, 'ron', now());  -- the same donation twice: kept once
  if (select count(*) from private.skipped_donations where external_id = 'test:skip' and currency = 'RON' and handled_at is null) <> 1 then
    raise exception 'B-09 FAIL: tipeee_skip did not store the donation once';
  end if;

  -- The rest runs as a moderator.
  select v.id into mod_id from public.viewers v where v.is_moderator order by v.login = (select broadcaster_login from private.settings where id = 1) limit 1;
  if mod_id is null then raise exception 'SETUP: no moderator account to test with'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', mod_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mod_id::text, true);

  h := public.mod_health();
  if not (h -> 'skipped') @> jsonb_build_array(jsonb_build_object('id', 'test:skip')) then
    raise exception 'B-09 FAIL: mod_health does not list the skipped donation';
  end if;
  perform public.mod_skipped_done('test:skip');
  if (select handled_at is null from private.skipped_donations where external_id = 'test:skip') then
    raise exception 'B-09 FAIL: mod_skipped_done did not mark it handled';
  end if;

  -- B-08: «+ min» and «Îngheață» refuse at zero.
  update public.timer set status = 'live', ends_at = now() - interval '5 seconds', paused_until = null where id = 1;
  begin
    perform public.mod_add_time(10);
    raise exception 'B-08 FAIL: +10 min accepted at zero';
  exception when others then
    if sqlerrm <> 'timer_ended' then raise; end if;
  end;
  begin
    perform public.mod_freeze(10);
    raise exception 'B-08 FAIL: freeze accepted at zero';
  exception when others then
    if sqlerrm <> 'timer_ended' then raise; end if;
  end;

  -- B-30: the broadcaster can't be removed (any spelling); someone else can.
  begin
    perform public.mod_set_moderator(upper((select broadcaster_login from private.settings where id = 1)) || ' ', false);
    raise exception 'B-30 FAIL: the broadcaster was removed';
  exception when others then
    if sqlerrm <> 'protected_broadcaster' then raise; end if;
  end;
  perform public.mod_set_moderator('owner_decisions_test_login', true);
  perform public.mod_set_moderator('owner_decisions_test_login', false);

  raise exception 'OWNER DECISIONS: ALL CHECKS PASSED (everything rolled back)';
end $$;
