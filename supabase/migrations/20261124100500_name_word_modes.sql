-- Fewer false positives: short words must be a whole word part ("exact"),
-- some may start one ("prefix"), long unambiguous ones match anywhere ("any").
alter table private.blocked_words add column mode text not null default 'any' check (mode in ('any', 'prefix', 'exact'));
update private.blocked_words set mode = case when token_only then 'prefix' else 'any' end;
update private.blocked_words set mode = 'exact'
  where word in ('fut', 'futu', 'cur', 'sex', 'muie', 'pule', 'cunt', 'nazi', 'kys', 'rape', 'dick', 'cock');
update private.blocked_words set mode = 'prefix' where word = 'futut';
update private.blocked_words set mode = 'exact' where word = 'curva';
insert into private.blocked_words (word, mode) values ('curve', 'exact'), ('futui', 'prefix') on conflict do nothing;
alter table private.blocked_words drop column token_only;

create or replace function public.name_blocked(p text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  compact text := regexp_replace(private.name_fold(p), '[^a-z]', '', 'g');
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
    where (w.mode = 'any' and position(w.word in compact) > 0)
       or (w.mode = 'prefix' and exists (select 1 from unnest(tokens) t where t like w.word || '%'))
       or (w.mode = 'exact' and w.word = any (tokens))
  );
end; $$;
revoke all on function public.name_blocked(text) from public, anon, authenticated;
