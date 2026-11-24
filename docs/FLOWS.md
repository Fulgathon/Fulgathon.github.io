# ICEMARATON: how it works, flow by flow

Written 23 Nov 2026 from the code at `955b4c5` and the live Supabase project
(read-only catalog queries). Companion to `docs/BUGS.md`. Code paths are
relative to the repo root; "RPC" means `POST /rest/v1/rpc/<name>` on Supabase.

## 1. Stack map

| Layer | What | Where |
| --- | --- | --- |
| Static site | Astro 7, static output, plain CSS, a little TypeScript per page | `src/pages/*.astro`, `src/components/`, `src/styles/` |
| Hosting | Cloudflare Workers static assets, `not_found_handling: 404-page`, auto trailing slash | `wrangler.jsonc`, `public/_headers` |
| Page logic (viewer) | State + `derive()` + string views, patched into the DOM by `data-*` bindings | `src/scripts/app.ts`, `src/lib/derive.ts`, `src/lib/views.ts`, `src/lib/morph.ts` |
| Live data client | One versioned poll (`public_state`), lazy Supabase JS for logged-in viewers | `src/scripts/live.ts` |
| Moderator console | `/mod`, Supabase JS with the moderator's session, `mod_*` RPCs | `src/pages/mod.astro`, `src/scripts/mod.ts` |
| OBS overlay | `/overlay` (scene v2), `?style=strip|box` (classic) | `src/pages/overlay.astro`, `src/scripts/overlay-scene.ts`, `overlay-classic.ts` |
| Sponsor pages | `/sponsori` (pitch, packages), `/prezentare` (guided demo), `/demo` (busy showcase) | `src/pages/sponsori.astro`, `src/scripts/sponsori.ts`, `src/scripts/prezentare.ts` |
| Demo backend | The same rules in `localStorage`, shared by `?demo` tabs | `src/demo/backend.ts` |
| Database | Supabase Postgres (Frankfurt), RLS on every public table, logic in `SECURITY DEFINER` functions | `supabase/migrations/*.sql` |
| Edge Functions | `twitch-eventsub`, `twitch-auth`, `check-sub`, `watch-time`, `tipeee-donations` | `supabase/functions/` |
| Jobs | pg_cron: `icemaraton-minute` (1 min), `icemaraton-state` (1 min), `icemaraton-watch-time` (5 min), `icemaraton-tipeee` (15 s) | migrations `go_live`, `public_state`, `tipeee_donations` |
| Config | `src/data/site.ts` (links, sponsors, Supabase URL + publishable key, `twitchLogin`), `src/data/content.ts` (copy, defaults), `src/data/pitch.ts` | |

Short addresses: `/m` → `/mod/`, `/o` → `/overlay/`, `/d` → `/?demo`, `/s` → `/sponsori/`, `/p` → `/prezentare/`, `/demo` → `/?demo=showcase` (`src/components/ShortLink.astro` keeps the query string).

## 2. Roles and auth

| Role | How they get it | What they can do | Enforced by |
| --- | --- | --- | --- |
| Visitor (logged out) | nothing | read everything public through `public_state`, `feed_since`, `bingo_stats`; `track_sponsor` | grants: only those 5 RPCs (and table reads with "Public read" policies) are open to `anon` |
| Viewer (logged in) | Twitch OAuth via Supabase Auth (PKCE). Trigger `private.handle_new_user` creates `public.viewers` | `my_state`, `bingo_save`, `claim_code`, `spin` (bonus spins), `set_public_name` | `auth.uid()` inside each RPC |
| Subscriber | `viewers.is_subscriber`, set only by the `check-sub` Edge Function (Helix with the broadcaster token) | + `cast_vote`, `suggest`, daily `spin` | the RPCs check `is_subscriber` |
| Moderator | `viewers.is_moderator`; logins in `private.settings.moderator_logins` become moderators on first login; `mod_set_moderator` adds/removes | every `mod_*` RPC, read all viewers/suggestions | `private.require_moderator()` or `is_moderator()` at the top of all 36 `mod_*` functions (checked on the live catalog) |
| Streamer (Iceman) | a moderator whose Twitch login equals `private.settings.broadcaster_login` | connects the broadcaster token (`twitch-auth`), always counts as subscribed | `twitch-auth` refuses any other account |
| Backend | `service_role` key inside Edge Functions; cron secret; EventSub HMAC | `record_event`, `start_timer`, `freeze_timer`, `credit_watch_time`, `chat_line_claim`, `set_*`, `save_*` | not granted to `anon`/`authenticated` (checked) |

Sessions live in `localStorage` (`sb-yvbxtsuddjqqoogdoqrx-auth-token`). The public page loads the Supabase library (~57 KB gz) only if a session exists or the URL has `?code=` (return from Twitch).

## 3. Data model (public schema unless noted)

- **Clock:** `timer` (single row: `status upcoming|live|ended`, `starts_at`, `ends_at`, `paused_until`, `scheduled_end`, `double_from/until/sponsor`, `stream_online`), `stats` (subs, bits, raised €), `rates` (seconds per unit).
- **Events:** `events` (every sub/resub/gift/bits/donation/manual; `external_id` unique = idempotency; `seconds_added`, `doubled`, `bubble_line`). Not readable by anon. `private.supporter_totals` (running totals per supporter, trigger on insert) feeds the Legends.
- **Milestones:** `goals` (threshold €, title, sponsor, `unlocked_at`, `done_at`, `clip_url`, `scheduled_for`).
- **Vote:** `challenges` (pool), `vote_rounds`, `round_challenges` (votes counter), `votes` (one per viewer per round), `suggestions`.
- **Wheel:** `prizes` (8 slices, weight, sponsor), `spins` (one daily + bonus), `watch_time` (total minutes), `watch_daily` (minutes per Romanian day), `secret_codes`, `code_claims`, `code_attempts`, `viewers.bonus_spins`.
- **Bingo:** `bingo_items` (25), `bingo_settings` (close, prize, sponsor), `bingo_picks` (one line per viewer), `bingo_draws`.
- **Community:** `community_goals`, `private.checkins`, `private.stream_info` (title, game, note), `advent_days`, `iceman_lines`, `private.bubble_settings`.
- **Names:** `public_name(login, name)` applies `private.name_rules` (hide / allow / opt_out) and `private.blocked_words`; everything public goes through it.
- **Sponsors:** `sponsor_stats` (daily click/copy counts, salted IP hash), `double_hours` (history for the report), `private.known_sponsors`.
- **Cache:** `private.state_parts` (part → version + JSON), refreshed by statement triggers on the tables above.

## 4. Realtime layer

There is no websocket on the public side. **Polling with versions:**

1. `Live.poll()` sends `public_state({p_have: {timer: 12, feed: 40, …}})`.
2. The function returns all versions plus only the parts whose version differs from what the page has (a higher version on the page also counts as different, so a database reset heals itself), and `now` (server time).
3. Every 8 s while visible (overlay: every 3 s, also hidden). Hidden tabs stop. Failure → backoff `8 s × 2^n` up to 120 s with ±15 % jitter. `visibilitychange → visible` and `online` poll at once.
4. `onClock`: if server − device differs by more than 2 s, countdowns use the server's clock.
5. Parts are recomputed in statement triggers when their tables change; `icemaraton-state` cron refreshes `vote` and `timer` every minute (rounds open/close on time without a write).
6. Logged-in viewer: `my_state(round)` on start, on auth change, on return to the tab and every 2 min while visible.
7. Overlay: on each `feed` change, `feed_since(lastId)` returns every newer event (up to 100, oldest first), so bursts are queued in full; `lastId` dedupes.
8. `/mod` alone uses Supabase Realtime (`postgres_changes` on `timer`, `stats`, `vote_rounds`, `round_challenges`, `spins`) and re-loads 400 ms after a change; `mod_health` every minute.

## 5. Integrations

| Integration | Direction | Auth | Idempotency | Code |
| --- | --- | --- | --- | --- |
| Twitch EventSub (webhook) | Twitch → `twitch-eventsub` | HMAC-SHA256 of id+timestamp+body with the Vault secret, constant-time compare, 10-min freshness | `record_event(external_id = message id)` returns the existing row | `supabase/functions/twitch-eventsub/index.ts` |
| Twitch OAuth (viewer) | browser ↔ Supabase Auth | PKCE | trigger `on conflict do nothing` | `live.ts login()` |
| Twitch OAuth (streamer) | Iceman → `twitch-auth` | HMAC-signed `state` (15 min), account must be the broadcaster, all scopes required | recreates the 8 EventSub subscriptions | `supabase/functions/twitch-auth/index.ts` |
| Helix subscriptions | `check-sub` → Twitch | viewer JWT verified with `auth.getUser`; broadcaster token | overwrites `is_subscriber` | `supabase/functions/check-sub/index.ts` |
| Helix chatters | cron → `watch-time` → Twitch | `x-cron-secret` | none (each call credits 5 min) | `supabase/functions/watch-time/index.ts` |
| TipeeeStream | cron → `tipeee-donations` → Tipeee API | `x-cron-secret`; API key in Vault | `external_id = tipeee:<id>`, 2-min look-back | `supabase/functions/tipeee-donations/index.ts` |
| Twitch chat (Iceman's lines) | `chatLine()` → Helix `chat/messages` | broadcaster token with `user:write:chat` | `chat_line_claim` (once per event, 1 msg / 5 s, skips events > 2 min old) | `_shared/twitch.ts` |
| Twitch embeds | player + chat iframes on request | `parent=<hostname>` | | `app.ts loadEmbeds()` |

## 6. The subathon timer, end to end

**What adds time** (`rates`, migration `20261123120000_marathon_rules.sql`, owner's rates of 23 Nov 2026):

| Source | Kind | Time |
| --- | --- | --- |
| Tier 1 / Prime sub or shared resub | `sub` / `resub`, tier 1000 | +6 min |
| Tier 2 | tier 2000 | +12 min |
| Tier 3 | tier 3000 | +18 min |
| Gift subs | `gift`, quantity = total | +6 min each (any tier) |
| Bits | `bits` | +4 min per 400 (proportional: 100 bits = +1 min) |
| Donation (TipeeeStream, €) | `donation` | +6 min per € (proportional: 2.50 € = +15 min) |
| Moderator | `manual` (`mod_add_time`, may be negative) | as typed |

**Where it's calculated:** only in `public.record_event()` (Postgres). It locks the single `timer` row (`for update`), dedupes on `external_id`, converts with `rates` (`floor(quantity / per × seconds)`), doubles it while `now()` is inside Ora dublă, adds it to `ends_at`, updates `stats`, unlocks milestones by the € total, inserts the `events` row. If the timer isn't `live` (or `ends_at` is null) the event is still recorded and counted in stats, with 0 seconds.

**How it persists:** `timer.ends_at` is the authority. Nothing counts down in the database; "remaining" is always `ends_at − reference`, where reference = `paused_until` while frozen, else now.

**Freeze («Îngheață»):** `freeze_timer(s)` adds `s` to both `ends_at` and `paused_until`, so `ends_at − paused_until` stays constant: the display stands still and resumes seamlessly when `paused_until` passes. `mod_freeze_until(date)` = freeze for the difference; `mod_unfreeze` subtracts what's left of the freeze from `ends_at`. Time added during a freeze still moves `ends_at` (owner's rule: subs and donations still count).

**Ora dublă:** `timer.double_from/until` (+ sponsor) set by `mod_double_hour`; `record_event` doubles positive amounts while `now()` is in the window and marks `events.doubled`. The window is evaluated when the event is processed (Twitch: ~instant; Tipeee: up to ~15 s later).

**End:** `private.minute_tick()` (every minute) sets `status = 'ended'` once `ends_at < now()` and no freeze is running. `mod_end_timer` ends it at once. After `ended`, events add no time.

**Clients:** `derive()` (`src/lib/derive.ts`) computes `max(0, floor((ends_at − ref) / 1000))` on every 250 ms check when the second changes, with `now = Date.now() + clockOffset`. Because it is derived from the wall clock, a throttled or sleeping tab is right again on its next tick (tested: 90-minute sleep, 2-hour device skew). `/mod` and the overlay use the same formula.

## 7. Flows per role

Format: **entry** · steps · files · calls · ✓ success · ✗ expected errors.

### 7.1 Visitor (logged out)

**V1 · First load of `/`**
- Entry: `https://icemanlucky.ro/` (or `www`, redirected by a Cloudflare rule).
- Steps: static HTML rendered at build from the empty state (`src/lib/ssr.ts`) → fonts + inline CSS → `app.ts` → dynamic import `live.ts` → `public_state({})` → all parts → `onData(first)` → render; hero shows the newest event; if milestones are already unlocked, the goal toast shows once.
- Calls: `public_state`. No Supabase library unless a session exists.
- ✓ Clock ticking, LIVE / ÎNCEPE CURÂND / ÎNCHEIAT, feed, legends, milestones, games.
- ✗ Backend unreachable: «SE ÎNCARCĂ», then «REÎNCERCĂM · Fără conexiune» after two failures (fixed in `ff51962`; it used to say «ÎNCEPE CURÂND»), retries with backoff.

**V2 · Refresh mid-event** = V1. The countdown is right from the first answer; the hero shows only the newest event (no replay); legends/milestone "moments" don't fire on the first load.

**V3 · Reconnect after network loss**
- While offline: polls fail, backoff to 120 s; the clock keeps ticking from the last `ends_at` (it can't see time added meanwhile). No stale indicator once data has loaded (see BUGS B-11).
- `online` event → failures reset → poll at once → only changed parts arrive; new feed items queue the hero reactions (max 12, oldest first).

**V4 · Countdown states**
- Before start: `upcoming` + `starts_at` → «ÎNCEPE ÎN dd:hh:mm:ss». If `starts_at` passes before a moderator presses start, it shows `00:00:00:00` under «ÎNCEPE ÎN» until then.
- Live: «TIMP RĂMAS»; frozen: digits stand still + «până pe …, la …»; Ora dublă: banner with the end time and sponsor.
- At zero: `00:00:00:00` with LIVE for up to ~60 s (until `minute_tick`) + one poll; then «ÎNCHEIAT». An event in that window still adds time (B-08).
- After end: «Subathonul s-a încheiat», `00:00:00:00`; games say they open with the marathon.

**V5 · «Cât adaugi tu?» calculator** · `calcPick` radio group (arrow keys) · pure `derive` · «DONEAZĂ» goes to `site.links.donate` (placeholder `#` today).

**V6 · Read sections** · Parteneri, Comunitatea (legends, today, Fidelii, badges with tooltips on hover/focus/tap), Milestone Maraton (track, next goal, clips), Joacă, Live (player loads on «Pornește playerul»), Program (Advent calendar) · all from `public_state` parts.

**V7 · Log in with Twitch**
- Entry: «Conectează-te cu Twitch» (nav chip, wheel, bingo, vote, code).
- Steps: `live.login()` → Supabase `signInWithOAuth({provider: 'twitch', redirectTo: origin + pathname})` → Twitch consent → `…/auth/v1/callback` → back to the page with `?code=` → PKCE exchange → `onAuthStateChange` → `my_state` → if `sub_checked_at` is older than 10 min, `check-sub` → `my_state` again.
- ✓ Chip «Conectat ca …», «ABONAT» / «URMĂRITOR».
- ✗ Redirect URL not listed in Supabase → lands on the Site URL (homepage). The hash (`/mod/#bingo`) is lost on the way back. `twitchLogin: false` → toast «În curând».

**V8 · Bingo pick (any logged-in viewer; logged out can pick, then logs in)**
- Steps: click a row/column/diagonal arrow → `bingoLine` → the pick is stored in `localStorage` (survives the Twitch redirect) → «Salvează linia» → `bingo_save(items)`.
- ✓ «Linia ta e salvată. O poți schimba până la închidere.»
- ✗ `bingo_closed`, `not_a_line`, `not_logged_in`. Double submits: one request at a time since `ff51962`.

**V9 · Secret code → bonus spin**
- Steps: type the code seen on stream (#secret-code, Enter or «Revendică») → `claim_code(code)` → `my_state`.
- ✓ «Ai primit o rotire bonus de la …! Învârte roata.»
- ✗ `bad_code`, `already_claimed`, `too_many_attempts` (6/min). Race that gave 2 spins: fixed in migration `20261126100000` (not applied yet) + client guard.

**V10 · Sponsor click / code copy** · `data-track` → `track_sponsor(sponsor, kind)` once per session per sponsor and kind · server counts once per visitor per day (salted IP hash), only known sponsors.

### 7.2 Viewer, not subscribed

**N1 · Locked games**: vote buttons say «Doar abonați»; wheel says «Roata e doar pentru abonați…»; suggest form locked.
**N2 · «M-am abonat, verifică iar»** → `check-sub` (Edge Function, JWT) → Helix `/subscriptions` → `set_viewer_sub` → `my_state`. ✓ becomes «ABONAT». ✗ `twitch_unavailable` (503, broadcaster not connected or Twitch down) is swallowed: nothing changes and no message (B-15).

### 7.3 Subscriber

**S1 · Vote** · «Votează» on a challenge → optimistic «Votul tău ✓» → `cast_vote(round, challenge)` → `poll()`. Moving the vote is the same call. ✓ tally updates within a poll. ✗ `round_closed`, `not_in_round`, `not_subscribed` → the optimistic vote is rolled back and a toast explains. The function locks the round row, so concurrent votes are safe and repeats are no-ops.

**S2 · Suggest a challenge** · textarea (max 140) → «Trimite» → `suggest(body)`. ✓ «sent» state with «Propune alta». ✗ `too_many` (3 per 10 min), `not_subscribed`, body under 3 chars (check constraint, generic message).

**S3 · Daily wheel** · needs `is_subscriber`, 120 min in chat today (Romanian day, `watch_daily`, credited 5 min per 5-min cron while live and online), not spun today, timer live; or a bonus spin. «Învârte roata» → `spin()` (advisory lock per viewer, server picks a weighted prize) → the wheel animates 4.7 s to the server's slice (0.3 s with reduced motion) → result card → `my_state` + `poll()` (win appears in «Ultimele premii»). ✗ `wheel_closed`, `not_subscriber`, `not_enough_watch`, `already_spun`, `no_prizes`.

### 7.4 Moderator (`/mod`)

**M1 · Log in** · `/m` → `/mod/` → «Conectează-te cu Twitch» → back → `load()` reads `is_moderator`, timer, stats, rounds, suggestions, prizes, mods, goals, wheel, codes, bingo, names, health, lines, chat status. Not a moderator → «Fără acces». Status bar: LIVE/offline, clock, running/frozen/Ora dublă, four connection dots (EventSub, watch time, TipeeeStream, state cron), the moderator.
**M2 · Navigation** · grouped menu (Live · Conținut · Jocuri · Oameni · Sponsori · Overlay), `#section` deep links open the right page and scroll.
**M3 · Before the start** · «Program»: `mod_set_schedule(starts_at, scheduled_end)`. «Pornește acum»: confirm → `mod_start_timer(hours, scheduled_end)` (`start_timer` refuses ≤ 0). Start, end, auto start and moving the start while auto start is on: broadcaster only (`only_broadcaster`, 20261202100000).
**M4 · Timer** · `mod_add_time(±min)` (buttons +1/+5/+10/−5 and custom), `mod_freeze(min)`, `mod_freeze_until(date)`, `mod_unfreeze` (confirm), `mod_end_timer` (confirm). Each click is one request since `5b2df7e`.
**M5 · Ora dublă** · `mod_double_hour(from, minutes, sponsor)` or «Acum».
**M6 · «Acum pe stream» note** · `mod_set_note(text, minutes)`.
**M7 · Vote rounds** · auto-proposed 2 easy + 2 medium + 1 hard («Altele») → `mod_open_round(ids, minutes)` → closes itself (`minute_tick` → `finish_round` picks the winner, ties go to the earlier position) or «Închide acum» `mod_close_round`. Winner → scheduled; «Când» `mod_set_challenge(id,'scheduled',when)`; «Făcută» with clip `mod_set_challenge(id,'done',null,clip)`; veto.
**M8 · Suggestions** · approve (`mod_review_suggestion` → new votable challenge «Propusă de …») or reject.
**M9 · Milestones** · editor → `mod_set_goals([{title, threshold, sponsor, done, clip, when}])` (≤ 40, unique amounts, https clips).
**M10 · Content** · Iceman's lines `mod_set_lines` (6 groups, ≤ 70 chars, small-donation threshold); chat echo switch `mod_set_chat_echo` (confirm); Advent days `mod_set_advent`; community goals `mod_set_community_goals`.
**M11 · Games** · wheel slices `mod_set_prizes` (8); bingo settings/items/ticks/draw (`mod_bingo_*`, draw confirm, winner alert); secret codes `mod_code_show(sponsor, minutes)`, `mod_code_end`, `mod_overlay_key` (OBS link with `?key=`); prizes to hand out `mod_fulfil_spin`.
**M12 · People** · hide/allow names `mod_name_rule`, filtered names `mod_names`, moderators `mod_set_moderator` (remove = confirm), read-only badges/Fidelii/Legends.
**M13 · Sponsors** · `mod_sponsor_report` per sponsor, «Copiază» builds a text report.
**M14 · Overlay** · ready-made OBS links (with and without key).
Errors for all: messages mapped from the RPC error code (`errors` in `mod.ts`); unknown ones show «Eroare: …». Live refreshes no longer reset typed values (`5b2df7e`).

### 7.5 Streamer (Iceman)

**I1 · Connect the streamer account** · `/mod` → «Conectează contul de streamer» → `twitch-auth` → Twitch (`force_verify`, 5 scopes) → back with `code` + signed `state` → token exchange + validate → must be `icemanlucky` with all scopes → `save_broadcaster_token` (Vault) → delete old EventSub subscriptions pointing here → create 8 → page «Gata!» with each one «activ». ✗ «Link expirat» (state > 15 min), «Cont greșit», «Lipsesc permisiuni», «Aproape gata» (some subscriptions failed: press again).
**I2 · Going live on Twitch** · EventSub `stream.online/offline` → `set_stream_online` (watch time only counts while online).
**I3 · Channel-point check-in** · reward title containing "check-in" → EventSub redemption → `record_checkin` (once per Romanian day).

### 7.6 Backend flows

**B1 · Sub / resub / gift / bits** · Twitch → `twitch-eventsub` (verify signature, reject > 10 min old, answer the verification challenge, log revocations) → `record_event` → optional `chatLine`. Gift recipients' `channel.subscribe` (`is_gift`) is skipped; the gift event counts them. A resub adds time only if the viewer shares the resub message (Twitch sends nothing otherwise).
**B2 · Donation** · every 15 s cron → `tipeee-donations` (cron secret) → events since `since − 2 min` → for each donation after the timer started and while live: `record_event('donation', …, external_id 'tipeee:<id>')`. First run only sets the starting point.
**B3 · Watch time** · every 5 min → `watch-time` → title/game/viewers → if live and online: all chatters (paged), sub status in batches of 100 → `credit_watch_time(viewers, 5)`.
**B4 · Minute tick** · finish rounds whose time is up; end the timer at zero.

### 7.7 OBS overlay (`/overlay`, `/o`)

- Entry: OBS Browser Source 1920×1080 with `/o` or the private link `/overlay/?key=…` from `/mod` → Overlay.
- Options: `?scene=brb`, `?calm=1`, `?scale=0.5–2`, `?show=timer,goal,together,bubble,moments,vote,promo,code`, `?promo=<min>` (0 = off), `?codeSecs`, `?style=strip|box` (classic, with `?pos=tl/tr/bl/br`), `?demo`.
- Steps: same `Live` client, every 3 s even when hidden; new events via `feed_since`; per event: «+time» pop and flash, Iceman's bubble (server-picked line, else «Mersi, {nume}!»); moments one at a time (VISCOL for 20+ gifts per minute, milestone unlocked, legend changes, 50/100 h badges, bingo tick, vote live + winner, wheel spin, big moments); secret code from `overlay_code(key)` every 8 s; partner line every 10 min.
- ✓ Burst of 30 events all shown in order (previous session). ✗ Wrong/missing key → no code panel (silent by design).

### 7.8 Sponsors

- `/sponsori` (`/s`): step-by-step pitch; typing a brand name shows it in every placement (site, overlay, report); packages and audience from `src/data/pitch.ts`. No payment or checkout exists.
- `/demo`: the real page on "day 9" of a simulated busy marathon, labelled «Demo · date de exemplu», reset on every visit, events every 5.5 s.
- `/prezentare` (`/p`): guided tour driving an embedded `/?demo&embed` through `postMessage` (same origin only).
- Contact: `site.contactEmail` (placeholder `[EMAIL CONTACT]` today).

## 8. Flows nobody owned (and what happens now)

| Situation | What happens | Status |
| --- | --- | --- |
| First load | Build-time HTML says «SE ÎNCARCĂ» with `--` digits until `public_state` answers (usually < 300 ms) | fixed `ff51962` (was «ÎNCEPE CURÂND») |
| Refresh mid-event | Correct clock on the first answer; no replay of old reactions | OK |
| Backend down on first load | «REÎNCERCĂM · Fără conexiune», retries 16 s, 32 s, 64 s, then every 120 s; `online` retries at once | fixed `ff51962` |
| Backend down after load | Clock keeps ticking from the last known end; no visible stale marker | B-11 (open) |
| Network back | Immediate poll; changed parts only | OK |
| Tab asleep / throttled | Clock derived from the wall clock, right on the next tick; hidden tabs don't poll | OK (tested) |
| Wrong device clock | Server time from each poll; differences over 2 s corrected | OK (tested with 2 h skew) |
| Timer reaches 0 | LIVE + `00:00:00:00` up to ~60 s, then ÎNCHEIAT; an event in that gap revives the clock | B-08 (owner decision) |
| Before start | Countdown to `starts_at`; `00:00:00:00` under «ÎNCEPE ÎN» if the start is late | B-21 (low) |
| After end | ÎNCHEIAT; games closed; events still recorded with 0 s | OK |
| 404 | Cloudflare serves `404.html` («Pagina nu există») with status 404, for any unknown path including `/mod/x` | OK |
| Deep links | `/#joaca`, `/#comunitate`, … scroll to the section; `/mod/#bingo` opens the Jocuri page (after login; the hash is lost through the Twitch redirect) | OK / B-20 |
| `/demo`, `/d`, `?demo` | Local simulated backend, never touches Supabase; `/demo` resets on every visit | OK |
| Overlay without key | Everything except the secret code | by design |
| Empty lists from the server | An empty milestone or prize list is ignored and the placeholder defaults keep showing | B-17 (open) |
