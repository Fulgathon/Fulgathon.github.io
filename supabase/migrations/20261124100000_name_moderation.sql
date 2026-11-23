-- Names shown in public (site, overlay, leaderboards) go through one filter:
--   * a viewer can opt out (shown as "Anonim");
--   * moderators can hide a name, or allow one the filter caught by mistake;
--   * names with slurs, links, e-mails or phone numbers are shown as "Anonim".
-- Nothing is deleted: the totals still count, only the public name changes.

create table private.name_rules (
  key        text primary key,                          -- lower(login) or lower(donor name)
  rule       text not null check (rule in ('hide', 'allow', 'opt_out')),
  set_by     uuid,
  created_at timestamptz not null default now()
);

-- Words that hide a name. token_only: only when a word part of the name starts
-- with it (avoids hiding innocent names that merely contain the letters).
create table private.blocked_words (
  word       text primary key,
  token_only boolean not null default false
);
insert into private.blocked_words (word, token_only) values
  ('nigg', false), ('fagg', false), ('pizd', false), ('futut', false), ('curva', false), ('bulangiu', false),
  ('poponar', false), ('retard', false), ('whore', false), ('porn', false), ('hitler', false), ('fuck', false),
  ('shit', false), ('bitch', false), ('muist', false), ('sugipula', false), ('handicapat', false),
  ('pula', true), ('pule', true), ('muie', true), ('fut', true), ('futu', true), ('coaie', true), ('cacat', true),
  ('tigan', true), ('cur', true), ('sex', true), ('cunt', true), ('nazi', true), ('kys', true), ('slut', true),
  ('rape', true), ('dick', true), ('cock', true), ('jidan', true);

-- Lower case, Romanian letters and common look-alikes folded to plain letters.
create or replace function private.name_fold(p text)
returns text language sql immutable set search_path = '' as $$
  select translate(lower(coalesce(p, '')), 'ăâîșțşţ013457@$!|', 'aaiststoieastasii');
$$;

create or replace function public.name_blocked(p text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  folded  text := private.name_fold(p);
  compact text := regexp_replace(folded, '[^a-z]', '', 'g');
  tokens  text[];
begin
  if p is null or btrim(p) = '' then return false; end if;
  -- links, e-mails, phone numbers
  if lower(p) ~ '(https?:|www\.|[a-z0-9-]\.(com|ro|net|org|gg|tv|io|xyz|ru|eu|me|ly|link)(\W|$)|@[a-z0-9-]+\.)'
     or regexp_replace(p, '[\s.\-()]', '', 'g') ~ '\d{8,}' then
    return true;
  end if;
  -- word parts: split camelCase and anything that isn't a letter
  tokens := regexp_split_to_array(private.name_fold(regexp_replace(p, '([a-z])([A-Z])', '\1 \2', 'g')), '[^a-z]+');
  return exists (
    select 1 from private.blocked_words w
    where (not w.token_only and position(w.word in compact) > 0)
       or (w.token_only and exists (select 1 from unnest(tokens) t where t <> '' and t like w.word || '%'))
  );
end; $$;

-- The name to show for a login and/or a display name (donors have only a name).
create or replace function public.public_name(p_login text, p_name text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  shown text := nullif(btrim(coalesce(p_name, '')), '');
  r     text;
begin
  shown := coalesce(shown, nullif(btrim(coalesce(p_login, '')), ''));
  if shown is null or lower(shown) in ('anonim', 'anonymous', 'anonyme') then return 'Anonim'; end if;
  select rule into r from private.name_rules
    where key in (lower(btrim(coalesce(p_login, ''))), lower(btrim(coalesce(p_name, ''))))
    order by case rule when 'opt_out' then 0 when 'hide' then 1 else 2 end
    limit 1;
  if r in ('hide', 'opt_out') then return 'Anonim'; end if;
  if r = 'allow' then return left(shown, 25); end if;
  if public.name_blocked(shown) or public.name_blocked(p_login) then return 'Anonim'; end if;
  return left(shown, 25);
end; $$;

-- A logged-in viewer chooses whether their name appears in public.
create or replace function public.set_public_name(p_public boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v public.viewers%rowtype;
begin
  select * into v from public.viewers where id = auth.uid();
  if not found then raise exception 'not_logged_in'; end if;
  if p_public then
    delete from private.name_rules where key = lower(v.login) and rule = 'opt_out';
  else
    insert into private.name_rules (key, rule, set_by) values (lower(v.login), 'opt_out', v.id)
      on conflict (key) do update set rule = 'opt_out', set_by = excluded.set_by, created_at = now();
  end if;
  return p_public;
end; $$;

-- Moderators: hide a name, allow one the filter caught, or clear the rule.
create or replace function public.mod_name_rule(p_name text, p_rule text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  k text := lower(btrim(coalesce(p_name, '')));
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  if k = '' then raise exception 'empty_name'; end if;
  if p_rule is null then
    delete from private.name_rules where key = k and rule <> 'opt_out';
  elsif p_rule in ('hide', 'allow') then
    insert into private.name_rules (key, rule, set_by) values (k, p_rule, auth.uid())
      on conflict (key) do update set rule = excluded.rule, set_by = excluded.set_by, created_at = now()
      where private.name_rules.rule <> 'opt_out';  -- a viewer's own opt-out always wins
  else
    raise exception 'bad_rule';
  end if;
end; $$;

-- Moderators: names the filter hides (to allow by mistake) and the rules set.
create or replace function public.mod_names()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'not_moderator'; end if;
  return jsonb_build_object(
    'filtered', coalesce((
      select jsonb_agg(n order by n) from (
        select distinct coalesce(nullif(user_name, ''), user_login) as n
        from public.events
        where coalesce(nullif(user_name, ''), user_login) is not null
          and (public.name_blocked(user_name) or public.name_blocked(user_login))
          and lower(coalesce(user_login, user_name)) not in (select key from private.name_rules)
        limit 200) x), '[]'::jsonb),
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object('name', key, 'rule', rule, 'at', created_at) order by created_at desc)
      from private.name_rules), '[]'::jsonb)
  );
end; $$;

revoke all on function public.name_blocked(text), public.public_name(text, text), public.set_public_name(boolean),
  public.mod_name_rule(text, text), public.mod_names() from public, anon, authenticated;
grant execute on function public.set_public_name(boolean), public.mod_name_rule(text, text), public.mod_names() to authenticated;
