-- claim_code: a raised error rolled back the attempt record, so the 6-per-minute
-- limit never counted wrong guesses. Wrong / repeated codes now return
-- {"error": "..."} instead of raising, so the attempt is kept.
create or replace function public.claim_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.secret_codes%rowtype;
  left_spins integer;
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if (select count(*) from public.code_attempts a where a.viewer_id = me and a.at > now() - interval '1 minute') >= 6 then
    raise exception 'too_many_attempts' using errcode = 'P0001';
  end if;
  insert into public.code_attempts (viewer_id) values (me);
  delete from public.code_attempts where at < now() - interval '1 day';
  select * into c from public.secret_codes s
    where replace(s.code, '-', '') = norm and s.shown_at <= now() and s.expires_at > now();
  if not found then
    return jsonb_build_object('error', 'bad_code');
  end if;
  if exists (select 1 from public.code_claims k where k.code_id = c.id and k.viewer_id = me) then
    return jsonb_build_object('error', 'already_claimed');
  end if;
  insert into public.code_claims (code_id, viewer_id) values (c.id, me) on conflict do nothing;
  update public.viewers set bonus_spins = bonus_spins + 1 where id = me returning bonus_spins into left_spins;
  return jsonb_build_object('sponsor', c.sponsor, 'bonus_spins', left_spins);
end; $$;
