-- Fix: `login = any ((select array))` compared text with text[] and made every
-- new login fail. Read the moderator list into a variable first.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  login text := lower(coalesce(meta ->> 'nickname', meta ->> 'preferred_username', meta ->> 'user_name', meta ->> 'name'));
  mods  text[];
begin
  select s.moderator_logins into mods from private.settings s where s.id = 1;
  insert into public.viewers (id, twitch_id, login, display_name, is_moderator)
  values (
    new.id,
    coalesce(meta ->> 'provider_id', meta ->> 'sub'),
    login,
    coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'nickname'),
    coalesce(login = any (coalesce(mods, '{}'::text[])), false)
  )
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
