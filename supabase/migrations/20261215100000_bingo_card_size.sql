-- Bingo card size is no longer fixed at 5×5 (owner, 25 Nov 2026): moderators pick 3×3, 4×4 or 5×5
-- on /mod by how many events they put on the card (9, 16 or 25). A line is a row, a column or one of
-- the two diagonals of that card (2n + 2 lines), so a pick has n events. Winners (every event of the
-- line ticked) never depended on the size. Once anyone has picked, the card stays as it is (renames
-- only), as before.

alter table public.bingo_picks drop constraint if exists bingo_picks_items_check;
alter table public.bingo_picks add constraint bingo_picks_items_check check (cardinality(items) between 3 and 5);

-- The card's side: 3, 4 or 5 (null while the card has another count of events).
create or replace function private.bingo_side()
returns integer language sql stable security definer set search_path = '' as $$
  select case count(*) when 9 then 3 when 16 then 4 when 25 then 5 end from public.bingo_items;
$$;

-- The 2n + 2 lines of the card, as sorted arrays of event ids (none unless the card is 3×3, 4×4 or 5×5).
create or replace function private.bingo_lines()
returns setof integer[] language plpgsql stable security definer set search_path = '' as $$
declare
  g integer[];
  n integer := private.bingo_side();
  k integer;
begin
  if n is null then return; end if;
  g := array(select id from public.bingo_items order by position, id);
  for k in 0..n - 1 loop
    return next array(select unnest(g[k * n + 1 : k * n + n]) order by 1);                          -- row
    return next array(select g[k + 1 + n * j] from generate_series(0, n - 1) j order by 1);         -- column
  end loop;
  return next array(select g[1 + (n + 1) * j] from generate_series(0, n - 1) j order by 1);         -- diagonal ↘
  return next array(select g[n + (n - 1) * j] from generate_series(0, n - 1) j order by 1);         -- diagonal ↙
end; $$;
revoke execute on function private.bingo_lines(), private.bingo_side() from public, anon, authenticated;

-- Viewers: a line only while bingo is open (same as 20261207100000, the line length follows the card).
create or replace function public.bingo_save(p_items integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  pick integer[];
  ph text := private.bingo_phase();
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if ph = 'soon' then raise exception 'bingo_not_open' using errcode = 'P0001'; end if;
  if ph = 'closed' then raise exception 'bingo_closed' using errcode = 'P0001'; end if;
  pick := array(select distinct x from unnest(coalesce(p_items, '{}')) x order by 1);
  if cardinality(pick) is distinct from private.bingo_side() or not exists (select 1 from private.bingo_lines() l where l = pick) then
    raise exception 'not_a_line' using errcode = 'P0001';
  end if;
  insert into public.bingo_picks (viewer_id, items, updated_at)
    values (me, pick, now())
  on conflict (viewer_id) do update set items = excluded.items, updated_at = now();
end; $$;

-- Moderators: 9, 16 or 25 events (3×3, 4×4, 5×5). After the first pick: same events in the same places.
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
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not in (9, 16, 25) then
    raise exception 'bad_card_size' using errcode = 'P0001';
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

-- The Discord alert said «toate cele 5 evenimente»; a line can be 3 or 4 now.
do $$
declare d text;
begin
  d := pg_get_functiondef('private.autopilot_tick()'::regprocedure);
  if position('toate cele 5 evenimente' in d) > 0 then
    execute replace(d, 'toate cele 5 evenimente', 'toate evenimentele din linie');
  end if;
end $$;
