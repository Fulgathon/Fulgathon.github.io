-- Vote rounds by level, 24 hours long (owner, 25 Nov 2026).
--   * No more 2 easy / 2 medium / 1 hard: a round is 5 challenges of ONE level (ușor, mediu or greu).
--     Moderators pick the level on /mod for a round they open by hand; the daily auto round uses
--     private.autopilot.vote_level (set on /mod → ACTIVITĂȚI → Vot → Votul automat).
--   * A round lasts 24 hours by default (up to 48 h); the auto round's length is vote_minutes.
--   * pick_round(): 5 of that level, different categories first, then any category of that level. Fewer
--     than 5 of that level left → fewer returned, and the auto round doesn't open (round_of_five).

alter table private.autopilot add column if not exists vote_level text not null default 'mediu'
  check (vote_level in ('ușor', 'mediu', 'greu'));
alter table private.autopilot drop constraint if exists autopilot_vote_minutes_check;
alter table private.autopilot add constraint autopilot_vote_minutes_check check (vote_minutes between 10 and 2880);
alter table private.autopilot alter column vote_minutes set default 1440;
update private.autopilot set vote_minutes = 1440 where id = 1 and vote_minutes <= 720;

create or replace function private.pick_round()
returns integer[] language plpgsql volatile security definer set search_path = '' as $$
declare
  lv     text := coalesce((select a.vote_level from private.autopilot a where a.id = 1), 'mediu');
  picked integer[] := '{}';
  cats   text[] := '{}';
  c      record;
begin
  for c in
    select id, category from public.challenges
    where status = 'pool' and votable and level = lv
    order by random()
  loop
    exit when cardinality(picked) >= 5;
    if not (c.category = any (cats)) then
      picked := picked || c.id;
      cats := cats || c.category;
    end if;
  end loop;
  if cardinality(picked) < 5 then
    for c in
      select id from public.challenges
      where status = 'pool' and votable and level = lv and not (id = any (picked))
      order by random()
    loop
      exit when cardinality(picked) >= 5;
      picked := picked || c.id;
    end loop;
  end if;
  return picked;
end; $$;
revoke execute on function private.pick_round() from public, anon, authenticated;

create or replace function public.mod_autopilot()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a private.autopilot%rowtype;
begin
  perform private.require_moderator();
  select * into a from private.autopilot where id = 1;
  return jsonb_build_object(
    'autoStart', a.auto_start, 'startHours', a.start_hours,
    'voteOn', a.vote_on, 'voteAt', to_char(a.vote_at, 'HH24:MI'), 'voteMinutes', a.vote_minutes, 'voteLevel', a.vote_level,
    'lastVoteDay', a.last_vote_day,
    'hasWebhook', a.discord_webhook is not null,
    'updatedAt', a.updated_at, 'updatedBy', a.updated_by,
    'plan', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'kind', p.kind, 'at', p.at, 'minutes', p.minutes,
        'until', p.until_at, 'sponsor', p.sponsor, 'by', p.created_by, 'done', p.done_at, 'result', p.result) order by p.at)
      from (select * from private.plan where done_at is null or done_at > now() - interval '2 days') p), '[]'::jsonb),
    'checklist', coalesce((select jsonb_object_agg(c.key, jsonb_build_object('by', c.done_by, 'at', c.done_at)) from private.mod_checklist c), '{}'::jsonb)
  );
end; $$;

create or replace function public.mod_autopilot_set(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  hook text;
begin
  perform private.require_moderator();
  if p ? 'autoStart'
     and (p ->> 'autoStart')::boolean is distinct from (select a.auto_start from private.autopilot a where a.id = 1)
     and not private.is_broadcaster() then
    raise exception 'only_broadcaster' using errcode = '42501';
  end if;
  if p ? 'discordWebhook' then
    hook := nullif(btrim(coalesce(p ->> 'discordWebhook', '')), '');
    if hook is not null and hook !~ '^https://(discord\.com|discordapp\.com|canary\.discord\.com)/api/webhooks/[0-9]+/[A-Za-z0-9_-]+$' then
      raise exception 'bad_webhook' using errcode = 'P0001';
    end if;
  end if;
  update private.autopilot set
    auto_start   = coalesce((p ->> 'autoStart')::boolean, auto_start),
    start_hours  = coalesce((p ->> 'startHours')::numeric, start_hours),
    vote_on      = coalesce((p ->> 'voteOn')::boolean, vote_on),
    vote_at      = coalesce((p ->> 'voteAt')::time, vote_at),
    vote_minutes = coalesce((p ->> 'voteMinutes')::integer, vote_minutes),
    vote_level   = coalesce(p ->> 'voteLevel', vote_level),
    discord_webhook = case when p ? 'discordWebhook' then hook else discord_webhook end,
    updated_at = now(), updated_by = private.me_login()
  where id = 1;
exception
  when check_violation then raise exception 'bad_autopilot' using errcode = 'P0001';
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then raise exception 'bad_autopilot' using errcode = 'P0001';
end; $$;

-- A round opened by hand: at most 48 hours.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.mod_open_round(integer[],integer)'::regprocedure);
  if position('raise exception ''round_needs_five''' in d) = 0 then raise exception 'mod_open_round: unexpected body'; end if;
  execute replace(d, '  insert into public.vote_rounds (number, opens_at, closes_at)',
    '  if coalesce(p_minutes, 0) not between 10 and 2880 then raise exception ''bad_round_length'' using errcode = ''P0001''; end if;
  insert into public.vote_rounds (number, opens_at, closes_at)');
end $$;
