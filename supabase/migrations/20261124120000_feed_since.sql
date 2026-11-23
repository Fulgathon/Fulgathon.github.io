-- The OBS overlay queues EVERY event, even in a burst bigger than the public
-- feed part (20): it asks for all events after the last one it showed.
create or replace function public.feed_since(p_after bigint, p_limit integer default 100)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'kind', kind, 'tier', tier, 'quantity', quantity, 'currency', currency,
      'seconds', seconds_added, 'doubled', doubled, 'name', public.public_name(user_login, user_name), 'at', created_at)
    order by id), '[]'::jsonb)
  from (select * from public.events where id > coalesce(p_after, 0) order by id limit least(greatest(coalesce(p_limit, 100), 1), 200)) e;
$$;
revoke all on function public.feed_since(bigint, integer) from public, anon, authenticated;
grant execute on function public.feed_since(bigint, integer) to anon, authenticated;
