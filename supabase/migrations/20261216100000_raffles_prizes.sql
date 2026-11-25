-- Tombole + «Premii de dat» (owner, 25 Nov 2026).
--   * A raffle (tombolă) is a prize + optional sponsor + a rule for who is on the list, chosen per raffle:
--     'all'   everyone logged in on the site with Twitch,
--     'subs'  subscribers logged in on the site,
--     'hours' everyone who watched at least N hours in total (chat presence; includes people who never
--             logged in on the site).
--     Free to enter, always: nothing about donations (gambling rules). Moderators and the streamer are
--     never on the list (they run the draw).
--   * «Trage la sorți»: the server picks the winner (random, recorded) and the overlay piece «Tragerea la
--     sorți» (?part=draw, the bingo reel) plays it. The part 'bingo' carries the latest draw of either kind
--     (kind 'bingo' or 'tombola', with its prize), so the same OBS source shows both.
--   * «Premii de dat»: one list of every win waiting to be handed out (wheel, bingo, raffle), «Dat» on each.
--   * The winner sees «Ai câștigat» on the site (my_state.raffleWon); raffle wins join «Ultimele premii».

create table public.raffles (
  id          bigint generated always as identity primary key,
  prize       text not null check (length(btrim(prize)) between 1 and 120),
  sponsor     text check (sponsor is null or length(sponsor) <= 60),
  rule        text not null check (rule in ('all', 'subs', 'hours')),
  min_hours   numeric check (min_hours is null or (min_hours > 0 and min_hours <= 2000)),
  created_by  text,
  created_at  timestamptz not null default now(),
  check (rule <> 'hours' or min_hours is not null)
);
create table public.raffle_draws (
  id              bigint generated always as identity primary key,
  raffle_id       bigint not null references public.raffles (id) on delete cascade,
  twitch_id       text,
  login           text not null,
  shown_name      text,
  entrants        jsonb not null default '[]'::jsonb,   -- the reel (public names, shuffled, at most 300)
  entrants_total  integer,
  drawn_by        text,
  drawn_at        timestamptz not null default now(),
  shown_at        timestamptz not null default now(),
  given_at        timestamptz,
  given_by        text
);
create index raffle_draws_raffle_idx on public.raffle_draws (raffle_id);
alter table public.raffles enable row level security;
alter table public.raffle_draws enable row level security;
revoke all on public.raffles, public.raffle_draws from anon, authenticated;
grant all on public.raffles, public.raffle_draws to service_role;

-- Bingo winners wait in «Premii de dat» too.
alter table public.bingo_draws add column if not exists given_at timestamptz;
alter table public.bingo_draws add column if not exists given_by text;

create trigger state_raffle_d after insert or update or delete on public.raffle_draws
  for each statement execute function private.on_state_change('bingo', 'wins');

-- Who is on a raffle's list right now: twitch id (may be null for old site accounts), full name, public name.
create or replace function private.raffle_pool(p_rule text, p_min_hours numeric)
returns table (twitch_id text, login text, shown text) language sql stable security definer set search_path = '' as $$
  with b as (select lower(btrim(s.broadcaster_login)) as l from private.settings s where s.id = 1)
  select v.twitch_id, coalesce(v.display_name, v.login), public.public_name(v.login, v.display_name)
    from public.viewers v
    where p_rule in ('all', 'subs') and v.login is not null and not v.is_moderator
      and lower(v.login) is distinct from (select l from b)
      and (p_rule = 'all' or v.is_subscriber)
  union all
  select w.twitch_id, coalesce(w.display_name, w.login), public.public_name(w.login, w.display_name)
    from public.watch_time w
    where p_rule = 'hours' and w.minutes >= ceil(coalesce(p_min_hours, 1) * 60)
      and lower(w.login) is distinct from (select l from b)
      and not exists (select 1 from public.viewers v where v.is_moderator and (v.twitch_id = w.twitch_id or lower(v.login) = lower(w.login)));
$$;
revoke execute on function private.raffle_pool(text, numeric) from public, anon, authenticated;

create or replace function private.raffle_rule_ok(p_rule text, p_min_hours numeric)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_rule not in ('all', 'subs', 'hours') then raise exception 'bad_raffle' using errcode = 'P0001'; end if;
  if p_rule = 'hours' and (p_min_hours is null or p_min_hours <= 0 or p_min_hours > 2000) then
    raise exception 'bad_raffle_hours' using errcode = 'P0001';
  end if;
end; $$;

-- /mod: every raffle, newest first, with how many are on its list now and its draws.
create or replace function public.mod_raffles()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'min_hours', r.min_hours,
      'created_by', r.created_by, 'created_at', r.created_at,
      'pool', (select count(*) from private.raffle_pool(r.rule, r.min_hours) p
               where not exists (select 1 from public.raffle_draws d where d.raffle_id = r.id
                                 and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login)))),
      'draws', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'login', d.login, 'drawn_at', d.drawn_at,
                 'drawn_by', d.drawn_by, 'given_at', d.given_at, 'total', d.entrants_total) order by d.id)
               from public.raffle_draws d where d.raffle_id = r.id), '[]'::jsonb)) order by r.id desc)
    from public.raffles r), '[]'::jsonb);
end; $$;

-- /mod: how many would be on a list with this rule (the form's preview).
create or replace function public.mod_raffle_count(p_rule text, p_min_hours numeric default null)
returns integer language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  perform private.raffle_rule_ok(p_rule, p_min_hours);
  return (select count(*) from private.raffle_pool(p_rule, p_min_hours));
end; $$;

-- /mod: add a raffle (p_id null) or change one. The rule can't change after the first draw.
create or replace function public.mod_raffle_save(p_id bigint, p_prize text, p_sponsor text, p_rule text, p_min_hours numeric default null)
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
    insert into public.raffles (prize, sponsor, rule, min_hours, created_by)
      values (btrim(p_prize), nullif(btrim(coalesce(p_sponsor, '')), ''), p_rule, hrs, private.me_login())
      returning id into new_id;
    return new_id;
  end if;
  select * into r from public.raffles where id = p_id for update;
  if not found then raise exception 'no_raffle' using errcode = 'P0001'; end if;
  if (r.rule, r.min_hours) is distinct from (p_rule, hrs) and exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then
    raise exception 'raffle_drawn' using errcode = 'P0001';
  end if;
  update public.raffles set prize = btrim(p_prize), sponsor = nullif(btrim(coalesce(p_sponsor, '')), ''), rule = p_rule, min_hours = hrs
    where id = p_id;
  return p_id;
end; $$;

-- /mod: delete a raffle that nobody has won yet.
create or replace function public.mod_raffle_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if exists (select 1 from public.raffle_draws d where d.raffle_id = p_id) then raise exception 'raffle_drawn' using errcode = 'P0001'; end if;
  delete from public.raffles where id = p_id;
end; $$;

-- «Trage la sorți»: one winner from the list, not drawn before in this raffle. The reel shows the winner and
-- up to 299 others (earlier winners of this raffle stay out of the pick but may appear in the reel).
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
  select coalesce(jsonb_agg(jsonb_build_object('tid', p.twitch_id, 'login', p.login, 'shown', p.shown,
      'won', exists (select 1 from public.raffle_draws d where d.raffle_id = r.id
                     and (d.twitch_id = p.twitch_id or (d.twitch_id is null and d.login = p.login))))), '[]'::jsonb)
    into full_list from private.raffle_pool(r.rule, r.min_hours) p;
  select e into w from jsonb_array_elements(full_list) e where not (e ->> 'won')::boolean order by random() limit 1;
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

-- «Arată din nou pe stream»: the overlay plays that raffle draw again.
create or replace function public.mod_raffle_replay(p_draw bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.raffle_draws set shown_at = now() where id = p_draw;
  if not found then raise exception 'no_raffle_draw' using errcode = 'P0001'; end if;
end; $$;

-- «Premii de dat»: every win not handed out yet (oldest first), and the last 15 handed out.
create or replace function public.mod_prizes_due()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  bp text;
  bs text;
begin
  perform private.require_moderator();
  select prize, prize_sponsor into bp, bs from public.bingo_settings where id = 1;
  return jsonb_build_object(
    'due', coalesce((select jsonb_agg(x order by x ->> 'at') from (
        select jsonb_build_object('kind', 'roata', 'id', s.id, 'login', s.user_login, 'prize', p.win_label, 'sponsor', p.sponsor, 'at', s.created_at) x
          from public.spins s join public.prizes p on p.position = s.prize_position where p.is_win and s.fulfilled_at is null
        union all
        select jsonb_build_object('kind', 'bingo', 'id', d.id, 'login', d.login, 'prize', bp, 'sponsor', bs, 'at', d.drawn_at)
          from public.bingo_draws d where d.given_at is null
        union all
        select jsonb_build_object('kind', 'tombola', 'id', d.id, 'login', d.login, 'prize', r.prize, 'sponsor', r.sponsor, 'at', d.drawn_at)
          from public.raffle_draws d join public.raffles r on r.id = d.raffle_id where d.given_at is null) q), '[]'::jsonb),
    'given', coalesce((select jsonb_agg(x order by x ->> 'given_at' desc) from (
        select * from (
          select jsonb_build_object('kind', 'roata', 'login', s.user_login, 'prize', p.win_label, 'given_at', s.fulfilled_at) x
            from public.spins s join public.prizes p on p.position = s.prize_position where p.is_win and s.fulfilled_at is not null
          union all
          select jsonb_build_object('kind', 'bingo', 'login', d.login, 'prize', bp, 'given_at', d.given_at, 'by', d.given_by)
            from public.bingo_draws d where d.given_at is not null
          union all
          select jsonb_build_object('kind', 'tombola', 'login', d.login, 'prize', r.prize, 'given_at', d.given_at, 'by', d.given_by)
            from public.raffle_draws d join public.raffles r on r.id = d.raffle_id where d.given_at is not null) a
        order by x ->> 'given_at' desc limit 15) q), '[]'::jsonb));
end; $$;

-- «Dat»: mark one win as handed out (kind 'roata' | 'bingo' | 'tombola').
create or replace function public.mod_prize_given(p_kind text, p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if p_kind = 'roata' then
    update public.spins set fulfilled_at = now() where id = p_id and fulfilled_at is null;
  elsif p_kind = 'bingo' then
    update public.bingo_draws set given_at = now(), given_by = private.me_login() where id = p_id and given_at is null;
  elsif p_kind = 'tombola' then
    update public.raffle_draws set given_at = now(), given_by = private.me_login() where id = p_id and given_at is null;
  else
    raise exception 'bad_prize_kind' using errcode = 'P0001';
  end if;
end; $$;

-- Parts: 'bingo'.draw is the latest draw of either kind (the overlay reel); 'wins' gets raffle wins.
alter function private.compute_part(text) rename to compute_part_v5;
create function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := private.compute_part_v5(p_part);
  rd record;
begin
  if p_part = 'bingo' then
    select d.*, r.prize, r.sponsor into rd from public.raffle_draws d join public.raffles r on r.id = d.raffle_id
      order by d.shown_at desc limit 1;
    if rd.id is not null and (base -> 'draw' is null or jsonb_typeof(base -> 'draw') = 'null'
                              or rd.shown_at > (base -> 'draw' ->> 'shownAt')::timestamptz) then
      return base || jsonb_build_object('draw', jsonb_build_object(
        'kind', 'tombola', 'id', rd.id, 'name', coalesce(rd.shown_name, public.public_name(rd.login, rd.login)),
        'at', rd.drawn_at, 'shownAt', rd.shown_at, 'entrants', rd.entrants,
        'total', coalesce(rd.entrants_total, jsonb_array_length(rd.entrants)), 'prize', rd.prize, 'sponsor', rd.sponsor));
    end if;
    if jsonb_typeof(base -> 'draw') = 'object' then
      return jsonb_set(base, '{draw}', (base -> 'draw') || jsonb_build_object('kind', 'bingo'));
    end if;
    return base;
  end if;
  if p_part = 'wins' then
    return coalesce((select jsonb_agg(q.e order by q.e ->> 'at' desc) from (
      select u.e from (
        select e from jsonb_array_elements(coalesce(base, '[]'::jsonb)) e
        union all
        select jsonb_build_object('user', coalesce(d.shown_name, public.public_name(d.login, d.login)), 'prize', r.prize,
                                  'sponsor', r.sponsor, 'at', d.drawn_at, 'kind', 'tombola')
          from (select * from public.raffle_draws order by drawn_at desc limit 12) d join public.raffles r on r.id = d.raffle_id) u
      order by u.e ->> 'at' desc limit 12) q), '[]'::jsonb);
  end if;
  return base;
end; $$;
revoke all on function private.compute_part(text), private.compute_part_v5(text) from public, anon, authenticated;

-- my_state + the latest raffle this viewer won (last 7 days), for «Ai câștigat» on the site.
alter function public.my_state(integer) set schema private;
alter function private.my_state(integer) rename to my_state_v2;
revoke all on function private.my_state_v2(integer) from public, anon, authenticated;
create function public.my_state(p_round integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := private.my_state_v2(p_round);
  v public.viewers%rowtype;
begin
  if base is null then return null; end if;
  select * into v from public.viewers where id = auth.uid();
  return base || jsonb_build_object('raffleWon', (
    select jsonb_build_object('id', d.id, 'prize', r.prize, 'sponsor', r.sponsor, 'at', d.drawn_at)
      from public.raffle_draws d join public.raffles r on r.id = d.raffle_id
      where d.drawn_at > now() - interval '7 days'
        and ((v.twitch_id is not null and d.twitch_id = v.twitch_id) or (d.twitch_id is null and lower(d.login) = lower(coalesce(v.display_name, v.login))))
      order by d.id desc limit 1));
end; $$;
revoke all on function public.my_state(integer) from public, anon;
grant execute on function public.my_state(integer) to authenticated;

revoke all on function public.mod_raffles(), public.mod_raffle_count(text, numeric), public.mod_raffle_save(bigint, text, text, text, numeric),
  public.mod_raffle_delete(bigint), public.mod_raffle_draw(bigint), public.mod_raffle_replay(bigint),
  public.mod_prizes_due(), public.mod_prize_given(text, bigint) from public, anon;
grant execute on function public.mod_raffles(), public.mod_raffle_count(text, numeric), public.mod_raffle_save(bigint, text, text, text, numeric),
  public.mod_raffle_delete(bigint), public.mod_raffle_draw(bigint), public.mod_raffle_replay(bigint),
  public.mod_prizes_due(), public.mod_prize_given(text, bigint) to authenticated;

select private.refresh_parts(array['bingo', 'wins']);
