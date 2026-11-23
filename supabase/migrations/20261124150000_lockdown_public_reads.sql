-- Applied after the site that reads public_state was deployed (24 Nov 2026).
-- The old page read these tables directly; the current one only calls
-- public_state / my_state / feed_since.
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

-- 3. The old leaderboard views (owner-rights views, flagged by the Supabase
--    advisor) are no longer read: the page gets boards from public_state.
drop view if exists public.leaderboard_donations, public.leaderboard_gifts, public.leaderboard_bits, public.leaderboard_hours;
