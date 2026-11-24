-- «Camera de control» background photo (owner, 24 Nov 2026): uploaded on /mod (SETĂRI → Overlay OBS) and
-- drawn by the overlay itself, with the game and webcam places cut out (transparent), so the sponsor
-- strip can be real frosted glass over the photo. Without a photo the scene stays transparent.
--   * Storage bucket 'scene': public read, moderators upload / replace / delete, 10 MB, JPG/PNG/WEBP.
--   * public.scene_settings (one row): the photo's public URL; part 'scene' carries it to the overlay.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('scene', 'scene', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do nothing;
create policy "Moderators upload scene photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'scene' and public.is_moderator());
create policy "Moderators update scene photos" on storage.objects for update to authenticated
  using (bucket_id = 'scene' and public.is_moderator());
create policy "Moderators delete scene photos" on storage.objects for delete to authenticated
  using (bucket_id = 'scene' and public.is_moderator());

create table public.scene_settings (
  id             smallint primary key default 1 check (id = 1),
  background_url text,
  updated_at     timestamptz not null default now(),
  updated_by     text
);
insert into public.scene_settings (id) values (1);
alter table public.scene_settings enable row level security;
revoke all on public.scene_settings from anon, authenticated;

insert into private.state_parts (part, version, data) values ('scene', 0, 'null'::jsonb)
  on conflict (part) do nothing;

create or replace function private.scene_publish()
returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  select jsonb_build_object('bg', s.background_url) into d from public.scene_settings s where s.id = 1;
  update private.state_parts set version = version + 1, data = coalesce(d, 'null'::jsonb), updated_at = now()
    where part = 'scene' and data is distinct from coalesce(d, 'null'::jsonb);
end; $$;

-- Only a photo from this project's 'scene' bucket (or null to remove it).
create or replace function public.mod_scene_set(p_background text)
returns void language plpgsql security definer set search_path = '' as $$
declare u text := nullif(btrim(coalesce(p_background, '')), '');
begin
  perform private.require_moderator();
  if u is not null and u !~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/scene/[A-Za-z0-9._-]+$' then
    raise exception 'bad_scene_photo' using errcode = 'P0001';
  end if;
  update public.scene_settings set background_url = u, updated_at = now(), updated_by = private.me_login() where id = 1;
  perform private.scene_publish();
end; $$;

revoke all on function private.scene_publish() from public, anon, authenticated;
revoke all on function public.mod_scene_set(text) from public, anon;
grant execute on function public.mod_scene_set(text) to authenticated;

select private.scene_publish();
