-- A vote round always has exactly 5 challenges (owner, 25 Nov 2026: «never less or more»).
--   * mod_open_round: exactly 5 different challenges from the pool.
--   * mod_round_edit: only «replace» (Schimbă) while open; adding or removing would change the count.
--   * The daily auto round opens only with 5 (private.pick_round tops up to 5 when a level runs short);
--     with fewer left in the pool it doesn't open and Discord gets the «not enough challenges» alert.

create or replace function public.mod_open_round(p_challenges integer[], p_minutes integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  rid integer;
begin
  perform private.require_moderator();
  if exists (select 1 from public.vote_rounds where now() < closes_at) then
    raise exception 'round_already_open' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_challenges, 1), 0) <> 5
     or (select count(distinct c) from unnest(p_challenges) c) <> 5 then
    raise exception 'round_needs_five' using errcode = 'P0001';
  end if;
  if (select count(*) from public.challenges where id = any (p_challenges) and status = 'pool' and votable) <> 5 then
    raise exception 'challenge_unavailable' using errcode = 'P0001';
  end if;
  insert into public.vote_rounds (number, opens_at, closes_at)
    values ((select coalesce(max(number), 0) + 1 from public.vote_rounds), now(), now() + make_interval(mins => p_minutes))
    returning id into rid;
  insert into public.round_challenges (round_id, challenge_id, position)
    select rid, c, o::smallint from unnest(p_challenges) with ordinality as t (c, o);
  update public.challenges set status = 'in_round' where id = any (p_challenges);
  return rid;
end; $$;

create or replace function public.mod_round_edit(p_round integer, p_action text, p_challenge integer default null, p_new integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rnd public.vote_rounds%rowtype;
  pos smallint;
begin
  perform private.require_moderator();
  if p_action in ('add', 'remove') then raise exception 'round_needs_five' using errcode = 'P0001'; end if;
  if p_action <> 'replace' then raise exception 'bad_action' using errcode = 'P0001'; end if;
  select * into rnd from public.vote_rounds where id = p_round for update;   -- same lock as cast_vote
  if not found or now() >= rnd.closes_at or rnd.winner_id is not null then
    raise exception 'round_closed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.round_challenges where round_id = p_round and challenge_id = p_challenge) then
    raise exception 'not_in_round' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.challenges where id = p_new and status = 'pool' and votable) then
    raise exception 'challenge_unavailable' using errcode = 'P0001';
  end if;
  select position into pos from public.round_challenges where round_id = p_round and challenge_id = p_challenge;
  delete from public.round_challenges where round_id = p_round and challenge_id = p_challenge;   -- its votes go with it
  insert into public.round_challenges (round_id, challenge_id, position) values (p_round, p_new, pos);
  update public.challenges set status = 'pool' where id = p_challenge and status = 'in_round';
  update public.challenges set status = 'in_round' where id = p_new;
end; $$;

-- The auto round: open only with 5.
do $$
declare d text;
begin
  d := pg_get_functiondef('private.autopilot_tick()'::regprocedure);
  if position('if coalesce(array_length(ids, 1), 0) >= 2 then' in d) > 0 then
    execute replace(d, 'if coalesce(array_length(ids, 1), 0) >= 2 then', 'if coalesce(array_length(ids, 1), 0) = 5 then');
  else
    raise exception 'autopilot_tick: round size check not found';
  end if;
end $$;
