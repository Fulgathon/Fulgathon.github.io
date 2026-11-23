-- Fixes from the 23 Nov 2026 test pass (docs/BUGS.md). NOT applied yet: apply
-- only with the owner's OK. Every function keeps its signature, so existing
-- grants stay as they are.
--
--   B-01  Clip links: challenges.clip_url must be https (goals and Advent days
--         already are), so a javascript: link can't reach viewers' pages.
--   B-02  claim_code: two requests at the same moment gave two bonus spins for
--         one code. The claim row now decides: no new row, no spin.
--   B-07  Ora dublă no longer doubles a moderator's manual «+10 min».
--   B-12  suggest: parallel requests could pass the "3 per 10 minutes" limit.
--   B-13  freeze_timer: an empty or negative duration emptied ends_at (the
--         clock then showed "--" and no event could add time again).
--   B-16  community_goals: anon/authenticated had every table privilege
--         (RLS blocked writes, but TRUNCATE ignores RLS). Read only now.

-- B-01 -----------------------------------------------------------------------
alter table public.challenges
  add constraint challenges_clip_https check (clip_url is null or clip_url ~ '^https://');

create or replace function public.mod_set_challenge(p_id integer, p_status text, p_scheduled_for text default null, p_clip text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  if nullif(btrim(coalesce(p_clip, '')), '') is not null and btrim(p_clip) !~ '^https://' then
    raise exception 'bad_clip' using errcode = 'P0001';
  end if;
  update public.challenges set
    status = p_status,
    scheduled_for = coalesce(p_scheduled_for, scheduled_for),
    clip_url = coalesce(nullif(btrim(coalesce(p_clip, '')), ''), clip_url),
    done_at = case when p_status = 'done' then coalesce(done_at, now()) else null end
  where id = p_id;
end; $$;

-- B-02 -----------------------------------------------------------------------
create or replace function public.claim_code(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  norm text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.secret_codes%rowtype;
  claimed integer;
  left_spins integer;
begin
  if me is null or not exists (select 1 from public.viewers v where v.id = me) then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  -- One claim at a time per viewer: the attempt limit can't be raced either.
  perform pg_advisory_xact_lock(hashtext('claim:' || me::text));
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
  -- The primary key (code_id, viewer_id) decides: only the request that adds the row gets the spin.
  insert into public.code_claims (code_id, viewer_id) values (c.id, me) on conflict do nothing;
  get diagnostics claimed = row_count;
  if claimed = 0 then
    return jsonb_build_object('error', 'already_claimed');
  end if;
  update public.viewers set bonus_spins = bonus_spins + 1 where id = me returning bonus_spins into left_spins;
  return jsonb_build_object('sponsor', c.sponsor, 'bonus_spins', left_spins);
end; $$;

-- B-07 -----------------------------------------------------------------------
-- Same as 20261123120000_marathon_rules.sql, except that manual time is never doubled.
create or replace function public.record_event(
  p_source       text,
  p_kind         text,
  p_external_id  text    default null,
  p_user_id      text    default null,
  p_user_login   text    default null,
  p_user_name    text    default null,
  p_tier         text    default null,
  p_quantity     numeric default 1,
  p_currency     text    default null,
  p_seconds      integer default null
)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  t         public.timer%rowtype;
  r         public.rates%rowtype;
  ev        public.events%rowtype;
  rate_key  text;
  secs      integer := 0;
  doubled   boolean := false;
begin
  select * into t from public.timer where id = 1 for update;

  if p_external_id is not null then
    select * into ev from public.events where external_id = p_external_id;
    if found then
      return ev;
    end if;
  end if;

  if p_kind = 'manual' then
    secs := coalesce(p_seconds, 0);
  else
    rate_key := case
      when p_kind in ('sub', 'resub') then
        case coalesce(p_tier, '1000') when '2000' then 'tier2' when '3000' then 'tier3' else 'tier1' end
      when p_kind in ('gift', 'bits', 'donation') then p_kind
    end;
    select * into r from public.rates where key = rate_key;
    if found then
      secs := floor(coalesce(p_quantity, 0) / r.per * r.seconds);
    end if;
  end if;

  if t.status <> 'live' or t.ends_at is null then
    secs := 0;
  elsif secs > 0 and p_kind <> 'manual' and now() >= t.double_from and now() < t.double_until then
    secs := secs * 2;
    doubled := true;
  end if;

  if secs <> 0 then
    update public.timer
      set ends_at = ends_at + make_interval(secs => secs), updated_at = now()
      where id = 1;
  end if;

  update public.stats set
    subs = subs + case
      when p_kind in ('sub', 'resub') then 1
      when p_kind = 'gift' then floor(coalesce(p_quantity, 0))::integer
      else 0 end,
    bits = bits + case when p_kind = 'bits' then floor(coalesce(p_quantity, 0))::integer else 0 end,
    raised = raised + case when p_kind = 'donation' then coalesce(p_quantity, 0) else 0 end,
    updated_at = now()
  where id = 1;

  -- Milestone Maraton: unlocked by the donation total (euros).
  update public.goals
    set unlocked_at = now()
    where unlocked_at is null
      and threshold <= (select s.raised from public.stats s where s.id = 1);

  insert into public.events (source, kind, external_id, user_id, user_login, user_name, tier, quantity, currency, seconds_added, doubled)
  values (p_source, p_kind, p_external_id, p_user_id, lower(p_user_login), p_user_name, p_tier, coalesce(p_quantity, 1), p_currency, secs, doubled)
  returning * into ev;

  return ev;
end;
$$;

-- B-12 -----------------------------------------------------------------------
create or replace function public.suggest(p_body text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  me      public.viewers%rowtype;
  recent  integer;
  new_id  bigint;
begin
  select * into me from public.viewers where id = (select auth.uid());
  if not found then
    raise exception 'not_logged_in' using errcode = '28000';
  end if;
  if not me.is_subscriber then
    raise exception 'not_subscribed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('suggest:' || me.id::text));
  select count(*) into recent from public.suggestions
    where viewer_id = me.id and created_at > now() - interval '10 minutes';
  if recent >= 3 then
    raise exception 'too_many' using errcode = 'P0001';
  end if;
  insert into public.suggestions (viewer_id, body) values (me.id, btrim(p_body))
    returning id into new_id;
  return new_id;
end; $$;

-- B-13 -----------------------------------------------------------------------
create or replace function public.freeze_timer(p_seconds integer default 300)
returns public.timer language plpgsql security definer set search_path = '' as $$
declare
  t public.timer%rowtype;
begin
  if p_seconds is null or p_seconds <= 0 then
    raise exception 'bad_minutes' using errcode = 'P0001';
  end if;
  select * into t from public.timer where id = 1 for update;
  if t.status <> 'live' then
    raise exception 'timer is not live';
  end if;
  update public.timer set
    ends_at = ends_at + make_interval(secs => p_seconds),
    paused_until = greatest(coalesce(paused_until, now()), now()) + make_interval(secs => p_seconds),
    updated_at = now()
  where id = 1
  returning * into t;
  return t;
end; $$;

-- B-16 -----------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on public.community_goals from anon, authenticated;
