-- Overlay tests from /mod (owner, 24 Nov 2026: after Iceman places the pieces in OBS, he tests
-- them from the console). A moderator presses «Testează» on /mod → Overlay OBS; the signal
-- travels in public_state as the part 'otest' (the overlay already polls every 3 s), and the
-- overlay plays sample events named «TEST». Nothing is recorded: no time, no stats, no feed.

insert into private.state_parts (part, version, data) values ('otest', 0, 'null'::jsonb)
  on conflict (part) do nothing;

create or replace function public.mod_overlay_test(p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if p_kind is null or p_kind not in ('event', 'gift', 'moments', 'code', 'promo') then
    raise exception 'bad_test' using errcode = 'P0001';
  end if;
  -- At most one test every 3 seconds (the overlay picks up one per poll).
  update private.state_parts
    set version = version + 1, updated_at = now(),
        data = jsonb_build_object('kind', p_kind, 'at', now(), 'by', private.me_login())
    where part = 'otest' and updated_at < now() - interval '3 seconds';
  if not found then
    raise exception 'too_fast' using errcode = 'P0001';
  end if;
end; $$;

revoke all on function public.mod_overlay_test(text) from public, anon;
grant execute on function public.mod_overlay_test(text) to authenticated;
