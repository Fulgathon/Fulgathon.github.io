-- «Donează și alegi» (owner, 24 Nov 2026), for the OBS scene «Camera de control» (/overlay/?scene=control):
-- a fixed price list. One person donates EXACTLY a listed amount and that task goes into a queue
-- with their name; moderators tick it on /mod when Iceman has done it. It is not a goal that fills up:
-- other amounts add time as usual but start no task.
--   * public.donation_tasks: the list (price € + title), edited on /mod (AZI → Donează și alegi).
--     Owner's first list: 5 € Alege linia, 10 € Alege un campion, 25 € Alege 3 campioni, 50 € Joacă cu o mână.
--   * public.donation_task_queue: one row per matching donation event (EUR, while the marathon is live,
--     the same donations that add time), filled by a trigger on public.events; done_at when ticked.
--   * Part 'tasks' (public_state): the list and the pending queue for the overlay and /mod.
--   * A Discord alert for each new request (marked TEST during «Mod test»).
-- Both tables are copied and restored by «Mod test» automatically.

create table public.donation_tasks (
  id         serial primary key,
  price      numeric(10, 2) not null check (price > 0 and price <= 10000),
  title      text not null check (char_length(btrim(title)) between 1 and 60),
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  unique (price)
);
create table public.donation_task_queue (
  id         bigserial primary key,
  event_id   bigint unique references public.events (id) on delete cascade,
  price      numeric(10, 2) not null,
  title      text not null,
  user_login text,
  user_name  text,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  done_by    text
);
create index donation_task_queue_pending on public.donation_task_queue (id) where done_at is null;
alter table public.donation_tasks enable row level security;
alter table public.donation_task_queue enable row level security;
revoke all on public.donation_tasks, public.donation_task_queue from anon, authenticated;

insert into public.donation_tasks (price, title, position) values
  (5, 'Alege linia', 1), (10, 'Alege un campion', 2), (25, 'Alege 3 campioni', 3), (50, 'Joacă cu o mână', 4);

insert into private.state_parts (part, version, data) values ('tasks', 0, 'null'::jsonb)
  on conflict (part) do nothing;

-- A donation of exactly a listed amount (euros, counted while live) becomes a request.
create or replace function private.donation_task_from_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.donation_tasks%rowtype;
  who text;
begin
  if new.kind <> 'donation' or upper(coalesce(new.currency, 'EUR')) <> 'EUR'
     or (select status from public.timer where id = 1) <> 'live' then
    return null;
  end if;
  select * into t from public.donation_tasks where price = new.quantity;
  if not found then return null; end if;
  insert into public.donation_task_queue (event_id, price, title, user_login, user_name)
    values (new.id, t.price, t.title, new.user_login, new.user_name)
    on conflict (event_id) do nothing;
  if found then
    who := coalesce(public.public_name(new.user_login, new.user_name), 'Anonim');
    perform private.alert('task', format('Donează și alegi: %s a ales «%s» (%s €). Bifați pe /mod când Iceman a făcut-o.',
      who, t.title, trim(trailing '.' from trim(trailing '0' from t.price::text))));
  end if;
  return null;
end; $$;
create trigger events_donation_task after insert on public.events
  for each row execute function private.donation_task_from_event();

create trigger state_tasks_l after insert or update or delete on public.donation_tasks
  for each statement execute function private.on_state_change('tasks');
create trigger state_tasks_q after insert or update or delete on public.donation_task_queue
  for each statement execute function private.on_state_change('tasks');

-- Part 'tasks': the list + the pending requests (oldest first) with public names.
alter function private.compute_part(text) rename to compute_part_v4;
create function private.compute_part(p_part text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_part = 'tasks' then
    return jsonb_build_object(
      'menu', coalesce((select jsonb_agg(jsonb_build_object('price', t.price, 'title', t.title) order by t.position, t.price)
                        from public.donation_tasks t), '[]'::jsonb),
      'queue', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'price', q.price, 'title', q.title,
                           'name', coalesce(public.public_name(q.user_login, q.user_name), 'Anonim'), 'at', q.created_at) order by q.id)
                         from (select * from public.donation_task_queue where done_at is null order by id limit 40) q), '[]'::jsonb),
      'pending', (select count(*) from public.donation_task_queue where done_at is null));
  end if;
  return private.compute_part_v4(p_part);
end; $$;
revoke all on function private.compute_part(text), private.compute_part_v4(text), private.donation_task_from_event() from public, anon, authenticated;

-- /mod: replace the list ([{price, title}], at most 8, distinct prices).
create or replace function public.mod_tasks_set(p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  perform private.require_moderator();
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 8 then
    raise exception 'bad_tasks' using errcode = 'P0001';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where (e ->> 'price') is null or (e ->> 'price') !~ '^\d+([.,]\d{1,2})?$'
                or replace(e ->> 'price', ',', '.')::numeric <= 0 or replace(e ->> 'price', ',', '.')::numeric > 10000
                or char_length(btrim(coalesce(e ->> 'title', ''))) not between 1 and 60) then
    raise exception 'bad_tasks' using errcode = 'P0001';
  end if;
  select count(*) - count(distinct replace(e ->> 'price', ',', '.')::numeric) into n from jsonb_array_elements(p_items) e;
  if n > 0 then raise exception 'duplicate_price' using errcode = 'P0001'; end if;
  delete from public.donation_tasks where id is not null;
  insert into public.donation_tasks (price, title, position)
    select replace(e ->> 'price', ',', '.')::numeric, btrim(e ->> 'title'), o::integer
    from jsonb_array_elements(p_items) with ordinality as x (e, o);
end; $$;

-- /mod: «Făcută» (or undo).
create or replace function public.mod_task_done(p_id bigint, p_done boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  update public.donation_task_queue
    set done_at = case when p_done then coalesce(done_at, now()) end,
        done_by = case when p_done then coalesce(done_by, private.me_login()) end
    where id = p_id;
  if not found then raise exception 'no_task' using errcode = 'P0001'; end if;
end; $$;

revoke all on function public.mod_tasks_set(jsonb), public.mod_task_done(bigint, boolean) from public, anon;
grant execute on function public.mod_tasks_set(jsonb), public.mod_task_done(bigint, boolean) to authenticated;

select private.refresh_parts(array['tasks']);
