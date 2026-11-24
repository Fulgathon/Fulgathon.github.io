-- Sponsors edited on /mod (owner, 24 Nov 2026): every field a sponsor may need to promote
-- through the marathon, instead of a code change in src/data/site.ts. The site and the overlay
-- read the public fields live (public_state part 'sponsors'); contact details and the agreement
-- notes stay private to moderators. Logos are uploaded to the public Storage bucket 'sponsors'
-- (moderators only).

create table public.sponsors (
  id            bigint generated always as identity primary key,
  tier          text not null default 'partner' check (tier in ('main', 'partner', 'supporter')),
  position      integer not null default 0,
  name          text not null check (char_length(btrim(name)) between 1 and 60),
  logo_url      text,
  role          text,          -- what they back: «Premii roată», «Ora dublă» (partners)
  description   text,          -- short pitch shown with the offer
  url           text,          -- where viewers should go
  cta           text,          -- the button: «Vezi oferta»
  utm           boolean not null default true,
  code          text,          -- discount code
  code_note     text,          -- what the code gives: «10% la periferice»
  offer_until   timestamptz,   -- the offer ends (the code hides after)
  overlay_line  text,          -- the partner line on stream
  talking_points text,         -- what Iceman says on stream (moderators only)
  socials       jsonb not null default '{}'::jsonb,   -- {instagram, tiktok, youtube, facebook, discord, website}
  show_site     boolean not null default true,
  show_overlay  boolean not null default true,
  visible_from  timestamptz,
  visible_until timestamptz,
  contact_name  text,          -- private
  contact_email text,          -- private
  contact_phone text,          -- private
  notes         text,          -- private: what was agreed
  updated_at    timestamptz not null default now(),
  updated_by    text
);
alter table public.sponsors enable row level security;  -- no policies: only through the functions below
create unique index sponsors_one_main on public.sponsors ((true)) where tier = 'main';

insert into private.state_parts (part, version, data) values ('sponsors', 0, 'null'::jsonb)
  on conflict (part) do nothing;

-- The link viewers get: with UTM tags (unless switched off) so the sponsor sees the traffic.
create or replace function private.sponsor_link(p_url text, p_utm boolean)
returns text language sql immutable as $$
  select case
    when p_url is null or btrim(p_url) = '' then null
    when not p_utm or p_url ~* '[?&]utm_source=' then p_url
    else p_url || case when position('?' in p_url) > 0 then '&' else '?' end
         || 'utm_source=icemanlucky.ro&utm_medium=subathon&utm_campaign=icemaraton'
  end;
$$;

-- Public fields only, in order. Dates travel too: the site and overlay hide a sponsor outside
-- its window themselves (no cron needed).
create or replace function private.sponsors_publish()
returns void language plpgsql security definer set search_path = '' as $$
declare d jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'tier', s.tier, 'name', s.name, 'logo', s.logo_url, 'role', s.role, 'description', s.description,
      'url', private.sponsor_link(s.url, s.utm), 'cta', s.cta, 'code', s.code, 'codeNote', s.code_note,
      'offerUntil', s.offer_until, 'overlayLine', s.overlay_line, 'socials', s.socials,
      'site', s.show_site, 'overlay', s.show_overlay, 'from', s.visible_from, 'until', s.visible_until)
    order by case s.tier when 'main' then 0 when 'partner' then 1 else 2 end, s.position, s.id), '[]'::jsonb)
    into d from public.sponsors s;
  update private.state_parts set version = version + 1, data = d, updated_at = now()
    where part = 'sponsors' and data is distinct from d;
end; $$;

create or replace function public.mod_sponsors()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  return coalesce((select jsonb_agg(to_jsonb(s) order by case s.tier when 'main' then 0 when 'partner' then 1 else 2 end, s.position, s.id)
    from public.sponsors s), '[]'::jsonb);
end; $$;

-- Text: trimmed, empty → null, at most n characters.
create or replace function private.clip(p text, n integer)
returns text language sql immutable as $$ select nullif(left(btrim(coalesce(p, '')), n), '') $$;

-- A link must be a plain web address.
create or replace function private.web_url(p text)
returns text language plpgsql immutable as $$
declare u text := private.clip(p, 500);
begin
  if u is null then return null; end if;
  if u !~* '^https?://[^\s/$.?#][^\s]*$' then raise exception 'bad_url' using errcode = 'P0001'; end if;
  return u;
end; $$;

create or replace function public.mod_sponsor_save(p jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  sid bigint := nullif(p ->> 'id', '')::bigint;
  t text := coalesce(p ->> 'tier', 'partner');
  soc jsonb := '{}'::jsonb;
  k text;
begin
  perform private.require_moderator();
  if t not in ('main', 'partner', 'supporter') then raise exception 'bad_tier' using errcode = 'P0001'; end if;
  if private.clip(p ->> 'name', 60) is null then raise exception 'sponsor_name' using errcode = 'P0001'; end if;
  if t = 'main' and exists (select 1 from public.sponsors where tier = 'main' and id is distinct from sid) then
    raise exception 'main_exists' using errcode = 'P0001';
  end if;
  foreach k in array array['website', 'instagram', 'tiktok', 'youtube', 'facebook', 'discord'] loop
    if private.web_url(p -> 'socials' ->> k) is not null then soc := soc || jsonb_build_object(k, private.web_url(p -> 'socials' ->> k)); end if;
  end loop;
  if sid is null then
    insert into public.sponsors (tier, position, name) values (t,
      coalesce((select max(position) + 1 from public.sponsors where tier = t), 0), private.clip(p ->> 'name', 60))
      returning id into sid;
  end if;
  update public.sponsors set
    tier = t,
    name = private.clip(p ->> 'name', 60),
    logo_url = private.web_url(p ->> 'logo'),
    role = private.clip(p ->> 'role', 40),
    description = private.clip(p ->> 'description', 280),
    url = private.web_url(p ->> 'url'),
    cta = private.clip(p ->> 'cta', 30),
    utm = coalesce((p ->> 'utm')::boolean, true),
    code = upper(private.clip(p ->> 'code', 30)),
    code_note = private.clip(p ->> 'codeNote', 80),
    offer_until = nullif(p ->> 'offerUntil', '')::timestamptz,
    overlay_line = private.clip(p ->> 'overlayLine', 90),
    talking_points = private.clip(p ->> 'talkingPoints', 600),
    socials = soc,
    show_site = coalesce((p ->> 'site')::boolean, true),
    show_overlay = coalesce((p ->> 'overlay')::boolean, true),
    visible_from = nullif(p ->> 'from', '')::timestamptz,
    visible_until = nullif(p ->> 'until', '')::timestamptz,
    contact_name = private.clip(p ->> 'contactName', 80),
    contact_email = private.clip(p ->> 'contactEmail', 120),
    contact_phone = private.clip(p ->> 'contactPhone', 40),
    notes = private.clip(p ->> 'notes', 1000),
    updated_at = now(), updated_by = private.me_login()
  where id = sid;
  if not found then raise exception 'sponsor_gone' using errcode = 'P0001'; end if;
  perform private.sponsors_publish();
  return sid;
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'bad_sponsor' using errcode = 'P0001';
end; $$;

create or replace function public.mod_sponsor_delete(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_moderator();
  delete from public.sponsors where id = p_id;
  perform private.sponsors_publish();
end; $$;

-- Move a sponsor one place up (-1) or down (+1) within its tier.
create or replace function public.mod_sponsor_move(p_id bigint, p_dir integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.sponsors%rowtype;
  other public.sponsors%rowtype;
begin
  perform private.require_moderator();
  select * into me from public.sponsors where id = p_id;
  if not found then raise exception 'sponsor_gone' using errcode = 'P0001'; end if;
  if p_dir < 0 then
    select * into other from public.sponsors where tier = me.tier and (position, id) < (me.position, me.id) order by position desc, id desc limit 1;
  else
    select * into other from public.sponsors where tier = me.tier and (position, id) > (me.position, me.id) order by position, id limit 1;
  end if;
  if not found then return; end if;
  -- Renumber the tier first so swapping positions always changes the order.
  update public.sponsors s set position = r.rn from (
    select id, row_number() over (order by position, id) as rn from public.sponsors where tier = me.tier) r
    where s.id = r.id;
  update public.sponsors set position = case id
      when me.id then (select position from public.sponsors where id = other.id)
      else (select position from public.sponsors where id = me.id) end
    where id in (me.id, other.id);
  perform private.sponsors_publish();
end; $$;

-- Clicks and code copies count for every sponsor on the list too.
create or replace function private.is_known_sponsor(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.known_sponsors where lower(name) = lower(p))
      or exists (select 1 from public.sponsors where lower(name) = lower(p))
      or exists (select 1 from public.prizes where lower(sponsor) = lower(p))
      or exists (select 1 from public.goals where lower(sponsor) = lower(p))
      or exists (select 1 from public.double_hours where lower(sponsor) = lower(p))
      or exists (select 1 from public.secret_codes where lower(sponsor) = lower(p))
      or exists (select 1 from public.bingo_settings where lower(prize_sponsor) = lower(p))
      or exists (select 1 from public.timer where lower(double_sponsor) = lower(p));
$$;

-- Logos: a public bucket; only moderators upload, replace or delete.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('sponsors', 'sponsors', true, 2097152, array['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'])
  on conflict (id) do nothing;
create policy "Moderators upload sponsor logos" on storage.objects for insert to authenticated
  with check (bucket_id = 'sponsors' and public.is_moderator());
create policy "Moderators update sponsor logos" on storage.objects for update to authenticated
  using (bucket_id = 'sponsors' and public.is_moderator());
create policy "Moderators delete sponsor logos" on storage.objects for delete to authenticated
  using (bucket_id = 'sponsors' and public.is_moderator());

-- Start from the main partner the site already shows (src/data/site.ts), so nothing changes
-- on the page until moderators edit it.
insert into public.sponsors (tier, position, name, code, cta, overlay_line)
  values ('main', 0, 'Zona IT', 'ICEMAN10', 'Vezi oferta', null)
  on conflict do nothing;
select private.sponsors_publish();

revoke all on function private.sponsor_link(text, boolean), private.sponsors_publish(), private.clip(text, integer),
  private.web_url(text) from public, anon, authenticated;
revoke all on function public.mod_sponsors(), public.mod_sponsor_save(jsonb), public.mod_sponsor_delete(bigint),
  public.mod_sponsor_move(bigint, integer) from public, anon;
grant execute on function public.mod_sponsors(), public.mod_sponsor_save(jsonb), public.mod_sponsor_delete(bigint),
  public.mod_sponsor_move(bigint, integer) to authenticated;
