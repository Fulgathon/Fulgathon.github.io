-- Bingo is a real 5×5 card (owner, 23 Nov 2026): everyone sees the same 25
-- events in fixed places and picks ONE line: a row, a column or a diagonal
-- (12 possible lines). The server only accepts a pick that is such a line.
-- Once anyone has picked, moderators can rename events but not move or
-- remove them (that would break saved lines).

insert into public.bingo_items (position, label)
select coalesce(max(position), 0) + 1, 'Apare cineva neanunțat pe cameră' from public.bingo_items
having count(*) = 24;

-- The 12 lines of the card, as sorted arrays of event ids (empty unless exactly 25 events).
create or replace function private.bingo_lines()
returns setof integer[] language plpgsql stable security definer set search_path = '' as $$
declare
  g integer[];
  k integer;
begin
  g := array(select id from public.bingo_items order by position, id);
  if cardinality(g) <> 25 then return; end if;
  for k in 0..4 loop
    return next array(select unnest(g[k * 5 + 1 : k * 5 + 5]) order by 1);                        -- row
    return next array(select g[k + 1 + 5 * j] from generate_series(0, 4) j order by 1);           -- column
  end loop;
  return next array(select g[1 + 6 * j] from generate_series(0, 4) j order by 1);                 -- diagonal ↘
  return next array(select g[5 + 4 * j] from generate_series(0, 4) j order by 1);                 -- diagonal ↙
end; $$;
revoke execute on function private.bingo_lines() from public, anon, authenticated;

create or replace function public.bingo_save(p_items integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  pick integer[];
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if (select s.closes_at from public.bingo_settings s where s.id = 1) <= now() then
    raise exception 'bingo_closed' using errcode = 'P0001';
  end if;
  pick := array(select distinct x from unnest(coalesce(p_items, '{}')) x order by 1);
  if cardinality(pick) <> 5 or not exists (select 1 from private.bingo_lines() l where l = pick) then
    raise exception 'not_a_line' using errcode = 'P0001';
  end if;
  insert into public.bingo_picks (viewer_id, items, updated_at)
    values (me, pick, now())
  on conflict (viewer_id) do update set items = excluded.items, updated_at = now();
end; $$;

-- Exactly 25 events. After the first pick: same events in the same places, renames only.
create or replace function public.mod_bingo_set_items(p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  pos integer := 0;
  keep integer[] := '{}';
  current_ids integer[];
  new_ids integer[];
begin
  perform private.require_moderator();
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) <> 25 then
    raise exception 'need_25' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where length(btrim(coalesce(e ->> 'label', ''))) not between 1 and 80) then
    raise exception 'bad_items' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.bingo_picks) then
    current_ids := array(select id from public.bingo_items order by position, id);
    new_ids := array(select case when e ->> 'id' ~ '^[0-9]+$' then (e ->> 'id')::integer end
                     from jsonb_array_elements(p_items) with ordinality t(e, n) order by n);
    if new_ids is distinct from current_ids then
      raise exception 'card_locked' using errcode = 'P0001';
    end if;
  end if;
  select coalesce(array_agg((e ->> 'id')::integer), '{}') into keep
    from jsonb_array_elements(p_items) e where e ? 'id' and e ->> 'id' ~ '^[0-9]+$';
  delete from public.bingo_items where not (id = any (keep));
  for x in select * from jsonb_array_elements(p_items) loop
    pos := pos + 1;
    if x ? 'id' and x ->> 'id' ~ '^[0-9]+$' and exists (select 1 from public.bingo_items where id = (x ->> 'id')::integer) then
      update public.bingo_items set label = btrim(x ->> 'label'), position = pos where id = (x ->> 'id')::integer;
    else
      insert into public.bingo_items (position, label) values (pos, btrim(x ->> 'label'));
    end if;
  end loop;
end; $$;
