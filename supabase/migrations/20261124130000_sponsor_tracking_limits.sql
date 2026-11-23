-- Sponsor numbers you can stand behind: a click or code copy counts at most
-- once per visitor, sponsor, kind and day (visitors told apart by a salted
-- hash of their IP, never stored in clear), and only for known sponsors.
-- Before this, anyone could inflate the report with a script.

create table private.track_seen (
  day     date not null,
  visitor text not null,        -- sha256(daily salt || ip), not reversible
  sponsor text not null,
  kind    text not null,
  primary key (day, visitor, sponsor, kind)
);

-- Sponsors that can be tracked: the main partner from the site config, plus
-- every sponsor named anywhere in the data (prizes, milestones, Ora dublă, codes, bingo).
create table private.known_sponsors (name text primary key);
insert into private.known_sponsors (name) values ('Zona IT') on conflict do nothing;

create or replace function private.is_known_sponsor(p text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.known_sponsors where lower(name) = lower(p))
      or exists (select 1 from public.prizes where lower(sponsor) = lower(p))
      or exists (select 1 from public.goals where lower(sponsor) = lower(p))
      or exists (select 1 from public.double_hours where lower(sponsor) = lower(p))
      or exists (select 1 from public.secret_codes where lower(sponsor) = lower(p))
      or exists (select 1 from public.bingo_settings where lower(prize_sponsor) = lower(p))
      or exists (select 1 from public.timer where lower(double_sponsor) = lower(p));
$$;

create or replace function public.track_sponsor(p_sponsor text, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s       text := left(btrim(coalesce(p_sponsor, '')), 60);
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  ip      text := coalesce(headers ->> 'cf-connecting-ip', headers ->> 'x-real-ip',
                           btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), 'unknown');
  today   date := (now() at time zone 'Europe/Bucharest')::date;
  visitor text := encode(extensions.digest(today::text || coalesce(current_setting('app.track_salt', true), 'icemaraton') || ip, 'sha256'), 'hex');
  n       integer;
begin
  if s = '' or p_kind not in ('click', 'code_copy') or not private.is_known_sponsor(s) then return; end if;
  insert into private.track_seen (day, visitor, sponsor, kind) values (today, visitor, lower(s), p_kind) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return; end if;  -- this visitor already counted today
  insert into public.sponsor_stats (sponsor, kind, count) values (s, p_kind, 1)
  on conflict (day, sponsor, kind) do update set count = public.sponsor_stats.count + 1;
end; $$;
revoke all on function public.track_sponsor(text, text) from public;
grant execute on function public.track_sponsor(text, text) to anon, authenticated;

-- Keep the dedupe table small: only the last 3 days are needed.
select cron.schedule('icemaraton-track-cleanup', '17 4 * * *', $$delete from private.track_seen where day < current_date - 3$$);
