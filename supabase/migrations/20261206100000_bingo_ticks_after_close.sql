-- Bingo ticks only after the close (owner, 24 Nov 2026): viewers pick their line while the
-- picks are open (they can change it until the close); things start counting on stream only
-- once the picks are closed, so a late joiner can't choose a line that is already ticked.
--   * mod_bingo_tick refuses until the close ('bingo_open').
--   * Automatic ticks wait for the close too, and count only what happened after it.
--   * The close can't be moved later once anything is ticked or drawn ('bingo_ticked'):
--     that would reopen the picks with ticks already showing.

create or replace function private.bingo_closed()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.closes_at <= now() from public.bingo_settings s where s.id = 1), false);
$$;
revoke execute on function private.bingo_closed() from public, anon, authenticated;

create or replace function public.mod_bingo_tick(p_id integer, p_happened boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if not private.bingo_closed() then
    raise exception 'bingo_open' using errcode = 'P0001';
  end if;
  update public.bingo_items
    set happened_at = case when p_happened then coalesce(happened_at, now()) end
    where id = p_id;
end; $$;

create or replace function public.mod_bingo_settings(p_closes_at timestamptz, p_prize text, p_prize_sponsor text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cur timestamptz := (select closes_at from public.bingo_settings where id = 1);
begin
  perform private.require_moderator();
  if (p_closes_at is null or p_closes_at > now()) and p_closes_at is distinct from cur
     and (exists (select 1 from public.bingo_items where happened_at is not null) or exists (select 1 from public.bingo_draws)) then
    raise exception 'bingo_ticked' using errcode = 'P0001';
  end if;
  update public.bingo_settings
    set closes_at = p_closes_at,
        prize = coalesce(nullif(btrim(p_prize), ''), prize),
        prize_sponsor = left(nullif(btrim(coalesce(p_prize_sponsor, '')), ''), 60)
    where id = 1;
end; $$;

-- Automatic rules: nothing before the close, and only what happened after it.
create or replace function private.bingo_rule_hit(r jsonb)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
  closed_at timestamptz := (select closes_at from public.bingo_settings where id = 1);
  since timestamptz;
  after_close numeric;
begin
  if closed_at is null or closed_at > now() then return false; end if;
  select * into t from public.timer where id = 1;
  if t.status = 'upcoming' then return false; end if;
  since := greatest(coalesce(t.starts_at, '-infinity'::timestamptz), closed_at);
  case r ->> 't'
    when 'milestone' then
      return exists (select 1 from public.goals g where g.position = (r ->> 'n')::integer and g.unlocked_at >= since);
    when 'double' then
      return exists (select 1 from public.double_hours d where d.starts_at <= now() and d.starts_at >= since);
    when 'donation' then
      return exists (select 1 from public.events e where e.kind = 'donation' and e.created_at >= since
                     and e.quantity >= (r ->> 'eur')::numeric);
    when 'gift' then
      return exists (select 1 from public.events e where e.kind = 'gift' and e.created_at >= since
                     and e.quantity >= (r ->> 'n')::numeric);
    when 'hours' then
      return t.status = 'live' and t.ends_at - now() >= make_interval(hours => (r ->> 'h')::integer);
    when 'code' then
      return exists (select 1 from public.secret_codes s where s.shown_at >= since);
    when 'raised' then
      -- The total crossed the mark after the close (not already past it when picks closed).
      select coalesce(sum(e.quantity), 0) into after_close from public.events e where e.kind = 'donation' and e.created_at >= since;
      return (select s.raised from public.stats s where s.id = 1) >= (r ->> 'eur')::numeric
         and (select s.raised from public.stats s where s.id = 1) - after_close < (r ->> 'eur')::numeric;
    else
      return false;
  end case;
exception when others then
  return false;
end; $$;
revoke execute on function private.bingo_rule_hit(jsonb) from public, anon, authenticated;

-- Anything ticked while the picks are still open goes back (none in production on 24 Nov).
update public.bingo_items set happened_at = null where happened_at is not null and not private.bingo_closed();
