-- Regression checks for 20261128100000_chat_resubs.sql (resubs read from the chat badge).
-- Run AFTER the migration is applied (SQL editor or MCP execute_sql). One DO block that
-- always ends with an exception, so nothing it changes is kept.
-- Success looks like: ERROR: CHAT RESUBS: ALL CHECKS PASSED (everything rolled back)
do $$
declare
  v text;
  b boolean;
  ev public.events%rowtype;
begin
  update public.timer set status = 'upcoming' where id = 1;
  v := public.chat_sub_months('test:a', 'test_a', 13);
  if v <> 'baseline' then raise exception 'FAIL first badge: %', v; end if;
  v := public.chat_sub_months('test:a', 'test_a', 14);
  if v <> 'skipped' then raise exception 'FAIL renewal before the start: %', v; end if;

  update public.timer set status = 'live', ends_at = now() + interval '10 hours', paused_until = null where id = 1;
  v := public.chat_sub_months('test:a', 'test_a', 15);
  if v <> 'credit' then raise exception 'FAIL silent renewal while live: %', v; end if;
  b := public.resub_shared('test:a', 'test_a', 15);
  if b then raise exception 'FAIL shared resub counted after the badge'; end if;

  v := public.chat_sub_months('test:b', 'test_b', 5);
  b := public.resub_shared('test:b', 'test_b', 6);
  if not b then raise exception 'FAIL shared resub not counted'; end if;
  v := public.chat_sub_months('test:b', 'test_b', 6);
  if v <> 'same' then raise exception 'FAIL badge after a shared resub: %', v; end if;

  perform public.sub_status_changed('test:g', 'test_g', true, '1000');
  v := public.chat_sub_months('test:g', 'test_g', 1);
  if v <> 'skipped' then raise exception 'FAIL gifted sub counted again from the badge: %', v; end if;

  ev := public.record_event('twitch', 'resub', 'chatbadge:test:a:15', 'test:a', 'test_a', 'test', '1000', 1);
  ev := public.record_event('twitch', 'resub', 'chatbadge:test:a:15', 'test:a', 'test_a', 'test', '1000', 1);
  if (select count(*) from public.events where external_id = 'chatbadge:test:a:15') <> 1 then
    raise exception 'FAIL the same chat resub was recorded twice';
  end if;

  if has_function_privilege('anon', 'public.chat_sub_months(text,text,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.resub_shared(text,text,integer)', 'execute') then
    raise exception 'FAIL viewers can call the resub functions';
  end if;

  raise exception 'CHAT RESUBS: ALL CHECKS PASSED (everything rolled back)';
end $$;
