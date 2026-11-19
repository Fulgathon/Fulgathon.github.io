-- FULGATHON phase 2: core schema.
--
-- Rules of the road (see docs/twitch-integration.md):
--   * The browser never decides anything. Visitors can only READ public data.
--   * Time, subs, bits and donations are written by Edge Functions with the
--     service role, through record_event().
--   * Votes, suggestions and spins go through security-definer functions that
--     check who is asking (auth.uid()) and whether they're allowed.

-- ---------------------------------------------------------------------------
-- Timer (single row): the authoritative end time. Browsers render ends_at - now.
-- ---------------------------------------------------------------------------
create table public.timer (
  id             smallint primary key default 1 check (id = 1),
  status         text not null default 'upcoming' check (status in ('upcoming', 'live', 'ended')),
  starts_at      timestamptz,               -- scheduled start (shown while "upcoming")
  ends_at        timestamptz,               -- authoritative end, moved by every sub/bit/donation
  scheduled_end  timestamptz,               -- "[DATA FINALĂ]": the end if no more time is added
  paused_until   timestamptz,               -- "Îngheți timpul" from the wheel
  double_from    timestamptz,               -- "Ora dublă" window: added time counts double
  double_until   timestamptz,
  updated_at     timestamptz not null default now()
);
insert into public.timer (id) values (1);

-- Running totals for the scoreboard (single row, kept by record_event()).
create table public.stats (
  id          smallint primary key default 1 check (id = 1),
  subs        integer not null default 0,   -- subs + resubs + gifted subs
  bits        integer not null default 0,
  raised      numeric(12, 2) not null default 0,  -- donations, in lei
  updated_at  timestamptz not null default now()
);
insert into public.stats (id) values (1);

-- How much time each thing adds: `seconds` for every `per` units.
create table public.rates (
  key      text primary key check (key in ('tier1', 'tier2', 'tier3', 'gift', 'bits', 'donation')),
  seconds  integer not null check (seconds >= 0),
  per      numeric not null default 1 check (per > 0),
  label    text not null
);

-- ---------------------------------------------------------------------------
-- Events: every sub, gift, cheer, donation or manual adjustment.
-- Feeds the ticker, "+time" chips, toasts and leaderboards.
-- ---------------------------------------------------------------------------
create table public.events (
  id             bigint generated always as identity primary key,
  source         text not null check (source in ('twitch', 'donation', 'manual')),
  kind           text not null check (kind in ('sub', 'resub', 'gift', 'bits', 'donation', 'manual')),
  external_id    text unique,               -- EventSub message id / donation id: makes retries harmless
  user_id        text,                      -- Twitch user id (null for anonymous gifts/donations)
  user_login     text,
  user_name      text,
  tier           text check (tier in ('1000', '2000', '3000', 'prime')),
  quantity       numeric not null default 1 check (quantity >= 0),  -- gifted subs, bits or donation amount
  currency       text,
  seconds_added  integer not null default 0,
  doubled        boolean not null default false,
  created_at     timestamptz not null default now()
);
create index events_created_at_idx on public.events (created_at desc);
create index events_user_id_idx on public.events (user_id);
create index events_kind_idx on public.events (kind);

-- Christmas goals, unlocked by the sub count.
create table public.goals (
  position     smallint primary key,
  title        text not null,
  threshold    integer not null unique check (threshold > 0),
  unlocked_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- Viewers who logged in on the site with Twitch.
-- ---------------------------------------------------------------------------
create table public.viewers (
  id              uuid primary key references auth.users (id) on delete cascade,
  twitch_id       text unique,
  login           text,
  display_name    text,
  is_subscriber   boolean not null default false,
  sub_tier        text,
  sub_checked_at  timestamptz,
  is_moderator    boolean not null default false,
  created_at      timestamptz not null default now()
);

-- Watch time per Twitch account (credited from chat presence, so it includes
-- people who never logged in on the site). 1 snowflake per hour, 2 for subs.
create table public.watch_time (
  twitch_id          text primary key,
  login              text not null,
  display_name       text,
  minutes            integer not null default 0 check (minutes >= 0),
  minutes_to_flake   integer not null default 0 check (minutes_to_flake >= 0),
  flakes             integer not null default 0 check (flakes >= 0),
  updated_at         timestamptz not null default now()
);
create index watch_time_minutes_idx on public.watch_time (minutes desc);

-- ---------------------------------------------------------------------------
-- Spin wheel: 8 segments, 3 snowflakes = 1 spin. The server picks the prize.
-- ---------------------------------------------------------------------------
create table public.prizes (
  position     smallint primary key check (position between 0 and 7),
  short_label  text not null,
  full_label   text not null,
  is_win       boolean not null default true,
  weight       integer not null default 1 check (weight >= 0)
);

create table public.spins (
  id              bigint generated always as identity primary key,
  twitch_id       text not null,
  user_login      text not null,
  prize_position  smallint not null references public.prizes (position),
  created_at      timestamptz not null default now(),
  fulfilled_at    timestamptz             -- set by a moderator once the prize is given
);
create index spins_twitch_id_idx on public.spins (twitch_id);
create index spins_created_at_idx on public.spins (created_at desc);

-- ---------------------------------------------------------------------------
-- Subscriber vote: rounds of challenges, one vote per subscriber per round.
-- ---------------------------------------------------------------------------
create table public.challenges (
  id             integer primary key,
  category       text not null,
  category_name  text not null,
  title          text not null,
  how            text not null,
  level          text not null check (level in ('ușor', 'mediu', 'greu')),
  votable        boolean not null default true,
  status         text not null default 'pool' check (status in ('pool', 'in_round', 'scheduled', 'done', 'vetoed')),
  scheduled_for  text,                      -- e.g. "Diseară, 22:00"
  done_at        timestamptz,
  clip_url       text
);

create table public.vote_rounds (
  id         integer generated always as identity primary key,
  number     integer not null unique,
  opens_at   timestamptz not null default now(),
  closes_at  timestamptz not null,
  winner_id  integer references public.challenges (id),
  check (closes_at > opens_at)
);

create table public.round_challenges (
  round_id      integer not null references public.vote_rounds (id) on delete cascade,
  challenge_id  integer not null references public.challenges (id),
  position      smallint not null,
  votes         integer not null default 0 check (votes >= 0),   -- kept by cast_vote()
  primary key (round_id, challenge_id)
);
create index round_challenges_challenge_idx on public.round_challenges (challenge_id);

create table public.votes (
  round_id      integer not null,
  viewer_id     uuid not null references public.viewers (id) on delete cascade,
  challenge_id  integer not null,
  updated_at    timestamptz not null default now(),
  primary key (round_id, viewer_id),
  foreign key (round_id, challenge_id) references public.round_challenges (round_id, challenge_id) on delete cascade
);
create index votes_viewer_idx on public.votes (viewer_id);
create index votes_round_challenge_idx on public.votes (round_id, challenge_id);

-- Challenge ideas from subscribers, approved by moderators.
create table public.suggestions (
  id          bigint generated always as identity primary key,
  viewer_id   uuid not null references public.viewers (id) on delete cascade,
  body        text not null check (char_length(btrim(body)) between 3 and 140),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now()
);
create index suggestions_viewer_idx on public.suggestions (viewer_id, created_at desc);
create index suggestions_status_idx on public.suggestions (status);

-- ---------------------------------------------------------------------------
-- Leaderboards (security_invoker: they read with the caller's rights).
-- ---------------------------------------------------------------------------
create view public.leaderboard_gifts with (security_invoker = on) as
  select user_login, max(user_name) as user_name, sum(quantity)::integer as total
  from public.events
  where kind = 'gift' and user_login is not null
  group by user_login
  order by total desc
  limit 10;

create view public.leaderboard_bits with (security_invoker = on) as
  select user_login, max(user_name) as user_name, sum(quantity)::integer as total
  from public.events
  where kind = 'bits' and user_login is not null
  group by user_login
  order by total desc
  limit 10;

create view public.leaderboard_hours with (security_invoker = on) as
  select login as user_login, display_name as user_name, (minutes / 60)::integer as total
  from public.watch_time
  order by minutes desc
  limit 10;

-- ---------------------------------------------------------------------------
-- Row level security: on everywhere. Public tables are read-only for
-- visitors; personal tables only show the viewer their own rows. Nothing is
-- writable from the browser: writes go through the functions in the next
-- migration or the service role (Edge Functions).
-- ---------------------------------------------------------------------------
alter table public.timer             enable row level security;
alter table public.stats             enable row level security;
alter table public.rates             enable row level security;
alter table public.events            enable row level security;
alter table public.goals             enable row level security;
alter table public.viewers           enable row level security;
alter table public.watch_time        enable row level security;
alter table public.prizes            enable row level security;
alter table public.spins             enable row level security;
alter table public.challenges        enable row level security;
alter table public.vote_rounds       enable row level security;
alter table public.round_challenges  enable row level security;
alter table public.votes             enable row level security;
alter table public.suggestions       enable row level security;

create policy "Public read" on public.timer            for select to anon, authenticated using (true);
create policy "Public read" on public.stats            for select to anon, authenticated using (true);
create policy "Public read" on public.rates            for select to anon, authenticated using (true);
create policy "Public read" on public.events           for select to anon, authenticated using (true);
create policy "Public read" on public.goals            for select to anon, authenticated using (true);
create policy "Public read" on public.watch_time       for select to anon, authenticated using (true);
create policy "Public read" on public.prizes           for select to anon, authenticated using (true);
create policy "Public read" on public.spins            for select to anon, authenticated using (true);
create policy "Public read" on public.challenges       for select to anon, authenticated using (true);
create policy "Public read" on public.vote_rounds      for select to anon, authenticated using (true);
create policy "Public read" on public.round_challenges for select to anon, authenticated using (true);

create policy "Viewers read their own row" on public.viewers
  for select to authenticated using ((select auth.uid()) = id);
create policy "Viewers read their own votes" on public.votes
  for select to authenticated using ((select auth.uid()) = viewer_id);
create policy "Viewers read their own suggestions" on public.suggestions
  for select to authenticated using ((select auth.uid()) = viewer_id);

-- Explicit privileges: browsers may only SELECT; the service role does the rest.
revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.timer, public.stats, public.rates, public.events, public.goals,
  public.watch_time, public.prizes, public.spins, public.challenges,
  public.vote_rounds, public.round_challenges,
  public.leaderboard_gifts, public.leaderboard_bits, public.leaderboard_hours
  to anon, authenticated;
grant select on public.viewers, public.votes, public.suggestions to authenticated;
grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Realtime: push changes to every open page (timer, ticker, goals, votes, wheel).
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.timer, public.stats, public.events, public.goals,
  public.spins, public.vote_rounds, public.round_challenges;
