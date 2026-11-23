-- RUN ONLY AFTER the site from branch optimize/scale-and-safety is deployed
-- (npm run deploy). The old page reads these tables directly; the new one
-- only calls public_state / my_state / feed_since.
--
-- 1. Personal data stops being publicly readable (who watched how long,
--    every event with Twitch ids). Names reach the page only through
--    public_name() (opt-out + moderation).
revoke select on public.events, public.watch_time from anon, authenticated;
drop policy if exists "Public read" on public.events;
drop policy if exists "Public read" on public.watch_time;
revoke select on public.spins from anon;

-- 2. Realtime only for what /mod still listens to (the public page polls).
alter publication supabase_realtime drop table public.events, public.goals, public.bingo_items, public.bingo_settings;
