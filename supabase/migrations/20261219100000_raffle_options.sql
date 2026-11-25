-- Tombole: three ticks per raffle (owner, 25 Nov 2026: «ticks for full control»).
--   * include_mods        moderators are on the list too (default off). The streamer never is.
--   * allow_past_winners  people who already won ANOTHER raffle are on the list (default on, as before).
--   * allow_repeat        the same person can win this raffle again on «Trage încă un câștigător» (default off).
-- Still free to enter, still nothing about donations.

alter table public.raffles add column if not exists include_mods boolean not null default false;
alter table public.raffles add column if not exists allow_past_winners boolean not null default true;
alter table public.raffles add column if not exists allow_repeat boolean not null default false;

-- The list by rule; moderators only when p_mods. The broadcaster is never on it.
create or replace function private.raffle_pool(p_rule text, p_min_hours numeric, p_mods boolean)
returns table (twitch_id text, login text, shown text) language sql stable security definer set search_path = '' as $$
  with b as (select lower(btrim(s.broadcaster_login)) as l from private.settings s where s.id = 1)
  select v.twitch_id, coalesce(v.display_name, v.login), public.public_name(v.login, v.display_name)
    from public.viewers v
    where p_rule in ('all', 'subs') and v.login is not null and (p_mods or not v.is_moderator)
      and lower(v.login) is distinct from (select l from b)
      and (p_rule = 'all' or v.is_subscriber)
  union all
  select w.twitch_id, coalesce(w.display_name, w.login), public.public_name(w.login, w.display_name)
    from public.watch_time w
    where p_rule = 'hours' and w.minutes >= ceil(coalesce(p_min_hours, 1) * 60)
      and lower(w.login) is distinct from (select l from b)
      and (p_mods or not exists (select 1 from public.viewers v where v.is_moderator and (v.twitch_id = w.twitch_id or lower(v.login) = lower(w.login))));
$$;
drop function if exists private.raffle_pool(text, numeric);

-- Everyone on the list, and whether they can win this draw (p_raffle null = a raffle not saved yet).
create or replace function private.raffle_eligible(p_raffle bigint, p_rule text, p_min_hours numeric, p_mods boolean, p_past boolean, p_repeat boolean)
returns table (twitch_id text, login text, shown text, can_win boolean) language sql stable security definer set search_path = '' as $$
  select p.twitch_id, p.login, p.shown,
         (p_repeat or not exists (select 1 from public.raffle_draws d where d.raffle_id = p_raffle
                                  and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login))))
     and (p_past or not exists (select 1 from public.raffle_draws d where d.raffle_id is distinct from p_raffle
                                and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login))))
    from private.raffle_pool(p_rule, p_min_hours, p_mods) p;
$$;
revoke execute on function private.raffle_pool(text, numeric, boolean), private.raffle_eligible(bigint, text, numeric, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.mod_raffles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'min_hours', r.min_hours,
      'include_mods', r.include_mods, 'allow_past_winners', r.allow_past_winners, 'allow_repeat', r.allow_repeat,
      'created_by', r.created_by, 'created_at', r.created_at,
      'pool', (select count(*) from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e where e.can_win),
      'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'login', d.login, 'drawn_at', d.drawn_at,
                 'drawn_by', d.drawn_by, 'given_at', d.given_at, 'total', d.entrants_total) order by d.id)
               from public.raffle_draws d where d.raffle_id = r.id), '[]'::jsonb)) order by r.id desc)
    from public.raffles r), '[]'::jsonb);
end; $$;

-- The new-raffle form's count.
drop function if exists public.mod_raffle_count(text, numeric);
create or replace function public.mod_raffle_count(p_rule text, p_min_hours numeric default null, p_include_mods boolean default false, p_allow_past boolean default true)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform private.raffle_rule_ok(p_rule, p_min_hours);
  return (select count(*) from private.raffle_eligible(null, p_rule, p_min_hours, coalesce(p_include_mods, false), coalesce(p_allow_past, true), false) e where e.can_win);
end; $$;

-- Add or change a raffle; the three ticks can change any time (they act on the next draw).
drop function if exists public.mod_raffle_save(bigint, text, text, text, numeric);
create or replace function public.mod_raffle_save(p_id bigint, p_prize text, p_sponsor text, p_rule text, p_min_hours numeric default null,
  p_include_mods boolean default false, p_allow_past boolean default true, p_allow_repeat boolean default false)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  hrs numeric := case when p_rule = 'hours' then p_min_hours end;
  new_id bigint;
begin
  perform private.require_moderator();
  if length(btrim(coalesce(p_prize, ''))) not between 1 and 120 then raise exception 'bad_raffle_prize' using errcode = 'P0001'; end if;
  perform private.raffle_rule_ok(p_rule, hrs);
  if p_id is null then
    insert into public.raffles (prize, sponsor, rule, min_hours, include_mods, allow_past_winners, allow_repeat, created_by)
      values (btrim(p_prize), nullif(btrim(coalesce(p_sponsor, '')), ''), p_rule, hrs,
              coalesce(p_include_mods, false), coalesce(p_allow_past, true), coalesce(p_allow_repeat, false), private.me_login())
      returning id into new_id;
    return new_id;
  end if;
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if (r.rule, r.min_hours) is distinct from (p_rule, hrs) and exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then
    raise exception 'raffle_drawn' using errcode = 'P0001';
  end if;
  update public.raffles set prize = btrim(p_prize), sponsor = nullif(btrim(coalesce(p_sponsor, '')), ''), rule = p_rule, min_hours = hrs,
      include_mods = coalesce(p_include_mods, false), allow_past_winners = coalesce(p_allow_past, true), allow_repeat = coalesce(p_allow_repeat, false)
    where id = p_id;
  return p_id;
end; $$;

-- «Trage la sorți» with the ticks.
create or replace function public.mod_raffle_draw(p_id bigint)
returns text language plpgsql security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  full_list jsonb;
  w jsonb;
  pool jsonb;
begin
  perform private.require_moderator();
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('tid', e.twitch_id, 'login', e.login, 'shown', e.shown, 'ok', e.can_win)), '[]'::jsonb)
    into full_list from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e;
  select e into w from jsonb_array_elements(full_list) e where (e ->> 'ok')::boolean order by random() limit 1;
  if w is null then raise exception 'raffle_empty' using errcode = 'P0001'; end if;
  select coalesce(jsonb_agg(shown order by random()), '[]'::jsonb) into pool from (
    (select e ->> 'shown' as shown from jsonb_array_elements(full_list) e where e ->> 'login' is distinct from w ->> 'login' order by random() limit 299)
    union all select w ->> 'shown') x;
  insert into public.raffle_draws (raffle_id, twitch_id, login, shown_name, entrants, entrants_total, drawn_by)
    values (r.id, w ->> 'tid', w ->> 'login', w ->> 'shown', pool, jsonb_array_length(full_list), private.me_login());
  perform private.alert('raffle', format('Tombolă: %s a câștigat «%s»%s. Marcați «Dat» pe /mod după ce primește premiul.',
    w ->> 'login', r.prize, case when r.sponsor is not null then ' (de la ' || r.sponsor || ')' else '' end));
  return w ->> 'login';
end; $$;

revoke all on function public.mod_raffle_count(text, numeric, boolean, boolean),
  public.mod_raffle_save(bigint, text, text, text, numeric, boolean, boolean, boolean) from public, anon;
grant execute on function public.mod_raffle_count(text, numeric, boolean, boolean),
  public.mod_raffle_save(bigint, text, text, text, numeric, boolean, boolean, boolean) to authenticated;
