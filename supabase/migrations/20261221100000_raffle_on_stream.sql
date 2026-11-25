-- The raffle on stream (owner, 25 Nov 2026). The OBS piece «Tragerea la sorți» now shows one raffle for
-- as long as it's on stream, solid (the streamer hides the source from his Stream Deck when he wants):
--   * entries open   → the names of everyone who entered fall through the box like snow, live;
--   * entries closed → the reel stands still, its middle row pulsing (waiting for the draw);
--   * «Trage la sorți» → 3-2-1, then the reel spins and stops on the winner, who stays on screen;
--   * «Încheie tombola» → the panel fades out and nothing more can be done on that raffle.
-- One raffle is on stream at a time (raffles.on_stream). A new raffle goes on stream by itself when none
-- is; «Pune pe stream» moves it. Part 'raffle' carries everything the piece needs; raffle draws no
-- longer ride on part 'bingo' (bingo draws still play there, as before).
-- «Închide înscrierile» now works for every raffle (for automatic lists it only moves the overlay to the
-- still reel); the first draw closes entries for every raffle.

alter table public.raffles add column if not exists on_stream boolean not null default false;
alter table public.raffles add column if not exists ended_at timestamptz;
create unique index if not exists raffles_one_on_stream on public.raffles ((true)) where on_stream;

-- Save: a new raffle goes on stream when none is; an ended raffle can't change.
create or replace function public.mod_raffle_save(p_id bigint, p_prize text, p_sponsor text, p_rule text, p_min_hours numeric default null,
  p_include_mods boolean default false, p_allow_past boolean default true, p_allow_repeat boolean default false, p_points_cost integer default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  hrs numeric := case when p_rule = 'hours' then p_min_hours end;
  cost integer := case when p_rule = 'points' then p_points_cost end;
  new_id bigint;
begin
  perform private.require_moderator();
  if length(btrim(coalesce(p_prize, ''))) not between 1 and 120 then raise exception 'bad_raffle_prize' using errcode = 'P0001'; end if;
  perform private.raffle_rule_ok(p_rule, hrs);
  if p_rule = 'points' and (cost is null or cost not between 1 and 1000000) then raise exception 'bad_raffle_points' using errcode = 'P0001'; end if;
  if p_id is null then
    insert into public.raffles (prize, sponsor, rule, min_hours, points_cost, include_mods, allow_past_winners, allow_repeat, created_by, on_stream)
      values (btrim(p_prize), nullif(btrim(coalesce(p_sponsor, '')), ''), p_rule, hrs, cost,
              coalesce(p_include_mods, false), coalesce(p_allow_past, true), coalesce(p_allow_repeat, false), private.me_login(),
              not exists (select 1 from public.raffles x where x.on_stream))
      returning id into new_id;
    return new_id;
  end if;
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if r.ended_at is not null then raise exception 'raffle_ended' using errcode = 'P0001'; end if;
  if (r.rule, r.min_hours, r.points_cost) is distinct from (p_rule, hrs, cost) and exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then
    raise exception 'raffle_drawn' using errcode = 'P0001';
  end if;
  if r.rule = 'points' and p_rule = 'points' and r.points_cost is distinct from cost
     and (r.twitch_reward_id is not null or exists (select 1 from public.raffle_entries e where e.raffle_id = p_id)) then
    raise exception 'raffle_cost_locked' using errcode = 'P0001';
  end if;
  if r.rule = 'points' and p_rule <> 'points' then
    if exists (select 1 from public.raffle_entries e where e.raffle_id = p_id) then raise exception 'raffle_has_entries' using errcode = 'P0001'; end if;
    if r.twitch_reward_id is not null then insert into private.raffle_reward_trash (reward_id) values (r.twitch_reward_id) on conflict do nothing; end if;
    update public.raffles set twitch_reward_id = null, reward_error = null, entries_closed_at = null where id = p_id;
  end if;
  update public.raffles set prize = btrim(p_prize), sponsor = nullif(btrim(coalesce(p_sponsor, '')), ''), rule = p_rule, min_hours = hrs, points_cost = cost,
      include_mods = coalesce(p_include_mods, false), allow_past_winners = coalesce(p_allow_past, true), allow_repeat = coalesce(p_allow_repeat, false)
    where id = p_id;
  return p_id;
end; $$;

-- «Închide înscrierile» / «Redeschide»: every raffle now (reopening only before any draw).
create or replace function public.mod_raffle_entries(p_id bigint, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
begin
  perform private.require_moderator();
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if r.ended_at is not null then raise exception 'raffle_ended' using errcode = 'P0001'; end if;
  if p_open then
    if exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then raise exception 'raffle_drawn' using errcode = 'P0001'; end if;
    update public.raffles set entries_closed_at = null, reward_error = null where id = p_id;
  else
    update public.raffles set entries_closed_at = coalesce(entries_closed_at, now()) where id = p_id;
  end if;
end; $$;

-- «Trage la sorți»: refused on an ended raffle; closes entries for every raffle.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.mod_raffle_draw(bigint)'::regprocedure);
  if position('if r.rule = ''points'' and r.entries_closed_at is null then' in d) = 0 then raise exception 'mod_raffle_draw: unexpected body'; end if;
  d := replace(d, 'if r.rule = ''points'' and r.entries_closed_at is null then',
    'if r.ended_at is not null then raise exception ''raffle_ended'' using errcode = ''P0001''; end if;
  if r.entries_closed_at is null then');
  execute d;
end $$;

-- «Pune pe stream» (one at a time) / «Scoate de pe stream».
create or replace function public.mod_raffle_stream(p_id bigint, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
begin
  perform private.require_moderator();
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if p_on and r.ended_at is not null then raise exception 'raffle_ended' using errcode = 'P0001'; end if;
  update public.raffles set on_stream = false where on_stream and id <> p_id;
  update public.raffles set on_stream = p_on where id = p_id;
end; $$;

-- «Încheie tombola»: off stream, entries closed (its reward leaves Twitch), nothing more can change.
-- Its winners stay in PREMII → De dat until handed out.
create or replace function public.mod_raffle_end(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.raffles set ended_at = coalesce(ended_at, now()), on_stream = false, entries_closed_at = coalesce(entries_closed_at, now())
    where id = p_id;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
end; $$;

create or replace function public.mod_raffles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'min_hours', r.min_hours,
      'include_mods', r.include_mods, 'allow_past_winners', r.allow_past_winners, 'allow_repeat', r.allow_repeat,
      'points_cost', r.points_cost, 'entries_closed_at', r.entries_closed_at,
      'on_twitch', r.twitch_reward_id is not null, 'reward_error', r.reward_error,
      'on_stream', r.on_stream, 'ended_at', r.ended_at,
      'entries', (select count(*) from public.raffle_entries e where e.raffle_id = r.id),
      'created_by', r.created_by, 'created_at', r.created_at,
      'pool', (select count(*) from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e where e.can_win),
      'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'login', d.login, 'drawn_at', d.drawn_at,
                 'drawn_by', d.drawn_by, 'given_at', d.given_at, 'total', d.entrants_total) order by d.id)
               from public.raffle_draws d where d.raffle_id = r.id), '[]'::jsonb)) order by r.ended_at is not null, r.id desc)
    from public.raffles r), '[]'::jsonb);
end; $$;

-- Part 'raffle': the raffle on stream, for the OBS piece (null when none).
--   phase: 'open' (entries open) | 'closed' (waiting for the draw) | 'drawn'
--   entries: points raffles, the newest 150 entrants [{name, at}] (newest first; the piece drops new ones in);
--   sample: automatic lists, up to 80 names from the list (the piece lets them snow, no drop-ins).
create or replace function private.raffle_part()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  d public.raffle_draws%rowtype;
  b text := (select lower(btrim(s.broadcaster_login)) from private.settings s where s.id = 1);
begin
  select * into r from public.raffles where on_stream and ended_at is null limit 1;
  if not found then return null; end if;
  select * into d from public.raffle_draws where raffle_id = r.id order by id desc limit 1;
  return jsonb_build_object(
    'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'hours', r.min_hours, 'cost', r.points_cost,
    'phase', case when d.id is not null then 'drawn' when r.entries_closed_at is not null then 'closed' else 'open' end,
    'count', (select count(*) from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat)),
    'entries', case when r.rule = 'points' then coalesce((select jsonb_agg(jsonb_build_object('name', x.shown, 'at', x.created_at) order by x.created_at desc) from (
        select public.public_name(e.login, e.display_name) as shown, e.created_at from public.raffle_entries e
         where e.raffle_id = r.id and lower(coalesce(e.login, '')) is distinct from b
           and (r.include_mods or not exists (select 1 from public.viewers v where v.is_moderator and (v.twitch_id = e.twitch_id or lower(v.login) = lower(e.login))))
         order by e.created_at desc limit 150) x), '[]'::jsonb) else '[]'::jsonb end,
    'sample', case when r.rule <> 'points' then coalesce((select jsonb_agg(x.shown) from (
        select e.shown from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e
         order by random() limit 80) x), '[]'::jsonb) else '[]'::jsonb end,
    'winners', coalesce((select jsonb_agg(coalesce(x.shown_name, public.public_name(x.login, x.login)) order by x.id) from public.raffle_draws x where x.raffle_id = r.id), '[]'::jsonb),
    'draw', case when d.id is null then null else jsonb_build_object(
      'id', d.id, 'name', coalesce(d.shown_name, public.public_name(d.login, d.login)), 'at', d.drawn_at, 'shownAt', d.shown_at,
      'entrants', d.entrants, 'total', coalesce(d.entrants_total, jsonb_array_length(d.entrants))) end);
end; $$;

alter function private.compute_part(text) rename to compute_part_v6;
create function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb;
begin
  if p_part = 'raffle' then return private.raffle_part(); end if;
  if p_part = 'bingo' then
    -- Bingo draws only now: raffle draws play from part 'raffle'.
    base := private.compute_part_v5('bingo');
    if jsonb_typeof(base -> 'draw') = 'object' then
      return jsonb_set(base, '{draw}', (base -> 'draw') || jsonb_build_object('kind', 'bingo'));
    end if;
    return base;
  end if;
  return private.compute_part_v6(p_part);
end; $$;
revoke all on function private.compute_part(text), private.compute_part_v6(text), private.raffle_part() from public, anon, authenticated;

create trigger state_raffle_r after insert or update or delete on public.raffles
  for each statement execute function private.on_state_change('raffle');
create trigger state_raffle_e after insert or update or delete on public.raffle_entries
  for each statement execute function private.on_state_change('raffle');
create trigger state_raffle_d2 after insert or update or delete on public.raffle_draws
  for each statement execute function private.on_state_change('raffle');

revoke all on function public.mod_raffle_stream(bigint, boolean), public.mod_raffle_end(bigint) from public, anon;
grant execute on function public.mod_raffle_stream(bigint, boolean), public.mod_raffle_end(bigint) to authenticated;

select private.refresh_parts(array['raffle', 'bingo']);
