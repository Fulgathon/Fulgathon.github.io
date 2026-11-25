-- «Mod test» can fill every list (owner, 25 Nov 2026: «how can we simulate how those will be when we
-- have viewers on lists?»), plus a live fix for the raffle piece.
--
-- 1. mod_test_crowd(action, p), during a test only:
--    'crowd'        n (1–100) new fake viewers, as mod_test 'crowd', then the raffle piece updates at once;
--    'raffle_enter' n (1–100) fake viewers enter the points raffle on stream, as if they had used their
--                   channel points (new fake viewers are made when every existing one is already in);
--    'act'          the fake viewers already there vote in the open round and pick a bingo line while
--                   bingo is open (test_crowd only does that for the ones it creates).
-- 2. Part 'raffle' for the other rules (everyone / subscribers / N hours) was computed only when a
--    raffle row changed, so the count and the names on stream fell behind as people logged in and
--    watched. It is now also checked every minute, and its 80 names are a fixed pick (not random each
--    time), so the piece only changes when the list really does.

create or replace function private.raffle_part()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.raffles%rowtype;
  d public.raffle_draws%rowtype;
  b text := (select lower(btrim(s.broadcaster_login)) from private.settings s where s.id = 1);
begin
  select * into r from public.raffles where on_stream and ended_at is null limit 1;
  if not found then return null; end if;
  select * into d from public.raffle_draws where raffle_id = r.id order by id desc limit 1;
  return jsonb_build_object(
    'id', r.id, 'prize', r.prize, 'sponsor', r.sponsor, 'rule', r.rule, 'hours', r.min_hours, 'cost', r.points_cost,
    'phase', case when d.id is not null then 'drawn' when r.entries_closed_at is not null then 'closed' else 'open' end,
    'count', (select count(*) from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat)),
    'entries', case when r.rule = 'points' then coalesce((select jsonb_agg(jsonb_build_object('name', x.shown, 'at', x.created_at) order by x.created_at desc) from (
        select public.public_name(e.login, e.display_name) as shown, e.created_at from public.raffle_entries e
         where e.raffle_id = r.id and lower(coalesce(e.login, '')) is distinct from b
           and (r.include_mods or not exists (select 1 from public.viewers v where v.is_moderator and (v.twitch_id = e.twitch_id or lower(v.login) = lower(e.login))))
         order by e.created_at desc limit 150) x), '[]'::jsonb) else '[]'::jsonb end,
    -- A fixed pick of 80 (by a hash of the name): the same list gives the same names every minute.
    'sample', case when r.rule <> 'points' then coalesce((select jsonb_agg(x.shown order by x.k) from (
        select e.shown, md5(r.id::text || e.shown) as k from private.raffle_eligible(r.id, r.rule, r.min_hours, r.include_mods, r.allow_past_winners, r.allow_repeat) e
         order by 2 limit 80) x), '[]'::jsonb) else '[]'::jsonb end,
    'winners', coalesce((select jsonb_agg(coalesce(x.shown_name, public.public_name(x.login, x.login)) order by x.id) from public.raffle_draws x where x.raffle_id = r.id), '[]'::jsonb),
    'draw', case when d.id is null then null else jsonb_build_object(
      'id', d.id, 'name', coalesce(d.shown_name, public.public_name(d.login, d.login)), 'at', d.drawn_at, 'shownAt', d.shown_at,
      'entrants', d.entrants, 'total', coalesce(d.entrants_total, jsonb_array_length(d.entrants))) end);
end; $$;
revoke all on function private.raffle_part() from public, anon, authenticated;

-- Every minute: vote rounds open at their time, the clock, and now the raffle list.
select cron.schedule('icemaraton-state', '* * * * *', $$select private.refresh_parts(array['vote', 'timer', 'raffle'])$$);

create or replace function public.mod_test_crowd(p_action text, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  n integer := greatest(1, least(coalesce((p ->> 'n')::integer, 25), 100));
  r public.raffles%rowtype;
  have integer;
  room integer;
  entered integer := 0;
  voted integer := 0;
  picked integer := 0;
  rnd public.vote_rounds%rowtype;
  f record;
  ch integer;
  line integer[];
begin
  perform private.require_moderator();
  if not private.test_active() then raise exception 'test_off' using errcode = 'P0001'; end if;

  if p_action = 'crowd' then
    perform private.test_crowd(n);

  elsif p_action = 'raffle_enter' then
    select * into r from public.raffles where on_stream and ended_at is null limit 1;
    if not found then raise exception 'raffle_none_on_stream' using errcode = 'P0001'; end if;
    if r.rule <> 'points' then raise exception 'raffle_not_points' using errcode = 'P0001'; end if;
    if r.entries_closed_at is not null then raise exception 'raffle_entries_closed' using errcode = 'P0001'; end if;
    select count(*) into have from private.test_fakes tf join public.viewers v on v.id = tf.id
     where not exists (select 1 from public.raffle_entries e where e.raffle_id = r.id and e.twitch_id = v.twitch_id);
    room := 500 - (select count(*) from private.test_fakes);
    if have < n and room > 0 then perform private.test_crowd(least(n - have, room)); end if;
    -- One at a time, a moment apart, so they arrive in order like real channel point entries.
    for f in select v.twitch_id, v.login, v.display_name from private.test_fakes tf join public.viewers v on v.id = tf.id
              where not exists (select 1 from public.raffle_entries e where e.raffle_id = r.id and e.twitch_id = v.twitch_id)
              order by random() limit n loop
      insert into public.raffle_entries (raffle_id, twitch_id, login, display_name, redemption_id, created_at)
        values (r.id, f.twitch_id, f.login, f.display_name, 'test-' || gen_random_uuid()::text, clock_timestamp())
      on conflict (raffle_id, twitch_id) do nothing;
      entered := entered + 1;
    end loop;
    if entered = 0 then raise exception 'test_crowd_full' using errcode = 'P0001'; end if;

  elsif p_action = 'act' then
    select * into rnd from public.vote_rounds where now() >= coalesce(opens_at, now()) and now() < closes_at order by id desc limit 1;
    for f in select v.id, v.is_subscriber from private.test_fakes tf join public.viewers v on v.id = tf.id loop
      if f.is_subscriber and rnd.id is not null
         and not exists (select 1 from public.votes vo where vo.round_id = rnd.id and vo.viewer_id = f.id) then
        select challenge_id into ch from public.round_challenges where round_id = rnd.id order by random() limit 1;
        if ch is not null then
          insert into public.votes (round_id, viewer_id, challenge_id) values (rnd.id, f.id, ch) on conflict do nothing;
          if found then
            update public.round_challenges set votes = votes + 1 where round_id = rnd.id and challenge_id = ch;
            voted := voted + 1;
          end if;
        end if;
      end if;
      if private.bingo_phase() = 'open' and not exists (select 1 from public.bingo_picks bp where bp.viewer_id = f.id) then
        select l into line from private.bingo_lines() l order by random() limit 1;
        if line is not null then
          insert into public.bingo_picks (viewer_id, items) values (f.id, line) on conflict (viewer_id) do nothing;
          if found then picked := picked + 1; end if;
        end if;
      end if;
    end loop;

  else
    raise exception 'bad_test_action' using errcode = 'P0001';
  end if;

  -- The raffle piece reads viewers and watch time too; show the new list now, not at the next minute.
  perform private.refresh_parts(array['raffle']);
  return jsonb_build_object('entered', entered, 'voted', voted, 'picked', picked,
                            'fakes', (select count(*) from private.test_fakes),
                            'raffleEntries', (select count(*) from public.raffle_entries e where e.raffle_id = r.id));
end; $$;
revoke all on function public.mod_test_crowd(text, jsonb) from public, anon;
grant execute on function public.mod_test_crowd(text, jsonb) to authenticated;

select private.refresh_parts(array['raffle']);
