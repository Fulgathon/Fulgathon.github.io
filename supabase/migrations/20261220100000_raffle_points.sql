-- Tombole with Twitch channel points (owner, 25 Nov 2026).
--   * A raffle's rule can be 'points': viewers enter by redeeming a channel-points reward on Twitch
--     that costs points_cost. The site creates that reward (Edge Function raffle-reward, the
--     streamer's token with channel:manage:redemptions) and deletes it when entries close.
--   * One entry per person: the first redemption puts them on the list (FULFILLED on Twitch), an extra
--     or late one gets its points back (CANCELED). raffle_redeem() decides, twitch-eventsub applies it.
--   * Entries close with «Închide înscrierile» or, at the latest, on the first «Trage la sorți»; the
--     entries stay here, so «Trage încă un câștigător» still works. «Redeschide» (only before any draw)
--     puts a new reward on Twitch. Deleting the raffle deletes its reward too (raffle_reward_trash).
--   * Channel points are earned by watching and can't be bought, so entry stays free (gambling rules).
--   * During «Mod test» nothing is created on Twitch (the plan says test: true).

alter table public.raffles drop constraint if exists raffles_rule_check;
alter table public.raffles add constraint raffles_rule_check check (rule in ('all', 'subs', 'hours', 'points'));
alter table public.raffles add column if not exists points_cost integer check (points_cost is null or points_cost between 1 and 1000000);
alter table public.raffles add column if not exists entries_closed_at timestamptz;
alter table public.raffles add column if not exists twitch_reward_id text;
alter table public.raffles add column if not exists reward_error text;
alter table public.raffles add column if not exists reward_creating_at timestamptz;
alter table public.raffles add constraint raffles_points_cost check (rule <> 'points' or points_cost is not null);

create table public.raffle_entries (
  raffle_id      bigint not null references public.raffles (id) on delete cascade,
  twitch_id      text not null,
  login          text,
  display_name   text,
  redemption_id  text,
  created_at     timestamptz not null default now(),
  primary key (raffle_id, twitch_id)
);
alter table public.raffle_entries enable row level security;
revoke all on public.raffle_entries from anon, authenticated;
grant all on public.raffle_entries to service_role;

-- Rewards to remove from Twitch (a deleted raffle, or a points raffle switched to another rule).
-- removed_at: gone from Twitch; the row stays a day so a redemption already on its way gets its points back.
create table private.raffle_reward_trash (
  reward_id   text primary key,
  added_at    timestamptz not null default now(),
  removed_at  timestamptz
);

create or replace function private.raffle_rule_ok(p_rule text, p_min_hours numeric)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_rule not in ('all', 'subs', 'hours', 'points') then raise exception 'bad_raffle' using errcode = 'P0001'; end if;
  if p_rule = 'hours' and (p_min_hours is null or p_min_hours <= 0 or p_min_hours > 2000) then
    raise exception 'bad_raffle_hours' using errcode = 'P0001';
  end if;
end; $$;

-- Who is on the list: for 'points' the people who redeemed (moderators only with the tick, never the
-- streamer); otherwise the list by rule, as before.
create or replace function private.raffle_eligible(p_raffle bigint, p_rule text, p_min_hours numeric, p_mods boolean, p_past boolean, p_repeat boolean)
returns table (twitch_id text, login text, shown text, can_win boolean) language sql stable security definer set search_path = '' as $$
  with b as (select lower(btrim(s.broadcaster_login)) as l from private.settings s where s.id = 1),
  base as (
    select p.twitch_id, p.login, p.shown from private.raffle_pool(p_rule, p_min_hours, p_mods) p where p_rule <> 'points'
    union all
    select e.twitch_id, coalesce(e.display_name, e.login), public.public_name(e.login, e.display_name)
      from public.raffle_entries e
      where p_rule = 'points' and e.raffle_id = p_raffle
        and lower(coalesce(e.login, '')) is distinct from (select l from b)
        and (p_mods or not exists (select 1 from public.viewers v where v.is_moderator and (v.twitch_id = e.twitch_id or lower(v.login) = lower(e.login))))
  )
  select p.twitch_id, p.login, p.shown,
         (p_repeat or not exists (select 1 from public.raffle_draws d where d.raffle_id = p_raffle
                                  and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login))))
     and (p_past or not exists (select 1 from public.raffle_draws d where d.raffle_id is distinct from p_raffle
                                and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login))))
    from base p;
$$;
revoke execute on function private.raffle_eligible(bigint, text, numeric, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.mod_raffles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'min_hours', r.min_hours,
      'include_mods', r.include_mods, 'allow_past_winners', r.allow_past_winners, 'allow_repeat', r.allow_repeat,
      'points_cost', r.points_cost, 'entries_closed_at', r.entries_closed_at,
      'on_twitch', r.twitch_reward_id is not null, 'reward_error', r.reward_error,
      'entries', (select count(*) from public.raffle_entries e where e.raffle_id = r.id),
      'created_by', r.created_by, 'created_at', r.created_at,
      'pool', (select count(*) from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e where e.can_win),
      'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'login', d.login, 'drawn_at', d.drawn_at,
                 'drawn_by', d.drawn_by, 'given_at', d.given_at, 'total', d.entrants_total) order by d.id)
               from public.raffle_draws d where d.raffle_id = r.id), '[]'::jsonb)) order by r.id desc)
    from public.raffles r), '[]'::jsonb);
end; $$;

create or replace function public.mod_raffle_count(p_rule text, p_min_hours numeric default null, p_include_mods boolean default false, p_allow_past boolean default true)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform private.raffle_rule_ok(p_rule, p_min_hours);
  if p_rule = 'points' then return 0; end if;   -- the list fills as viewers redeem
  return (select count(*) from private.raffle_eligible(null, p_rule, p_min_hours, coalesce(p_include_mods, false), coalesce(p_allow_past, true), false) e where e.can_win);
end; $$;

-- Add or change a raffle. The rule (and the points cost) lock after the first draw; the cost also
-- locks once the reward is on Twitch or someone entered. Leaving 'points' sends the reward to the trash.
drop function if exists public.mod_raffle_save(bigint, text, text, text, numeric, boolean, boolean, boolean);
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
    insert into public.raffles (prize, sponsor, rule, min_hours, points_cost, include_mods, allow_past_winners, allow_repeat, created_by)
      values (btrim(p_prize), nullif(btrim(coalesce(p_sponsor, '')), ''), p_rule, hrs, cost,
              coalesce(p_include_mods, false), coalesce(p_allow_past, true), coalesce(p_allow_repeat, false), private.me_login())
      returning id into new_id;
    return new_id;
  end if;
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
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

-- «Închide înscrierile» / «Redeschide» (points raffles; reopening only before any draw).
create or replace function public.mod_raffle_entries(p_id bigint, p_open boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
begin
  perform private.require_moderator();
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if r.rule <> 'points' then raise exception 'not_points_raffle' using errcode = 'P0001'; end if;
  if p_open then
    if exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then raise exception 'raffle_drawn' using errcode = 'P0001'; end if;
    update public.raffles set entries_closed_at = null, reward_error = null where id = p_id;
  else
    update public.raffles set entries_closed_at = coalesce(entries_closed_at, now()) where id = p_id;
  end if;
end; $$;

create or replace function public.mod_raffle_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rid text;
begin
  perform private.require_moderator();
  if exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then raise exception 'raffle_drawn' using errcode = 'P0001'; end if;
  select twitch_reward_id into rid from public.raffles where id = p_id;
  if rid is not null then insert into private.raffle_reward_trash (reward_id) values (rid) on conflict do nothing; end if;
  delete from public.raffles where id = p_id;
end; $$;

-- «Trage la sorți»: a points raffle closes its entries first (its reward then leaves Twitch).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.mod_raffle_draw(bigint)'::regprocedure);
  if position('if not found then raise exception ''no_raffle''' in d) = 0 then raise exception 'mod_raffle_draw: unexpected body'; end if;
  execute replace(d, 'if not found then raise exception ''no_raffle'' using errcode = ''P0001''; end if;',
    'if not found then raise exception ''no_raffle'' using errcode = ''P0001''; end if;
  if r.rule = ''points'' and r.entries_closed_at is null then
    update public.raffles set entries_closed_at = now() where id = r.id;
  end if;');
end $$;

-- A redemption from Twitch (twitch-eventsub, service role): 'entered' | 'duplicate' | 'closed' (both get
-- their points back) | null (not a raffle reward: leave it alone).
create or replace function public.raffle_redeem(p_reward_id text, p_redemption_id text, p_user_id text, p_login text, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  n integer;
begin
  select * into r from public.raffles where twitch_reward_id = p_reward_id;
  if not found then
    return case when exists (select 1 from private.raffle_reward_trash t where t.reward_id = p_reward_id) then 'closed' end;
  end if;
  -- During «Mod test» everything is put back at the end, so a real entry would be lost: refund it.
  if r.entries_closed_at is not null or p_user_id is null or private.test_active() then return 'closed'; end if;
  insert into public.raffle_entries (raffle_id, twitch_id, login, display_name, redemption_id)
    values (r.id, p_user_id, lower(p_login), p_name, p_redemption_id)
  on conflict (raffle_id, twitch_id) do nothing;
  get diagnostics n = row_count;
  return case when n = 1 then 'entered' else 'duplicate' end;
end; $$;

-- The Edge Function raffle-reward asks what to do on Twitch, then reports back (service role only).
create or replace function public.raffle_reward_plan()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ids bigint[];
begin
  -- Claim the rewards to create (30 s), so two moderators clicking at once don't make two.
  ids := array(select id from public.raffles
               where rule = 'points' and entries_closed_at is null and twitch_reward_id is null
                 and (reward_creating_at is null or reward_creating_at < now() - interval '30 seconds'));
  update public.raffles set reward_creating_at = now() where id = any (ids);
  return jsonb_build_object(
    'test', private.test_active(),
    'create', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'prize', prize, 'cost', points_cost)) from public.raffles where id = any (ids)), '[]'::jsonb),
    'delete', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'reward', twitch_reward_id)) from public.raffles
                        where twitch_reward_id is not null and entries_closed_at is not null), '[]'::jsonb),
    'trash', coalesce((select jsonb_agg(reward_id) from private.raffle_reward_trash where removed_at is null), '[]'::jsonb));
end; $$;

create or replace function public.raffle_reward_done(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x jsonb;
begin
  for x in select * from jsonb_array_elements(coalesce(p -> 'created', '[]'::jsonb)) loop
    update public.raffles set twitch_reward_id = nullif(x ->> 'reward', ''), reward_error = nullif(x ->> 'error', ''), reward_creating_at = null
      where id = (x ->> 'id')::bigint;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p -> 'deleted', '[]'::jsonb)) loop
    insert into private.raffle_reward_trash (reward_id, removed_at) values (x ->> 'reward', now())
      on conflict (reward_id) do update set removed_at = now();
    update public.raffles set twitch_reward_id = null where twitch_reward_id = x ->> 'reward';
  end loop;
  update private.raffle_reward_trash set removed_at = now()
    where removed_at is null and reward_id in (select jsonb_array_elements_text(coalesce(p -> 'trashed', '[]'::jsonb)));
  delete from private.raffle_reward_trash where removed_at < now() - interval '1 day';
end; $$;

revoke all on function public.raffle_redeem(text, text, text, text, text), public.raffle_reward_plan(), public.raffle_reward_done(jsonb) from public, anon, authenticated;
grant execute on function public.raffle_redeem(text, text, text, text, text), public.raffle_reward_plan(), public.raffle_reward_done(jsonb) to service_role;
revoke all on function public.mod_raffle_save(bigint, text, text, text, numeric, boolean, boolean, boolean, integer), public.mod_raffle_entries(bigint, boolean) from public, anon;
grant execute on function public.mod_raffle_save(bigint, text, text, text, numeric, boolean, boolean, boolean, integer), public.mod_raffle_entries(bigint, boolean) to authenticated;
