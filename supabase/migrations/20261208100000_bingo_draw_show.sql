-- The bingo draw, on stream and on the site (owner, 24 Nov 2026): Iceman (or a moderator) presses
-- «Trage la sorți» on /mod; the server picks the winner first (random, recorded), then the overlay
-- piece «Tragerea la bingo» plays a reel of every entry that stops on that winner. The animation is
-- only the show: the result is fixed before it starts.
--   * bingo_draws keeps the entries as they were at the draw (public names, shuffled, at most 300)
--     and when the overlay should play it (shown_at; «Arată din nou» sets it again).
--   * Part 'bingo' gets the draws: winners for the site, the latest draw with its entries for the overlay.
--   * my_state says whether the logged-in viewer won («Ai câștigat!»).
-- Names go through public.public_name (hidden or blocked names show as «Anonim»).

alter table public.bingo_draws add column if not exists entrants jsonb not null default '[]'::jsonb;
alter table public.bingo_draws add column if not exists shown_name text;
alter table public.bingo_draws add column if not exists shown_at timestamptz not null default now();
alter table public.bingo_draws add column if not exists entrants_total integer;   -- everyone with bingo (the reel shows at most 300)

create trigger state_bingo_d after insert or update or delete on public.bingo_draws
  for each statement execute function private.on_state_change('bingo');

create or replace function public.mod_bingo_draw()
returns text language plpgsql security definer set search_path = '' as $$
declare
  full_list jsonb;
  w jsonb;
  pool jsonb;
begin
  perform private.require_moderator();
  if not private.bingo_closed() then raise exception 'bingo_open' using errcode = 'P0001'; end if;
  -- Everyone with all 5 events ticked (earlier winners stay in the reel but can't win again).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.viewer_id, 'login', coalesce(v.display_name, v.login), 'shown', public.public_name(v.login, v.display_name),
      'won', exists (select 1 from public.bingo_draws d where d.viewer_id = p.viewer_id))), '[]'::jsonb)
    into full_list
    from public.bingo_picks p join public.viewers v on v.id = p.viewer_id
    where not exists (select 1 from unnest(p.items) i
                      where not exists (select 1 from public.bingo_items b where b.id = i and b.happened_at is not null));
  select e into w from jsonb_array_elements(full_list) e where not (e ->> 'won')::boolean order by random() limit 1;
  if w is null then raise exception 'no_bingo_winners' using errcode = 'P0001'; end if;
  -- The reel: the winner plus up to 299 others, shuffled.
  select coalesce(jsonb_agg(shown order by random()), '[]'::jsonb) into pool from (
    (select e ->> 'shown' as shown from jsonb_array_elements(full_list) e where e ->> 'id' <> w ->> 'id' order by random() limit 299)
    union all select w ->> 'shown') x;
  insert into public.bingo_draws (viewer_id, login, shown_name, entrants, entrants_total, shown_at)
    values ((w ->> 'id')::uuid, w ->> 'login', w ->> 'shown', pool, jsonb_array_length(full_list), now());
  return w ->> 'login';
end; $$;

-- «Arată din nou»: the overlay plays the latest draw again.
create or replace function public.mod_bingo_replay()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.bingo_draws set shown_at = now() where id = (select max(id) from public.bingo_draws);
  if not found then raise exception 'no_bingo_draw' using errcode = 'P0001'; end if;
end; $$;

-- Part 'bingo': + winners (site) and the latest draw with its reel (overlay).
create or replace function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  last public.bingo_draws%rowtype;
begin
  if p_part = 'bingo' then
    select * into last from public.bingo_draws order by id desc limit 1;
    return private.compute_part_v3('bingo') || jsonb_build_object(
      'opensAt', (select opens_at from public.bingo_settings where id = 1),
      'winners', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', coalesce(d.shown_name, public.public_name(d.login, d.login)), 'at', d.drawn_at) order by d.id)
                           from public.bingo_draws d), '[]'::jsonb),
      'draw', case when last.id is null then null else jsonb_build_object(
        'id', last.id, 'name', coalesce(last.shown_name, public.public_name(last.login, last.login)),
        'at', last.drawn_at, 'shownAt', last.shown_at, 'entrants', last.entrants,
        'total', coalesce(last.entrants_total, jsonb_array_length(last.entrants))) end);
  end if;
  return private.compute_part_v3(p_part);
end; $$;
revoke execute on function private.compute_part(text) from public, anon, authenticated;

-- my_state + whether this viewer won the bingo draw.
alter function public.my_state(integer) set schema private;
alter function private.my_state(integer) rename to my_state_base;
revoke all on function private.my_state_base(integer) from public, anon, authenticated;
create function public.my_state(p_round integer default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  base jsonb := private.my_state_base(p_round);
begin
  if base is null then return null; end if;
  return base || jsonb_build_object('bingoWon', exists (select 1 from public.bingo_draws where viewer_id = auth.uid()));
end; $$;
revoke all on function public.my_state(integer) from public, anon;
grant execute on function public.my_state(integer) to authenticated;

revoke all on function public.mod_bingo_replay() from public, anon;
grant execute on function public.mod_bingo_replay() to authenticated;

select private.refresh_parts(array['bingo']);
