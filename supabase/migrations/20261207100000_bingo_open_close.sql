-- Bingo opens and closes when moderators (Iceman included) choose (owner, 24 Nov 2026), not on
-- a date written in code. Three phases:
--   soon    not open yet (no open time, or it is still ahead): viewers see the card, can't pick.
--   open    viewers pick their line and can change it until the close.
--   closed  no more picks; moderators tick what happens on stream (and the automatic rules),
--           the card stays on the site until the end of the marathon.
-- /mod: «Deschide acum» / «Închide acum», or both times planned ahead. Once anything is ticked
-- or drawn the times are final ('bingo_ticked').
-- The 25 Dec 12:00 close set in 20261123140000 is cleared: bingo starts as «soon».

alter table public.bingo_settings add column if not exists opens_at timestamptz;

create or replace function private.bingo_phase()
returns text language sql stable security definer set search_path = '' as $$
  select case
    when s.opens_at is null or s.opens_at > now() then 'soon'
    when s.closes_at is not null and s.closes_at <= now() then 'closed'
    else 'open' end
  from public.bingo_settings s where s.id = 1;
$$;

create or replace function private.bingo_closed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.bingo_phase() = 'closed', false);
$$;

create or replace function private.bingo_dates_final()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bingo_items where happened_at is not null) or exists (select 1 from public.bingo_draws);
$$;
revoke execute on function private.bingo_phase(), private.bingo_closed(), private.bingo_dates_final() from public, anon, authenticated;

-- Viewers: a line only while bingo is open.
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
  if cardinality(pick) <> 5 or not exists (select 1 from private.bingo_lines() l where l = pick) then
    raise exception 'not_a_line' using errcode = 'P0001';
  end if;
  insert into public.bingo_picks (viewer_id, items, updated_at)
    values (me, pick, now())
  on conflict (viewer_id) do update set items = excluded.items, updated_at = now();
end; $$;

-- Planned times + prize. Both times are optional; a close needs an open before it.
drop function if exists public.mod_bingo_settings(timestamptz, text, text);
create function public.mod_bingo_settings(p_opens_at timestamptz, p_closes_at timestamptz, p_prize text, p_prize_sponsor text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cur public.bingo_settings%rowtype;
begin
  perform private.require_moderator();
  select * into cur from public.bingo_settings where id = 1 for update;
  if (p_opens_at is distinct from cur.opens_at or p_closes_at is distinct from cur.closes_at) and private.bingo_dates_final() then
    raise exception 'bingo_ticked' using errcode = 'P0001';
  end if;
  if p_closes_at is not null and (p_opens_at is null or p_closes_at <= p_opens_at) then
    raise exception 'bingo_bad_dates' using errcode = 'P0001';
  end if;
  update public.bingo_settings
    set opens_at = p_opens_at,
        closes_at = p_closes_at,
        prize = coalesce(nullif(btrim(p_prize), ''), prize),
        prize_sponsor = left(nullif(btrim(coalesce(p_prize_sponsor, '')), ''), 60)
    where id = 1;
end; $$;

-- «Deschide acum»: open from now; a close already passed (nothing ticked) is cleared.
create or replace function public.mod_bingo_open()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if private.bingo_phase() = 'open' then return; end if;
  if private.bingo_dates_final() then raise exception 'bingo_ticked' using errcode = 'P0001'; end if;
  update public.bingo_settings
    set opens_at = now(),
        closes_at = case when closes_at is not null and closes_at > now() then closes_at end
    where id = 1;
end; $$;

-- «Închide acum»: only while open.
create or replace function public.mod_bingo_close()
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if private.bingo_phase() <> 'open' then raise exception 'bingo_not_open' using errcode = 'P0001'; end if;
  update public.bingo_settings set closes_at = now() where id = 1;
end; $$;

-- The site gets the open time too (it works out the phase itself, so planned times need no cron).
alter function private.compute_part(text) rename to compute_part_v3;
create function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_part = 'bingo' then
    return private.compute_part_v3('bingo') || jsonb_build_object('opensAt', (select opens_at from public.bingo_settings where id = 1));
  end if;
  return private.compute_part_v3(p_part);
end; $$;
revoke execute on function private.compute_part(text), private.compute_part_v3(text) from public, anon, authenticated;

revoke all on function public.mod_bingo_settings(timestamptz, timestamptz, text, text), public.mod_bingo_open(), public.mod_bingo_close() from public, anon;
grant execute on function public.mod_bingo_settings(timestamptz, timestamptz, text, text), public.mod_bingo_open(), public.mod_bingo_close() to authenticated;

-- No hard-coded dates: bingo waits for a moderator (only if nothing was picked or ticked yet).
update public.bingo_settings set opens_at = null, closes_at = null
  where id = 1 and not private.bingo_dates_final() and not exists (select 1 from public.bingo_picks);
select private.refresh_parts(array['bingo']);
