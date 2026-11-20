-- Closing a round in the same instant it opened (closes_at = opens_at) is fine.
alter table public.vote_rounds drop constraint vote_rounds_check;
alter table public.vote_rounds add constraint vote_rounds_check check (closes_at >= opens_at);
