-- «Prelungește» (owner, 25 Nov 2026): while the marathon is LIVE, Iceman can move the planned end
-- («Final programat») later, as often as he wants, without ending or restarting anything. The clock
-- gets the same extra time (owner: «Date and clock»), so it can't run out before the new date:
-- planned end 17 Jan → 25 Jan = +8 days on the countdown, even if subs already pushed it further.
--   * Only the broadcaster (like start / end; during «Mod test» any moderator, via require_broadcaster).
--   * Only later than the current planned end (or than now, if that already passed); at most a year ahead.
--   * Zero is final (B-08): a clock that reached 00:00:00:00 can't be extended.
--   * The time goes straight onto the clock (no feed event: the overlay doesn't play «+11520 min»).
--   * Discord alert, so the other moderators know.

create or replace function public.mod_extend(p_new_end timestamptz)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
  base timestamptz;
  secs bigint;
begin
  perform private.require_broadcaster();
  select * into t from public.timer where id = 1 for update;
  if t.status <> 'live' then
    raise exception 'timer_not_live' using errcode = 'P0001';
  end if;
  if t.ends_at is null or (t.ends_at <= now() and (t.paused_until is null or t.paused_until <= now())) then
    raise exception 'timer_ended' using errcode = 'P0001';
  end if;
  base := greatest(coalesce(t.scheduled_end, now()), now());
  if p_new_end is null or p_new_end < base + interval '1 minute' then
    raise exception 'extend_not_later' using errcode = 'P0001';
  end if;
  if p_new_end > now() + interval '366 days' then
    raise exception 'extend_too_far' using errcode = 'P0001';
  end if;
  secs := floor(extract(epoch from (p_new_end - base)))::bigint;
  update public.timer
    set ends_at = ends_at + make_interval(secs => secs), scheduled_end = p_new_end, updated_at = now()
    where id = 1;
  perform private.alert('extended', format('Subathonul a fost prelungit până la %s (+%s pe cronometru, de %s).',
    to_char(p_new_end at time zone 'Europe/Bucharest', 'DD.MM.YYYY HH24:MI'),
    case when secs >= 86400 then format('%s zile %s h', secs / 86400, (secs % 86400) / 3600) else format('%s h %s min', secs / 3600, (secs % 3600) / 60) end,
    coalesce(private.me_login(), 'un moderator')));
  return jsonb_build_object('added_seconds', secs, 'scheduled_end', p_new_end);
end; $$;

revoke all on function public.mod_extend(timestamptz) from public, anon;
grant execute on function public.mod_extend(timestamptz) to authenticated;
