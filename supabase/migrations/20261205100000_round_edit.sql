-- Full edit of «Runda de vot» on /mod (owner, 24 Nov 2026): change, remove or add entries,
-- also while a round is open, and write a brand-new challenge into the list.
--   * remove: the entry and only its votes go (those voters can vote again); at least 2 stay.
--   * add: another challenge from the pool joins with 0 votes; at most 8 entries.
--   * replace: one entry swapped for another, in the same place; its votes reset.
-- The site follows within seconds (round_challenges / challenges already refresh 'vote').

create or replace function public.mod_round_edit(p_round integer, p_action text, p_challenge integer default null, p_new integer default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rnd public.vote_rounds%rowtype;
  n integer;
  pos smallint;
begin
  perform private.require_moderator();
  select * into rnd from public.vote_rounds where id = p_round for update;   -- same lock as cast_vote
  if not found or now() >= rnd.closes_at or rnd.winner_id is not null then
    raise exception 'round_closed' using errcode = 'P0001';
  end if;
  select count(*) into n from public.round_challenges where round_id = p_round;
  if p_action in ('remove', 'replace') and not exists (select 1 from public.round_challenges where round_id = p_round and challenge_id = p_challenge) then
    raise exception 'not_in_round' using errcode = 'P0001';
  end if;
  if p_action in ('add', 'replace') then
    if not exists (select 1 from public.challenges where id = p_new and status = 'pool' and votable) then
      raise exception 'challenge_unavailable' using errcode = 'P0001';
    end if;
  end if;
  case p_action
    when 'remove' then
      if n <= 2 then raise exception 'need_two_challenges' using errcode = 'P0001'; end if;
      delete from public.round_challenges where round_id = p_round and challenge_id = p_challenge;   -- its votes go with it
      update public.challenges set status = 'pool' where id = p_challenge and status = 'in_round';
    when 'add' then
      if n >= 8 then raise exception 'round_full' using errcode = 'P0001'; end if;
      insert into public.round_challenges (round_id, challenge_id, position)
        values (p_round, p_new, (select coalesce(max(position), 0) + 1 from public.round_challenges where round_id = p_round));
      update public.challenges set status = 'in_round' where id = p_new;
    when 'replace' then
      select position into pos from public.round_challenges where round_id = p_round and challenge_id = p_challenge;
      delete from public.round_challenges where round_id = p_round and challenge_id = p_challenge;
      insert into public.round_challenges (round_id, challenge_id, position) values (p_round, p_new, pos);
      update public.challenges set status = 'pool' where id = p_challenge and status = 'in_round';
      update public.challenges set status = 'in_round' where id = p_new;
    else
      raise exception 'bad_action' using errcode = 'P0001';
  end case;
end; $$;

-- A new challenge written by a moderator, straight into the pool (votable).
create or replace function public.mod_challenge_add(p_title text, p_level text default 'mediu')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t text := left(btrim(coalesce(p_title, '')), 140);
  cid integer;
begin
  perform private.require_moderator();
  if t = '' then raise exception 'challenge_title' using errcode = 'P0001'; end if;
  if p_level not in ('ușor', 'mediu', 'greu') then raise exception 'bad_level' using errcode = 'P0001'; end if;
  if exists (select 1 from public.challenges where lower(btrim(title)) = lower(t) and status in ('pool', 'in_round', 'scheduled')) then
    raise exception 'challenge_exists' using errcode = 'P0001';
  end if;
  insert into public.challenges (id, category, category_name, title, how, level, votable)
    values ((select coalesce(max(id), 0) + 1 from public.challenges), 'moderatori', 'Adăugate de moderatori', t, t, p_level, true)
    returning id into cid;
  return cid;
end; $$;

revoke all on function public.mod_round_edit(integer, text, integer, integer), public.mod_challenge_add(text, text) from public, anon;
grant execute on function public.mod_round_edit(integer, text, integer, integer), public.mod_challenge_add(text, text) to authenticated;
