-- For the /mod page: is the streamer account connected, where's the connect link.
create or replace function public.mod_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  return (
    select jsonb_build_object(
      'broadcaster_login', s.broadcaster_login,
      'broadcaster_connected', exists (select 1 from vault.secrets where name = 'twitch_broadcaster_token'),
      'connect_url', s.functions_url || '/twitch-auth',
      'moderator_logins', s.moderator_logins
    )
    from private.settings s where s.id = 1
  );
end;
$$;

revoke execute on function public.mod_status() from public, anon;
grant execute on function public.mod_status() to authenticated;
