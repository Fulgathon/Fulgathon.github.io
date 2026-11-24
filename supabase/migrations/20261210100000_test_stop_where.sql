-- «Oprește testul» / «De la capăt» failed on /mod with «DELETE requires a WHERE clause»: Supabase's
-- pg_safeupdate refuses DELETE/UPDATE without WHERE on API (PostgREST) calls, and
-- private.test_restore_data emptied private.test_fakes with a bare DELETE (the cron end at «until»
-- was not affected). Same function, only that line changed: the list of fake viewers is emptied with «where true».

create or replace function private.test_restore_data(p_tables text[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  t text;
  todo text[] := p_tables;
  ready text[];
  cols text;
  real_online boolean := (select stream_online from public.timer where id = 1);
  s private.test_session%rowtype;
begin
  select * into s from private.test_session where id = 1;
  if cardinality(p_tables) = 0 then return; end if;
  foreach t in array p_tables loop
    if to_regclass(t) is null or to_regclass('test_backup.' || replace(t, '.', '__')) is null then
      raise exception 'test_backup_missing %', t using errcode = 'P0001';
    end if;
  end loop;
  foreach t in array p_tables loop execute format('alter table %s disable trigger user', t); end loop;
  execute 'truncate ' || (select string_agg(x, ', ') from unnest(p_tables) x);
  -- Parents before children (foreign keys).
  while cardinality(todo) > 0 loop
    select coalesce(array_agg(x), '{}') into ready from unnest(todo) x
      where not exists (
        select 1 from pg_constraint c
        where c.contype = 'f' and c.conrelid = to_regclass(x) and c.confrelid <> c.conrelid
          and (c.confrelid::regclass::text) = any (todo));
    if cardinality(ready) = 0 then raise exception 'test_restore_cycle' using errcode = 'P0001'; end if;
    foreach t in array ready loop
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
        from pg_attribute a
        where a.attrelid = to_regclass(t) and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
          and exists (select 1 from pg_attribute b
                      where b.attrelid = to_regclass('test_backup.' || replace(t, '.', '__'))
                        and b.attname = a.attname and not b.attisdropped);
      if cols is not null then
        execute format('insert into %s (%s) overriding system value select %s from test_backup.%I',
                       t, cols, cols, replace(t, '.', '__'));
      end if;
    end loop;
    todo := array(select x from unnest(todo) x where not (x = any (ready)));
  end loop;
  foreach t in array p_tables loop execute format('alter table %s enable trigger user', t); end loop;

  -- Viewers keep their accounts; what the test changed about them goes back.
  update public.viewers v set is_subscriber = g.is_subscriber, sub_tier = g.sub_tier,
    sub_checked_at = g.sub_checked_at, bonus_spins = g.bonus_spins
    from test_backup.viewers_game g where g.id = v.id;
  update public.viewers v set is_subscriber = false, sub_tier = null, sub_checked_at = null, bonus_spins = 0
    where not exists (select 1 from test_backup.viewers_game g where g.id = v.id);
  delete from auth.users where id in (select id from private.test_fakes);
  delete from private.test_fakes where true;  -- every fake: pg_safeupdate needs a WHERE

  -- LIVE on Twitch: the real flag, unless the test switched it by hand.
  update public.timer set stream_online = case when s.stream_forced then coalesce(s.stream_online, false) else real_online end
    where id = 1;
  -- The public state as it was (version bumped so every page fetches it), then the live parts fresh.
  update private.state_parts p set version = p.version + 1, data = c.data, updated_at = now()
    from test_backup.state_parts_copy c
    where c.part = p.part and p.part not in ('test', 'rehearsal', 'otest') and p.data is distinct from c.data;
  update private.state_parts set version = version + 1, data = 'null'::jsonb, updated_at = now()
    where part in ('rehearsal', 'otest') and data is distinct from 'null'::jsonb;
  perform private.refresh_parts(array['timer', 'vote']);
end; $$;

revoke all on function private.test_restore_data(text[]) from public, anon, authenticated;
