# ICEMARATON: test pass, 23 Nov 2026

Phase 1 of the owner's mission. Flows are described in `docs/FLOWS.md`.

## How it was tested

- **Code read** end to end: `src/scripts/*`, `src/lib/*`, `src/demo/backend.ts`, every Edge Function, every migration.
- **Live database, read only:** function grants for `anon` / `authenticated`, the moderator check inside all 36 `mod_*` functions, table privileges and RLS policies, the realtime publication, the Supabase security advisor. Nothing was written to production.
- **Browser:** the production build (`astro preview`) in headless Chrome driven by `playwright-core` from a scratch folder (not added to the project; see «Proposals»). `public_state` and the viewer RPCs were mocked to reach states the real backend can't show today: live, frozen, zero, ended, late start, 400 days left, 98 million €, XSS payloads in every name and title, emoji, 80-character names, empty lists, outages, slow answers, a logged-in subscriber.
- **Widths:** 375, 768, 1280, 1440, 1920, 2560, 3840 for `/`, `/?demo`, `/demo`, `/mod/`, `/sponsori/`, `/prezentare/`, a 404, `/m`, `/s` (63 page loads): no horizontal scroll anywhere, the navbar stays on one row at every width (60 / 68 / 91 / 136 px tall), no console errors except the expected 404.
- **Timer integrity:** device clock 2 h wrong → correct; tab asleep 90 min → correct on wake; frozen → stands still and resumes; zero → never negative; 400 days → `400:00:00:00`.
- **Long session:** `/demo` showcase for 60 simulated minutes (an event every 5.5 s): DOM nodes flat (~4,300), event listeners constant (17), heap 2.1 → 2.9 MB (+0.2 MB over the last 40 min; the demo backend keeps every simulated event in its state, the live client caps the feed at 20). One re-render per second costs ≈ 0.02 % CPU. A multi-hour run on live data is still worth doing once the marathon has real events.
- **Poll rate:** page every 8 s (±15 %), overlay every 3 s, as designed.
- **Lighthouse** (production build): mobile 98 / 100 / 100 / 100, desktop 100 / 100 / 100 / 100 (performance / accessibility / best practices / SEO); `/mod` accessibility 100.
- **Reduced motion:** `/demo` runs 9 animations normally and 0 with `prefers-reduced-motion`; the overlay draws no snow.
- **Bundle:** only the publishable Supabase key ships; no service key, cron secret, Twitch secret or Tipeee key in `dist/`.
- **Database fixes:** the new migration was run in PGlite (in-memory Postgres) against stub tables.

Severity: **Critical** = money, data loss, auth bypass or the site down for everyone. **High** = a core flow broken, or wrong or unsafe behaviour many people would hit. **Medium** = wrong in an edge case, or a defence missing. **Low** = polish.

**No Critical bugs found.** Auth and permissions hold: every moderator action is checked in the database, backend-only functions can't be called from a browser, names and titles are escaped everywhere, the EventSub signature and replay window are checked, and events are idempotent on their Twitch / TipeeeStream id.

## Summary

| # | Sev. | Bug | Status |
| --- | --- | --- | --- |
| B-01 | High | A `javascript:` clip link typed on /mod runs code for every viewer who clicks «Vezi clipul» | **Fixed** in the site (`86ee9c3`, `ff51962`); DB check in migration `20261126100000` (applied 23 Nov) |
| B-02 | High | One secret code can give several bonus spins (parallel or double-clicked claims) | **Fixed** in the site (`ff51962`); DB fix in migration (applied 23 Nov) |
| B-03 | High | /mod: a double click on «+10 min» (or any action) does it twice | **Fixed** `5b2df7e` |
| B-04 | High | /mod: a sub arriving while a moderator types resets other fields: «Îngheață 120 min» becomes 5 | **Fixed** `5b2df7e` |
| B-05 | High | Page says «ÎNCEPE CURÂND» to anyone who loads it while the backend is slow or down, mid-marathon | **Fixed** `ff51962` |
| B-06 | Medium | Viewer double submits: a triple click sends 3 suggestions, 3 code claims, 3 bingo saves | **Fixed** `ff51962` |
| B-07 | Medium | During Ora dublă a moderator's «+10 min» adds 20 | **Fixed**: migration `20261126100000` (applied 23 Nov) |
| B-08 | Medium | At zero the clock shows LIVE 00:00:00 for up to a minute, and an event in that gap revives it | Owner decision |
| B-09 | Medium | A TipeeeStream donation in another currency is counted as euros | Open |
| B-10 | Medium | No security headers (CSP, frame-ancestors, nosniff, referrer policy) | Open |
| B-11 | Medium | After data has loaded, a lost connection isn't shown; the clock may be minutes behind reality | Open |
| B-12 | Medium | Parallel requests get past the «3 suggestions per 10 minutes» limit | **Fixed**: migration `20261126100000` (applied 23 Nov) |
| B-13 | Medium | `mod_freeze` / `mod_freeze_until` with an empty value erase the end time (clock dead) | **Fixed**: migration `20261126100000` (applied 23 Nov) |
| B-14 | Medium | /mod relies on Realtime only: after laptop sleep or a dropped socket it shows old numbers | Fixed: reloads when the channel (re)joins, the tab comes back or the network returns |
| B-15 | Medium | `check-sub`: no throttle (can exhaust Iceman's Twitch API quota) and no message when it fails | Open |
| B-16 | Medium | `community_goals`: anon/authenticated hold every table privilege (RLS blocks writes, TRUNCATE isn't reachable from the API) | **Fixed**: migration `20261126100000` (applied 23 Nov) |
| B-17 | Medium | Deleting all milestones or prizes on /mod leaves the placeholder list on the site | Open |
| B-18 | Medium | Resubs add time only if the viewer shares the resub message in chat (Twitch limitation) | Owner decision |
| B-19 | Low | Logged-in users can read the whole `spins` table, including logins whose names are hidden | Open |
| B-20 | Low | The `#section` is lost through the Twitch login redirect (`/mod/#bingo` → `/mod/`) | Open |
| B-21 | Low | If the start is late, the page shows «ÎNCEPE ÎN 00:00:00:00» until a moderator starts it | Open |
| B-22 | Low | Triple click on «Votează» sends 3 requests (harmless: the vote is idempotent) | Open |
| B-23 | Low | `my_state` is called 3 times on load for a logged-in viewer | Open |
| B-24 | Low | Touch targets under 44 px: badge tags (31 px), /sponsori step buttons (36 px), /mod brand link | Partly fixed: /sponsori step and action buttons are 44 px; badge tags and the /mod brand link remain |
| B-25 | Low | Placeholders visible to visitors: «[DATA DE START]» in the ticker while loading, «[EMAIL CONTACT]», LOGO slots | Owner content |
| B-26 | Low | No cap or review on huge donations (a 1,000 € test or charged-back donation adds 100 h) | Owner decision |
| B-27 | Low | Edge Functions can refresh the Twitch token at the same moment | Open |
| B-28 | Low | A 140-character suggestion cut in the middle of an emoji can be refused | Open |
| B-29 | Low | /mod has no `<h1>` before login | Open |
| B-30 | Low | Any moderator can remove any other moderator, including Iceman | Owner decision |
| B-31 | Medium | Before the start, «Cât adaugi tu?» promises «+30 min» but the server adds no time until the timer is live | Fixed (option a, wording): outside LIVE the calculator says time is added from the start |
| B-32 | Low | Community-goal hours not yet reached are #4A5568 on #090C11 (2.6:1, below 4.5:1) | Fixed: now #8C97A8 (6.6:1) |

Nothing is pushed or deployed. The site fixes go live with `npm run deploy`; the database fixes need the migration applied.

## High

### B-01 · Stored XSS through clip links
- **Repro:** on /mod → Vot → a scheduled challenge → «Făcută» with clip `javascript:alert(document.cookie)`. Every visitor who clicks «Vezi clipul» under «Făcute» runs it. Reproduced in the browser with a mocked feed (`window.__xss` was set after the click).
- **Expected:** only `https://` clip links. **Actual:** any text went into `href`.
- **Root cause:** `views.ts` escaped the value for HTML but didn't check the URL scheme. `goals.clip_url` and `advent_days.clip_url` are checked in the database; `challenges.clip_url` and `mod_set_challenge` are not. A moderator account taken over (or a careless paste) could steal viewers' sessions from `localStorage`.
- **Fix:** `safeUrl()` (`src/lib/format.ts`) allows http(s), same-site paths and `#`; used in every clip `href` and on arrival in `live.ts`; /mod checks the clip before saving. Migration adds `challenges_clip_https` and a `bad_clip` check in `mod_set_challenge`. Regression tests: `tests/security.test.ts`.

### B-02 · One secret code, several bonus spins
- **Repro:** send `claim_code('ABCD12')` twice at the same moment (two tabs, a double click before the first answer, or a script). Both pass the "already claimed?" check before either inserts; the second insert hits `on conflict do nothing`, but both add `bonus_spins + 1`.
- **Expected:** one spin per code per viewer. **Actual:** up to one per parallel request (the 6-tries-per-minute limit is raced the same way).
- **Root cause:** check-then-insert without a lock; the bonus was added whether or not the claim row was new.
- **Fix:** migration: an advisory lock per viewer, then the claim insert decides (`get diagnostics row_count`; 0 → `already_claimed`). Tested in PGlite: second claim → `already_claimed`, bonus stays 1. The site sends one claim at a time (`ff51962`, measured: 3 clicks → 1 request).

### B-03 · /mod double clicks repeat the action
- **Repro:** /mod/?demo → Live → Cronometru → double-click «+1 min». Measured: 2 manual events.
- **Expected:** one. **Actual:** every click sent its own request, so a nervous double click on «+10 min», «−5 min», «Arată un cod nou» or «Ora dublă acum» doubled it.
- **Fix:** the click handler marks the control busy (`disabled`, `aria-busy`) until its request answers, at least 700 ms; the same action on the same row waits even if a live refresh re-drew the button. Measured after: 1 event.

### B-04 · /mod live refreshes reset what a moderator typed
- **Repro:** /mod/?demo → type 120 in «Îngheață … min» and 15 in the custom minutes, keep the cursor in the second field; a sub arrives (another tab with /?demo → +Sub); press Tab. Measured: freeze field back to 5, custom minutes empty. Pressing «Îngheață» then freezes for 5 minutes.
- **Root cause:** `render()` waits while a field has focus, but then rebuilds the whole page from scratch, so every other field returns to its default. Every sub, gift and donation triggers a render through Realtime.
- **Fix:** before rebuilding, values the moderator changed (by element id) are kept and put back; after a successful action the forms start fresh as before. Measured after: 15 and 120 kept.

### B-05 · «Starts soon» shown during the marathon
- **Repro:** block `public_state` (or let it time out) and open `/`. Measured: «ÎNCEPE CURÂND», «Începe în --:--:--:--», forever, retrying every 16 → 120 s.
- **Expected:** honest loading / offline state. **Actual:** the empty first-paint state is "upcoming". On a busy night (46,800 unique viewers last time) a slow backend would tell people the marathon hasn't started.
- **Fix:** `SiteData.loaded` is false until the first answer: «SE ÎNCARCĂ», then «REÎNCERCĂM» with «Fără conexiune» after two failed polls. Checked at 375 → 3840 px: the navbar stays one row. Tests: `tests/timer.test.ts`.

## Medium

### B-06 · Viewer double submits
Triple click measured with a mocked subscriber: `suggest` ×3, `claim_code` ×3, `bingo_save` ×3 (spin was already guarded). Three identical suggestions land in the moderators' queue and use up the viewer's 3-per-10-minutes allowance. **Fix:** one request at a time per action, at least 700 ms (`ff51962`). Measured after: 1 each.

### B-07 · Ora dublă doubles manual time
`record_event` doubles any positive amount during Ora dublă, including `kind = 'manual'`, so «+10 min» on /mod adds 20 while the toast says «10 min adăugate». **Fix (migration):** `and p_kind <> 'manual'`. PGlite: manual 600 s → 600 s, not doubled; a sub in the same window → 720 s, doubled. If the owner prefers manual time doubled too, drop that part.

### B-08 · The gap at zero
`minute_tick` ends the marathon once a minute, and the site polls every 8 s, so after `00:00:00:00` the page can show LIVE for up to ~70 s. An event in that gap is added to an end time already in the past, so the clock can come back with less than was added (6 min − 30 s), and TipeeeStream donations arrive up to 15 s late. **Owner decision:** either "zero is final" (`record_event` adds nothing once `ends_at` has passed, and ends the timer at once), or "a last-second donation saves it" (count from now, not from the old end). The page can then say «Timpul a expirat» at zero instead of LIVE.

### B-09 · Donations in other currencies counted as euros
`tipeee-donations` logs a warning and counts `amount` as € whatever `currency` says: 50 RON (≈ 10 €) would add 300 min instead of ~60. **Fix options:** confirm the TipeeeStream page only accepts EUR, or convert with a fixed table and keep the original in `events.currency`.

### B-10 · No security headers
`public/_headers` sets only font caching. Missing: `Content-Security-Policy` (scripts from self, connect to the Supabase project, frames from Twitch), `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN` (the vote and spin buttons can be framed by another site), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. Needs a careful test with the Twitch embeds and `/prezentare` before deploy.

### B-11 · No stale marker after data has loaded
If polls fail after the first load, the clock keeps counting down from the last known end, without the time added meanwhile, and nothing says so. Suggested: after 2 failed polls, show «Reconectare…» next to the clock; clear it on the next good poll (`onConn` already reports the count).

### B-12 · Suggestion limit can be raced
`suggest` counts then inserts without a lock. **Fix (migration):** advisory lock per viewer.

### B-13 · An empty freeze erases the end time
`freeze_timer(null)` sets `ends_at = ends_at + null = null`: the clock shows `--` and `record_event` adds nothing while `ends_at` is null. Reachable only by a moderator calling the RPC directly (or `mod_freeze_until(null)`), but unrecoverable without SQL. **Fix (migration):** `bad_minutes` for null or ≤ 0.

### B-14 · /mod without a fallback when Realtime drops
The console reloads only on Realtime messages and after its own actions. After a laptop sleeps or Wi-Fi changes, the socket reconnects silently but nothing reloads, so «Intră acum», totals and the timer card can be minutes old. Suggested: reload on return to the tab and every 30 s while visible (safe now that typed values survive, B-04).

### B-15 · `check-sub`: no throttle, silent failures
Any logged-in viewer can call `check-sub` in a loop; each call is a Helix request on Iceman's token, which `watch-time` also needs (Twitch allows about 800 points per minute per token). On the page, «M-am abonat, verifică iar» shows nothing when Twitch says "not subscribed" or when the call fails. Suggested: skip Helix if `sub_checked_at` is under 30 s old; return the answer and show «Încă nu te vedem abonat…» or «Twitch nu răspunde acum…».

### B-16 · `community_goals` privileges
`anon` and `authenticated` have INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER on `public.community_goals`. RLS (one SELECT policy) blocks writes through the API and TRUNCATE isn't exposed, so this is hygiene, not an exploit. **Fix (migration):** revoke everything but SELECT.

### B-17 · Empty lists ignored
`live.ts` applies `goals` and `prizes` only when the list isn't empty, so if moderators delete every milestone the site keeps showing the 12 placeholder milestones from `content.ts`. Suggested: apply empty lists and show «Milestone-urile apar în curând».

### B-18 · Resubs that aren't shared add no time
EventSub sends `channel.subscription.message` only when the viewer shares the resub in chat; there is no event for a silent resub. Worth telling viewers on stream («dă share la resub ca să adauge timp»), and putting it in the «Cum adaugi timp» chips.

### B-31 · The calculator promises time before the start
`record_event` sets the added seconds to 0 unless `timer.status = 'live'`, so a donation before 20 Dec counts toward «Strâns» and milestones but not the clock. The hero calculator still shows «+30 min» (≈ «cam un meci ranked») while the page says «ÎNCEPE CURÂND». Either change the calculator's text before the start, or bank the time into the opening duration (database change). See [UX_AUDIT.md](UX_AUDIT.md) V3.

## Low

- **B-19** `spins` has a public SELECT policy and `authenticated` can read the table, so the logins of viewers whose names are hidden can be listed. Suggested: drop the policy (the page uses `public_state`).
- **B-20** `redirectTo` is `origin + pathname`; add `location.hash` (Supabase keeps it) or store it before the redirect.
- **B-21** Late start: say «Începe în curând» instead of `00:00:00:00` once `starts_at` has passed.
- **B-22** Vote triple click → 3 requests; harmless (the second and third are no-ops), could reuse the same guard.
- **B-23** `start()` and `onAuthStateChange` both call `my_state`; one request is enough.
- **B-24** Badge tags 31 px tall, /sponsori step buttons 36 × 36, /mod brand link 33 px: below the 44 px rule (inline text links are exempt).
- **B-25** Placeholders on the live site: «[DATA DE START]» in the ticker while loading (the fallback when no start date is known), «[EMAIL CONTACT]», the LOGO slot, «[Partener 1–4]», `#` links (Discord, donate, socials). Waiting on the owner's content.
- **B-26** No limit or review for huge donations; a charged-back donation keeps its time. Moderators can remove time by hand (−5 min, custom negative).
- **B-27** `broadcasterToken()` refreshes in whichever function sees it first; two at once both refresh. It has worked so far; a lock in the database would make it certain.
- **B-28** `slice(0, 140)` can cut a surrogate pair; use `Array.from(text).slice(0, 140).join('')`.
- **B-29** Add an `<h1>` («Moderatori») to the /mod login card.
- **B-30** `mod_set_moderator` lets any moderator remove anyone; consider protecting the broadcaster login.

- **B-32** `views.ts` `together()`: the hours of goals not yet reached use `#4A5568` (2.6:1) at 18 px. Use `#8C97A8` (6.6:1) or `#7D8899` (5.5:1); see the text tokens in [DESIGN.md](DESIGN.md).

## Notes, not bugs

- **Load:** with 2,000 open tabs the site makes about 250 `public_state` calls per second (each a primary-key read). Fine for Supabase Pro; if it ever isn't, a Cloudflare cache of 2–3 s in front of the call would cut it by 99 %.
- **Supabase plan:** upgrade to Pro before 20 Dec (already in CLAUDE.md); the free plan pauses after a week without activity.
- **Applying the migration** `supabase/migrations/20261126100000_bug_fixes.sql` needs the owner's OK. Every function keeps its signature, so grants stay as they are. The PL/pgSQL error paths (`raise`) couldn't run in PGlite on this Node version and were checked by reading; run them once inside a rolled-back transaction after applying.

## Proposals for the next round

1. Add **Playwright** as a dev dependency with the scenarios used here (widths, mocked states, double submits, /mod typing, outage, reduced motion) as `npm run e2e`. It drives the installed Chrome, so no browser download is needed. Needs the owner's OK to add the dependency.
2. Fix B-08 (zero), B-11 (stale marker), B-14 (/mod refresh) and B-15 (check-sub) next: they matter most on the night.
3. Security headers (B-10) with a test on `/`, `/prezentare` and the Twitch embeds before deploying.
