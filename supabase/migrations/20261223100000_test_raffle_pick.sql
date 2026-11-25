-- «Mod test» as a simulation (owner, 25 Nov 2026: «I can do the real thing in the console»): the
-- SIMULARE box on each raffle card sends fake channel point entries to that raffle, on stream or not.
-- mod_test_crowd('raffle_enter', {n, raffle}) takes the raffle id; without it, the raffle on stream.

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
    -- A chosen raffle (the SIMULARE box on its card), else the one on stream.
    if p ? 'raffle' and nullif(p ->> 'raffle', '') is not null then
      select * into r from public.raffles where id = (p ->> 'raffle')::bigint;
      if not found then raise exception 'raffle_missing' using errcode = 'P0001'; end if;
      if r.ended_at is not null then raise exception 'raffle_ended' using errcode = 'P0001'; end if;
    else
      select * into r from public.raffles where on_stream and ended_at is null limit 1;
      if not found then raise exception 'raffle_none_on_stream' using errcode = 'P0001'; end if;
    end if;
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

