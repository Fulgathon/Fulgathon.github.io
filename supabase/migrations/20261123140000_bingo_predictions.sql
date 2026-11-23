-- Bingo as a prediction game (owner, 23 Nov 2026):
--   * Before the close (default 25 Dec 2026 12:00), every viewer logged in with
--     Twitch picks the 5 events they think will ALL happen during the marathon.
--     The pick is saved per viewer and can be changed until the close.
--   * Moderators tick events on /mod when they happen.
--   * Viewers whose 5 events all happened go on the raffle list; a moderator
--     draws the winner on the server (recorded in bingo_draws).
-- Also: freeze until a date / unfreeze now (Iceman's working week, 20–25 Dec).

-- Tables ----------------------------------------------------------------------
create table public.bingo_items (
  id           integer generated always as identity primary key,
  position     smallint not null,
  label        text not null check (length(btrim(label)) between 1 and 80),
  happened_at  timestamptz
);

create table public.bingo_settings (
  id         integer primary key default 1 check (id = 1),
  closes_at  timestamptz,
  prize      text not null default '[PREMIU]'
);
insert into public.bingo_settings (id, closes_at) values (1, '2026-12-25 12:00:00 Europe/Bucharest');

create table public.bingo_picks (
  viewer_id   uuid primary key references public.viewers (id) on delete cascade,
  items       integer[] not null check (cardinality(items) = 5),
  updated_at  timestamptz not null default now()
);

create table public.bingo_draws (
  id         bigint generated always as identity primary key,
  viewer_id  uuid references public.viewers (id) on delete set null,
  login      text not null,
  drawn_at   timestamptz not null default now()
);

insert into public.bingo_items (position, label)
select row_number() over (), label from unnest(array[
  'Rage bait', 'Țipă la iKLD', 'Cântă fără să-i ceară nimeni', 'Raid cu peste 50 de oameni',
  'Cineva dăruiește 10+ subs', 'Cineva donează 100+ €', 'Moare în primul minut', 'Vorbește cu microfonul pe mute',
  'Un moderator își ia unmod', 'Mai prinde un accident pe live', 'Se ia curentul', 'Face pană la mașină',
  'Sforăie în somn', 'Rage quit', 'Zice „ultimul joc” și mai joacă 3', 'Pică netul sau OBS-ul',
  'Mănâncă pe stream', 'Adoarme pe cameră', 'Chatul spamează același emote', 'A treia cafea a zilei',
  'Râde un minut fără oprire', 'Cântă o colindă', 'Începe Ora dublă', 'Plânge de râs'
]) as label;

-- Row level security -------------------------------------------------------
alter table public.bingo_items    enable row level security;
alter table public.bingo_settings enable row level security;
alter table public.bingo_picks    enable row level security;
alter table public.bingo_draws    enable row level security;
create policy "Public read" on public.bingo_items    for select to anon, authenticated using (true);
create policy "Public read" on public.bingo_settings for select to anon, authenticated using (true);
create policy "Viewers read their own pick" on public.bingo_picks
  for select to authenticated using ((select auth.uid()) = viewer_id);
revoke all on public.bingo_items, public.bingo_settings, public.bingo_picks, public.bingo_draws from anon, authenticated;
grant select on public.bingo_items, public.bingo_settings to anon, authenticated;
grant select on public.bingo_picks to authenticated;
grant all on public.bingo_items, public.bingo_settings, public.bingo_picks, public.bingo_draws to service_role;
alter publication supabase_realtime add table public.bingo_items, public.bingo_settings;

-- Viewers -------------------------------------------------------------------
-- Save (or change) my 5 events, until the close.
create or replace function public.bingo_save(p_items integer[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if (select s.closes_at from public.bingo_settings s where s.id = 1) <= now() then
    raise exception 'bingo_closed' using errcode = 'P0001';
  end if;
  if p_items is null or cardinality(p_items) <> 5
     or (select count(distinct x) from unnest(p_items) x) <> 5
     or (select count(*) from public.bingo_items b where b.id = any (p_items)) <> 5 then
    raise exception 'bad_pick' using errcode = 'P0001';
  end if;
  insert into public.bingo_picks (viewer_id, items, updated_at)
    values (me, (select array_agg(x order by x) from unnest(p_items) x), now())
  on conflict (viewer_id) do update set items = excluded.items, updated_at = now();
end; $$;

-- How many people have played (the picks themselves stay private).
create or replace function public.bingo_stats()
returns table (players integer) language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.bingo_picks;
$$;

-- Moderators ----------------------------------------------------------------
-- Replace the event list: [{"id": 3, "label": "…"}, {"label": "new"}], in order.
-- Events already picked by someone can't be removed (rename them instead).
create or replace function public.mod_bingo_set_items(p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
  pos integer := 0;
  keep integer[] := '{}';
begin
  perform private.require_moderator();
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 5 and 60 then
    raise exception 'bad_items' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where length(btrim(coalesce(e ->> 'label', ''))) not between 1 and 80) then
    raise exception 'bad_items' using errcode = 'P0001';
  end if;
  select coalesce(array_agg((e ->> 'id')::integer), '{}') into keep
    from jsonb_array_elements(p_items) e where e ? 'id' and e ->> 'id' ~ '^[0-9]+$';
  if exists (select 1 from public.bingo_picks p, unnest(p.items) i where not (i = any (keep))) then
    raise exception 'item_in_use' using errcode = 'P0001';
  end if;
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

create or replace function public.mod_bingo_tick(p_id integer, p_happened boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.bingo_items
    set happened_at = case when p_happened then coalesce(happened_at, now()) end
    where id = p_id;
end; $$;

create or replace function public.mod_bingo_settings(p_closes_at timestamptz, p_prize text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.bingo_settings
    set closes_at = p_closes_at, prize = coalesce(nullif(btrim(p_prize), ''), prize)
    where id = 1;
end; $$;

-- Everyone whose 5 events have all happened (the raffle list), plus totals.
create or replace function public.mod_bingo_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return jsonb_build_object(
    'players', (select count(*) from public.bingo_picks),
    'winners', coalesce((
      select jsonb_agg(jsonb_build_object('login', coalesce(v.display_name, v.login), 'saved_at', p.updated_at) order by p.updated_at)
      from public.bingo_picks p join public.viewers v on v.id = p.viewer_id
      where not exists (select 1 from unnest(p.items) i
                        where not exists (select 1 from public.bingo_items b where b.id = i and b.happened_at is not null))
    ), '[]'::jsonb),
    'draws', coalesce((select jsonb_agg(jsonb_build_object('login', d.login, 'drawn_at', d.drawn_at) order by d.drawn_at desc)
                       from public.bingo_draws d), '[]'::jsonb)
  );
end; $$;

-- Draw one winner at random from the raffle list (people not drawn before).
create or replace function public.mod_bingo_draw()
returns text language plpgsql security definer set search_path = '' as $$
declare
  w record;
begin
  perform private.require_moderator();
  select p.viewer_id, coalesce(v.display_name, v.login) as login into w
    from public.bingo_picks p join public.viewers v on v.id = p.viewer_id
    where not exists (select 1 from unnest(p.items) i
                      where not exists (select 1 from public.bingo_items b where b.id = i and b.happened_at is not null))
      and not exists (select 1 from public.bingo_draws d where d.viewer_id = p.viewer_id)
    order by random() limit 1;
  if not found then
    raise exception 'no_bingo_winners' using errcode = 'P0001';
  end if;
  insert into public.bingo_draws (viewer_id, login) values (w.viewer_id, w.login);
  return w.login;
end; $$;

-- Freeze until a date (subs and donations still add time meanwhile) / unfreeze now.
create or replace function public.mod_freeze_until(p_until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
  secs integer;
begin
  perform private.require_moderator();
  select * into t from public.timer where id = 1 for update;
  if t.status <> 'live' then
    raise exception 'timer_not_live' using errcode = 'P0001';
  end if;
  secs := floor(extract(epoch from (p_until - greatest(coalesce(t.paused_until, now()), now()))))::integer;
  if secs <= 0 then
    raise exception 'freeze_in_past' using errcode = 'P0001';
  end if;
  perform public.freeze_timer(secs);
end; $$;

create or replace function public.mod_unfreeze()
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
begin
  perform private.require_moderator();
  select * into t from public.timer where id = 1 for update;
  if t.paused_until is null or t.paused_until <= now() then
    return;
  end if;
  update public.timer
    set ends_at = ends_at - (paused_until - now()), paused_until = now(), updated_at = now()
    where id = 1;
end; $$;

-- Who may call what ---------------------------------------------------------
revoke execute on function
  public.bingo_save(integer[]), public.bingo_stats(), public.mod_bingo_set_items(jsonb),
  public.mod_bingo_tick(integer, boolean), public.mod_bingo_settings(timestamptz, text),
  public.mod_bingo_status(), public.mod_bingo_draw(), public.mod_freeze_until(timestamptz), public.mod_unfreeze()
  from public, anon, authenticated;
grant execute on function public.bingo_stats() to anon, authenticated;
grant execute on function
  public.bingo_save(integer[]), public.mod_bingo_set_items(jsonb), public.mod_bingo_tick(integer, boolean),
  public.mod_bingo_settings(timestamptz, text), public.mod_bingo_status(), public.mod_bingo_draw(),
  public.mod_freeze_until(timestamptz), public.mod_unfreeze()
  to authenticated;
grant execute on function
  public.bingo_save(integer[]), public.bingo_stats(), public.mod_bingo_set_items(jsonb), public.mod_bingo_tick(integer, boolean),
  public.mod_bingo_settings(timestamptz, text), public.mod_bingo_status(), public.mod_bingo_draw(),
  public.mod_freeze_until(timestamptz), public.mod_unfreeze()
  to service_role;
