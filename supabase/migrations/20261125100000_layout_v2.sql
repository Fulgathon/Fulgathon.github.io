-- Layout v2 (approved 23 Nov 2026). Everything new is served through
-- public_state(); nothing new is readable by anon directly.
--
--   lines    «Replicile lui Iceman»: the hero bubble lines, 6 groups, written
--            by moderators on /mod (never shipped in code), plus the threshold
--            between a small and a large donation.
--   goals    milestones now also say whether they happened live, the clip
--            link («Ai ratat? Vezi clipurile») and when an unlocked one is planned.
--   advent   the Advent calendar: per day, what's scheduled, the clip, a sponsor.
--   badges   how many people hold each badge (tooltips: «O au N oameni din chat»).
--
-- The Twitch-chat echo of the bubble line is NOT here: it waits for the owner
-- (which account writes, and whether a bot already thanks in chat).

-- ---------------------------------------------------------------------------
-- 1. Iceman's lines
-- ---------------------------------------------------------------------------
create table public.iceman_lines (
  grp      text not null check (grp in ('sub', 'sub23', 'gift', 'donSmall', 'donBig', 'bits')),
  position smallint not null check (position between 1 and 40),
  line     text not null check (length(line) between 1 and 70),
  primary key (grp, position)
);
alter table public.iceman_lines enable row level security;
revoke all on public.iceman_lines from anon, authenticated;

create table private.bubble_settings (
  id             smallint primary key default 1 check (id = 1),
  small_donation numeric not null default 10 check (small_donation > 0 and small_donation <= 10000),
  updated_at     timestamptz not null default now()
);
insert into private.bubble_settings (id) values (1);

-- p_lines = {"sub": ["…", "…"], "gift": […], …}; groups left out are emptied.
create or replace function public.mod_set_lines(p_lines jsonb, p_small_donation numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g text;
begin
  perform private.require_moderator();
  if jsonb_typeof(p_lines) is distinct from 'object' then
    raise exception 'bad_lines' using errcode = 'P0001';
  end if;
  for g in select jsonb_object_keys(p_lines) loop
    if g not in ('sub', 'sub23', 'gift', 'donSmall', 'donBig', 'bits')
       or jsonb_typeof(p_lines -> g) is distinct from 'array'
       or jsonb_array_length(p_lines -> g) > 40 then
      raise exception 'bad_lines' using errcode = 'P0001';
    end if;
  end loop;
  if exists (select 1 from jsonb_each(p_lines) e, jsonb_array_elements_text(e.value) l
             where length(btrim(l)) > 70) then
    raise exception 'line_too_long' using errcode = 'P0001';
  end if;

  delete from public.iceman_lines where true;
  insert into public.iceman_lines (grp, position, line)
  select e.key, row_number() over (partition by e.key order by l.ord)::smallint, btrim(l.value)
  from jsonb_each(p_lines) e, jsonb_array_elements_text(e.value) with ordinality l(value, ord)
  where btrim(l.value) <> '';

  if p_small_donation is not null then
    if p_small_donation <= 0 or p_small_donation > 10000 then
      raise exception 'bad_threshold' using errcode = 'P0001';
    end if;
    update private.bubble_settings set small_donation = p_small_donation, updated_at = now() where id = 1;
  end if;
end; $$;
revoke all on function public.mod_set_lines(jsonb, numeric) from public, anon;
grant execute on function public.mod_set_lines(jsonb, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Milestones: happened live, clip, when
-- ---------------------------------------------------------------------------
alter table public.goals add column done_at timestamptz;
alter table public.goals add column clip_url text check (clip_url is null or clip_url ~ '^https://');
alter table public.goals add column scheduled_for text check (scheduled_for is null or length(scheduled_for) <= 60);

-- Same as before, plus optional "done", "clip" and "when" per milestone. When a
-- key is missing (older /mod), the value saved for the same title + amount stays.
create or replace function public.mod_set_goals(p_goals jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  old     jsonb;
  total   numeric;
begin
  perform private.require_moderator();
  if jsonb_typeof(p_goals) is distinct from 'array' or jsonb_array_length(p_goals) > 40 then
    raise exception 'bad_goals' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_goals) g
    where coalesce(btrim(g ->> 'title'), '') = '' or length(g ->> 'title') > 140
       or coalesce(g ->> 'threshold', '') !~ '^[0-9]{1,7}$' or (g ->> 'threshold')::integer <= 0
       or (nullif(btrim(coalesce(g ->> 'clip', '')), '') is not null and btrim(g ->> 'clip') !~ '^https://')
       or length(coalesce(g ->> 'when', '')) > 60
  ) then
    raise exception 'bad_goals' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_object_agg(title || '|' || threshold,
           jsonb_build_object('unlocked', unlocked_at, 'done', done_at, 'clip', clip_url, 'when', scheduled_for)), '{}'::jsonb)
    into old from public.goals;
  select s.raised into total from public.stats s where s.id = 1;

  delete from public.goals where true;
  insert into public.goals (position, title, threshold, unlocked_at, sponsor, done_at, clip_url, scheduled_for)
  select (row_number() over (order by (g ->> 'threshold')::integer))::smallint,
         btrim(g ->> 'title'),
         (g ->> 'threshold')::integer,
         case when (g ->> 'threshold')::integer <= total
              then coalesce((o ->> 'unlocked')::timestamptz, now()) end,
         left(nullif(btrim(coalesce(g ->> 'sponsor', '')), ''), 60),
         case when g ? 'done' then (case when (g ->> 'done')::boolean then coalesce((o ->> 'done')::timestamptz, now()) end)
              else (o ->> 'done')::timestamptz end,
         case when g ? 'clip' then nullif(btrim(g ->> 'clip'), '') else o ->> 'clip' end,
         case when g ? 'when' then nullif(btrim(g ->> 'when'), '') else o ->> 'when' end
  from jsonb_array_elements(p_goals) g
  left join lateral (select old -> (btrim(g ->> 'title') || '|' || (g ->> 'threshold')) as o) x on true;
exception when unique_violation then
  raise exception 'duplicate_amount' using errcode = 'P0001';
end; $$;

-- ---------------------------------------------------------------------------
-- 3. Advent calendar
-- ---------------------------------------------------------------------------
create table public.advent_days (
  day      smallint primary key check (day between 1 and 40),
  note     text check (note is null or length(note) <= 60),
  clip_url text check (clip_url is null or clip_url ~ '^https://'),
  sponsor  text check (sponsor is null or length(sponsor) <= 60)
);
alter table public.advent_days enable row level security;
revoke all on public.advent_days from anon, authenticated;

-- p_days = [{"day": 2, "note": "Ora dublă", "clip": "https://…", "sponsor": "Zona IT"}, …]; replaces the list.
create or replace function public.mod_set_advent(p_days jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) > 40
     or exists (select 1 from jsonb_array_elements(p_days) d
                where coalesce(d ->> 'day', '') !~ '^[0-9]{1,2}$' or (d ->> 'day')::integer not between 1 and 40
                   or length(coalesce(d ->> 'note', '')) > 60 or length(coalesce(d ->> 'sponsor', '')) > 60
                   or (nullif(btrim(coalesce(d ->> 'clip', '')), '') is not null and btrim(d ->> 'clip') !~ '^https://')) then
    raise exception 'bad_days' using errcode = 'P0001';
  end if;
  delete from public.advent_days where true;
  insert into public.advent_days (day, note, clip_url, sponsor)
  select distinct on ((d ->> 'day')::smallint) (d ->> 'day')::smallint,
         nullif(btrim(coalesce(d ->> 'note', '')), ''), nullif(btrim(coalesce(d ->> 'clip', '')), ''),
         nullif(btrim(coalesce(d ->> 'sponsor', '')), '')
  from jsonb_array_elements(p_days) d
  where coalesce(btrim(d ->> 'note'), '') <> '' or coalesce(btrim(d ->> 'clip'), '') <> '' or coalesce(btrim(d ->> 'sponsor'), '') <> '';
end; $$;
revoke all on function public.mod_set_advent(jsonb) from public, anon;
grant execute on function public.mod_set_advent(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The parts: the existing compute_part handles everything it knew; the new
--    one adds lines / advent / badges and the richer goals, and delegates the rest.
-- ---------------------------------------------------------------------------
alter function private.compute_part(text) rename to compute_part_base;

create or replace function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  start_day date := (select (starts_at at time zone 'Europe/Bucharest')::date from public.timer where id = 1);
begin
  case p_part
  when 'goals' then
    return coalesce((select jsonb_agg(jsonb_build_object('title', title, 'threshold', threshold, 'sponsor', sponsor,
      'unlocked', unlocked_at is not null, 'doneAt', done_at, 'clip', clip_url, 'when', scheduled_for) order by position)
      from public.goals), '[]'::jsonb);
  when 'lines' then
    return jsonb_build_object(
      'groups', coalesce((select jsonb_object_agg(grp, lines) from (
        select grp, jsonb_agg(line order by position) as lines from public.iceman_lines group by grp) g), '{}'::jsonb),
      'smallDonation', (select small_donation from private.bubble_settings where id = 1));
  when 'advent' then
    return coalesce((select jsonb_agg(jsonb_build_object('day', day, 'note', note, 'clip', clip_url, 'sponsor', sponsor) order by day)
      from public.advent_days), '[]'::jsonb);
  when 'badges' then
    return jsonb_build_object(
      'og', case when start_day is null then 0 else
              (select count(distinct twitch_id) from public.watch_daily where day = start_day) end,
      'h10', (select count(*) from public.watch_time where minutes >= 600),
      'h50', (select count(*) from public.watch_time where minutes >= 3000),
      'h100', (select count(*) from public.watch_time where minutes >= 6000),
      'night', (select count(*) from private.watch_night where minutes >= 60),
      'streak7', (select count(*) from (
        select twitch_id from (
          select twitch_id, day - (row_number() over (partition by twitch_id order by day))::integer as grp
          from (select twitch_id, day from public.watch_daily where minutes >= 30
                union select twitch_id, day from private.checkins) d
        ) x group by twitch_id, grp having count(*) >= 7
      ) y));
  else
    return private.compute_part_base(p_part);
  end case;
end; $$;

create trigger state_lines   after insert or update or delete on public.iceman_lines     for each statement execute function private.on_state_change('lines');
create trigger state_bubble  after insert or update or delete on private.bubble_settings  for each statement execute function private.on_state_change('lines');
create trigger state_advent  after insert or update or delete on public.advent_days      for each statement execute function private.on_state_change('advent');

select private.refresh_parts(array['goals', 'lines', 'advent', 'badges']);

-- Badge counts change slowly and cost a scan: every 5 minutes is plenty.
select cron.schedule('icemaraton-badges', '*/5 * * * *', $$select private.refresh_parts(array['badges'])$$);
