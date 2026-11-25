# ICEMARATON: Icemanlucky's Christmas subathon website

A one-page website for **ICEMARATON**, Icemanlucky's Christmas subathon on Twitch (twitch.tv/icemanlucky). The audience is Romanian, so **all copy visitors see is in Romanian**, with correct diacritics (ă â î ș ț; comma-below ș/ț, not cedilla).

The design was made and approved on a Claude design canvas. This folder is the handoff. The job is to turn it into a real website hosted on **Cloudflare** (moved from GitHub Pages on 23 Nov 2026), connected to Twitch through Supabase.

## What's in this folder

| Path | What it is |
| --- | --- |
| `design/Main.dc.html` | The full page design, desktop and responsive. **Source of truth, but not runnable** (see below). |
| `design/Mobile.dc.html` | Phone preview: just embeds `Main` at 390 px. |
| `design/canvas.json` | Canvas layout metadata. Ignore when building. |
| `docs/design-spec.md` | Tokens, sections, components, viewer states, motion, sponsors. **Read first.** |
| `docs/twitch-integration.md` | Plan for the Twitch connection (phase 2). |
| `docs/provocari.md` | The 128 challenges for the subscriber vote (Romanian). |
| `data/challenges.json` | The same challenges as data, for the vote. |
| `assets/` | Images (mapping below). |

Design canvas (view only, needs the owner's login): https://claude.ai/artifact/39SN3ozeFAxReR888JHMC1
Editable challenge doc: https://claude.ai/artifact/HzwNnbef5m6ERgZbYScAD9

Keep `design/`, `docs/`, `data/` and `assets/` in the repo as the project's source material. Put the site's code next to them (for example `src/`, `public/`).

## Reading the `.dc.html` design files

They use a canvas template format, not plain HTML:
- `{{ name }}` holes are filled by `renderVals()` in the `<script type="text/x-dc">` block at the bottom.
- `<sc-for list="{{ items }}" as="x">` is a loop; `<sc-if value="{{ flag }}">` is a conditional.
- `<helmet>` holds the global `<style>` (including the container queries and keyframes) and the Google Fonts link.
- `onClick="{{ fn }}"` binds a handler returned from `renderVals()`.
- `cqi` units are relative to the page root, which is a size container named `page`.

Port the markup to real components. Keep the copy word for word, the inline styles' values, and the behaviour. All sample data, state and interaction logic is in `renderVals()` and the class above it.

Image URLs in the design point at canvas storage. Map them to local files:

| In the design | Local file |
| --- | --- |
| `/_blob/fdb28448ea20fa6ee2bfb36839de93b1` | `assets/logo-mascot.webp` (logo art, background removed) |
| `/_blob/4a0a8e515f18766f6131f0c70cd3ee44` | `assets/emote.png` |
| `/_blob/d3c4e68d7cabe7b6c1942a2bc2f4d053` | `assets/streamer-photo.webp` (not used on the page right now) |

`assets/logo-original.png` and `assets/streamer-photo-original.png` are the untouched originals; don't ship them in the build.

## Hosting: Cloudflare

The site is served by **Cloudflare Workers (static assets)** at **https://icemanlucky.ro** (also www.icemanlucky.ro; both are Custom Domains on the `icemaraton` Worker, account "Fulgathon", since 23 Nov 2026). The original https://icemaraton.icemaraton.workers.dev still works. It was on GitHub Pages until 23 Nov 2026.

- Static files only: Astro builds to `dist/`, no server code (`wrangler.jsonc`).
- Deploy from this computer with `npm run deploy` (build + `wrangler deploy`). Pushing to GitHub does **not** deploy; the GitHub repo only keeps the code.
- Base path is `/`. `SITE_URL` in the deploy script (https://icemanlucky.ro) sets canonical/OG links.
- Supabase → Authentication → URL Configuration: Site URL https://icemanlucky.ro; Redirect URLs must list every address people log in from (`https://icemanlucky.ro/**`, `https://www.icemanlucky.ro/**`, the workers.dev one while it's used), or Twitch login falls back to the homepage.
- Suggested stack (confirm with the owner before starting): **Astro** with static output and plain CSS, a small amount of client-side JS for the interactive parts. Vite + vanilla TypeScript is a fine alternative. Avoid anything that needs a server at runtime.
- Phase 2 needs a backend, which can't be a static host. Plan it as a separate service (for example Supabase or Cloudflare Workers) that the static site calls. See `docs/twitch-integration.md`.

## First task: phase 1

Build the static site so it matches the design, with every interaction working on the sample data in `renderVals()`:

1. Scaffold the project and the deploy (now Cloudflare, `npm run deploy`).
2. Build the page section by section in the order of `docs/design-spec.md`.
3. Make the interactive parts work client-side: live countdown, mobile menu, viewer-state switch (logged out / not subscribed / subscriber), vote with "move vote", spin wheel, bingo, suggestion form, toasts, leaderboard tabs, copy-code button.
4. Keep the sample data in one module (for example `src/data/sample.ts`) so phase 2 can swap it for live data.
5. Before calling it done: check it at 390, 768, 1280, 1440, 1920 (full HD), 2560 (2K) and 3840 (4K) px wide (above 2400 px the public page scales itself up with `zoom`, see the end of `src/styles/v2.css`); the navbar must stay on one row; check `prefers-reduced-motion`; run a Lighthouse pass for accessibility and performance.

**Phase 2: Twitch connection.** Real timer, subs, goals, leaderboard, live status, login with Twitch, subscriber-only voting, watch-time spins, sponsors from config. See `docs/twitch-integration.md`.

## Rules

- Romanian copy everywhere visitors see it. Code, comments and docs can be English.
- Owner's choice: the English words **subs** (not "suburi"), **LIVE** (not "În direct") and **SUBSCRIBE** (the hero button, not "Dă un sub") are used on the site.
- Keep the look: near-black, electric ice blue (`#3FD0FF`), white; Barlow Condensed italic display type; square corners; snowfall. The owner rejected softer, playful versions as "girly", "AI-looking" and "not professional". Don't drift back to rounded cards, pastels, red-and-white candy-cane stripes, Christmas light strings, chrome lettering or gradient-wash backgrounds.
- The owner explicitly asked for: the snowfall, the white-to-ice gradient on "ICE" (not chrome), the emote in the middle of the spin wheel, and a **navbar that always stays on one row**.
- Sponsors stay calm and professional: logos on dark panels, no flashing.
- Every animation needs a `prefers-reduced-motion` fallback.
- Text contrast at least 4.5:1, touch targets at least 44 px, real `<button>`/`<a>`/`<label>` elements.

## Decided

- **Name:** ICEMARATON (Iceman + maraton), renamed from FULGATHON on 22 Nov 2026; the design files in `design/` still show the old name. Snowflakes remain the visual theme (and mark each 30 minutes watched toward the daily wheel). Band line: "Fiecare sub e un fulg. Facem viscol."
- **Hosting:** Cloudflare Workers static assets at https://icemanlucky.ro (custom domain from 23 Nov 2026; workers.dev still works), deployed with wrangler from this computer; backend on Supabase.
- **Dates:** 20 Dec 2026 12:00 → scheduled end 10 Jan 2027 12:00 (Romania time), set in the database (moderators can change them on /mod).
- **Time rates (23 Nov 2026):** 1 € donation +6 min, Tier 1/Prime +6, Tier 2 +12, Tier 3 +18, gift sub +6 each, 400 bits +4. Focus on donations over subs.
- **Milestone Maraton** (was "Obiectivele de Crăciun"): challenges unlocked by the donation total in euros; Iceman and moderators edit the list on /mod.
- **Wheel:** subscribers only; 2 hours watched in the same day (chat presence, Romania calendar day) = 1 spin per day, until the end. Server enforced.
- **Bingo (prediction game):** moderators (Iceman included) open and close it on /mod («Deschide acum» / «Închide alegerile acum», or planned times); no dates in code (24 Nov 2026). While open every viewer logged in with Twitch picks one line (5 events) and can change it until the close. After the close (and only then, so late joiners can't pick a line already ticked) moderators tick events on /mod and the automatic ticks count only what happens after the close; the card stays on the site until the end of the marathon. Once anything is ticked the open/close times are final; the draw (/mod «Trage la sorți», any moderator) is picked by the server first, then the OBS piece «Tragerea la bingo» (`?part=draw`, 960×540) plays a reel of every entry that stops on the winner («Arată din nou» replays it), and the site shows the winner(s) and «Ai câștigat…» to the winner; everyone whose 5 all happened goes on the raffle list and a moderator draws the winner on /mod (recorded).
- **Bingo card size (25 Nov 2026):** moderators write the card on /mod → ACTIVITĂȚI → Bingo and pick its size: 3×3, 4×4 or 5×5 (9, 16 or 25 events); a line is a row, a column or a diagonal of that size. Nothing in code defines the events (the old sample list is gone; the demo has its own example). After the first pick the size and order are locked, renames only. `src/lib/bingo.ts` + migration 20261215100000.
- **Freeze 20–25 Dec:** the marathon starts 20 Dec, then Iceman freezes it (working week) with "Îngheață până la" on /mod; subs and donations still add time during the freeze.
- **Sponsor promotion (23 Nov 2026):** sponsored Ora dublă, sponsors on prizes/milestones/bingo («de la …»), secret codes on stream for bonus spins, a quiet partner mention in the overlay every 10 min, and a per-sponsor report on /mod. Later: sponsor matching donations, sponsor segments, community goal with a sponsor prize pool. Never let donations buy raffle chances (gambling rules); keep draws free to enter.
- **Sponsor placement:** main sponsor in the middle of the row under the timer (Strâns · Prezentat de · Următorul milestone).
- **Donations:** TipeeeStream (account icemanlucky, page https://www.tipeeestream.com/icemanlucky/donation, behind the «Donează» buttons), in euros. Twitch never sees them; the `tipeee-donations` Edge Function polls TipeeeStream every 15 seconds.
- **Length (24 Nov 2026):** 22 days planned, 20 Dec 2026 → 10 Jan 2027, but it must stay flexible: the timer decides, and Iceman or the mods freeze it on demand from /mod.
- **Scale:** at the last subathon Iceman had about 46,800 unique viewers and around 500 concurrent on Twitch alone. Multistreaming would make it bigger.
- **Plans:** Supabase stays on Free for testing. Iceman agreed to **Supabase Pro** for the event, so upgrade before 20 Dec. Cloudflare stays on Free: static assets are free and unlimited.
- **Legends:** a live top 3–5 per category (donors in €, gifted subs), with cumulative totals. Whoever has given the most so far holds the spot until someone passes them. A viewer who gives €25 today and €50 tomorrow has €75.
- **Public names:** shown (people already show them on Twitch). The viewer «Ascunde-mi numele» option was removed on 23 Nov 2026 (owner: not needed); moderators can still hide a name on /mod.
- **Channel points:** Iceman is a Twitch Partner, so channel points and custom rewards are available.
- **Zero is final (23 Nov 2026):** once the clock reaches 00:00:00:00 the marathon is over. Nothing adds time after that (subs, donations, mod «+min» and freeze are refused), and the site shows «Timpul a expirat» instead of LIVE. See BUGS.md B-08.
- **«Camera de control» + «Donează și alegi» (24 Nov 2026):** a full OBS scene at `/overlay/?scene=control` (1920×1080, `src/scripts/scene-control.ts`): the background photo uploaded on /mod → SETĂRI → Overlay OBS (Storage bucket `scene`, part 'scene') is drawn by the overlay itself with the game and webcam places cut out (2K source 2560×1440, the owner's canvas: game 1536×864 at 77,72, webcam 691×388 at 1767,72; the scene is drawn on a 1920×1080 grid and scales to the source, 1920×1080 = game 1152×648 at 58,54, webcam 518×291 at 1325,54), so in OBS the game and webcam sit under this one source; without a photo the scene is transparent. The sponsor strip is frosted glass (real blur over that photo). /mod's «Scena întreagă» list shows only this scene now (owner, 24 Nov; the old ?show/?style/brb links still work if already in OBS). the timer, the sponsor strip (main partner fixed; partners and supporters two at a time, sliding every 8 s; logos only, no labels), and snow that stays faint and reacts to each event (sub, bits, donation by amount, gift wave = blizzard). «Donează și alegi» is a fixed price list, NOT a goal that fills: one donation of exactly a listed amount (EUR, while live) puts that task in a queue with the donor's name; other amounts only add time. Moderators tick «Făcută» and edit the list on /mod → ACTIVITĂȚI → Donează și alegi. Owner's list: 5 € Alege linia, 10 € Alege un campion, 25 € Alege 3 campioni, 50 € Joacă cu o mână. Migration 20261211100000.
- **Overlays at 2K (24 Nov 2026):** the owner's OBS canvas is 2560×1440. Every overlay fits its Browser Source by itself: the full scene, «Revin imediat» and «Camera de control» are laid out on a 1920×1080 grid and scaled (2K = ×4/3); each `?part=` piece scales to its source from its `overlayPieces` size (/mod lists the 2K size, w×4/3, with the 1080p size in brackets). Sources set at 1080p sizes look as before; `&scale=` multiplies on top.
- **Obiectiv comunitar deleted (24 Nov 2026):** the community goal (hours watched together unlocking things) is gone from /mod (card + checklist line), the site («Comunitatea» shows only «Contribuția ta») and the overlay; the overlay's «Ore împreună» panel (hours together + «Adăugat azi», piece and full-scene part) was deleted too (an old `?part=together` link loads an empty page). The table `community_goals` and `mod_set_community_goals` are left unused; don't bring the feature back.
- **Stream drops (24 Nov 2026):** if Iceman's stream goes offline while the marathon is LIVE, everything keeps counting (Twitch EventSub and the TipeeeStream poll don't depend on his connection; the site stays LIVE) and the clock keeps running down. No automatic freeze (owner): a moderator freezes by hand (ACUM → Stream acum → «Îngheață») and unfreezes when he's back. Only watch time and the daily vote round wait for the stream.
- **Prelungește (25 Nov 2026):** the planned end («Final programat») is only a label; the countdown clock decides when the marathon ends (zero is final). While LIVE, Iceman (any moderator during «Mod test») moves the planned end later on /mod → STREAMER → Prelungește (+1/+3/+7/+14 zile or a date), as often as he wants, and the clock gets the same extra time (owner: «Date and clock»; 17 → 25 Jan = +8 days, even if subs already pushed the clock further). Never ends or restarts anything; no feed event (no «+11520 min» on the overlay); Discord alert. `mod_extend`, migration 20261214100000.
- **Iceman is protected (23 Nov 2026):** no moderator can remove or demote the broadcaster login (icemanlucky) on /mod. See B-30.
- **Only Iceman starts, extends and ends (24 Nov 2026):** «Pornește acum», «Prelungește», «Încheie subathonul…», switching auto start on/off and moving the start while auto start is on are allowed only for the broadcaster login; moderators see them disabled and the database refuses them (`only_broadcaster`). Moderators keep every other control. Since 25 Nov 2026 all of them live in their own /mod menu group **STREAMER** (owner: generic words, /mod will become a template) (Start: streamer account, dates, auto start + hours, «Pornește acum»; Prelungește; Încheiere); PROGRAM → Automat keeps only the daily vote.
- **Euros only (23 Nov 2026):** only EUR TipeeeStream donations add time and count toward Strâns; no conversion table. A donation in another currency goes to /mod «De făcut acum» for a moderator to handle by hand. See B-09.
- **Resubs without sharing (24 Nov 2026):** resubs count even when the viewer doesn't press Share: the site reads the subscriber badge months in chat and counts an increase as a resub (no double counting with shared resubs or new/gifted subs). Viewers who never chat can't be seen. Gift subs add time for the gifter; the recipient counts as a subscriber at once. See BUGS.md B-18.
- **/mod on autopilot (24 Nov 2026):** Iceman has at most 3 helpers, so /mod was split by how often it's used (since 25 Nov 2026 by what things are, see «/mod menu») and as much as possible runs by itself: optional auto start, a daily vote round opened automatically, Ora dublă / secret codes / freezes planned ahead, bingo auto-ticks for events the site can see, suggestions that refuse links, blocked words and duplicates, a Twitch clip on «Făcută», Discord alerts for whatever needs a person, and a shared preparation checklist. The moderators' guide is the doc «ICEMARATON · Ghidul moderatorilor» (https://claude.ai/artifact/N6cMZBE8Tuma1PMJAsVg2g).
- **Overlay in pieces (24 Nov 2026):** Iceman composes his own OBS scenes per game, so each overlay panel is a separate Browser Source (`/overlay/?part=…`); the full 1920×1080 scene stays available. Piece list and sizes: `overlayPieces` in `src/data/content.ts`.
- **Cronometrul overlay (24 Nov 2026):** the timer piece is the one always on stream, so it stays small (340×130, owner: must not cover games) and alive: odometer digits, the clock spins up with a shockwave and ice shards when time is added, a band with **icemanlucky.ro** always shown (rotating lines: VOT · ROATĂ · BINGO, freeze end, Ora dublă minutes left). Frozen = frost creeping in, icicles, pale digits. Ora dublă = fire and warmth (owner: hot and limited), ignition then flames and embers; this orange is only for Ora dublă, everything else stays ice. Demo previews: `/overlay/?demo&part=timer&state=live|frozen|double|upcoming|ended`.
- **Sponsors on /mod (24 Nov 2026):** /mod → SPONSORI → Sponsori edits every sponsor: tier, name, logo upload (Storage bucket `sponsors`, moderators only, max 2 MB), what they back, description, link (UTM tags on by default), button text, discount code + what it gives + offer end, overlay line, Iceman's talking points, socials, site/overlay switches, visibility window, and private contact + agreement notes. The site (Prezentat de, Împreună cu, the offer bar, the partner wall) and the overlay partner line read them live (part 'sponsors'); until anything is saved there the page uses `src/data/site.ts`. Empty partner/supporter slots stay visible as «LOGO». Migration 20261204100000.
- **Repetiție removed from /mod (24 Nov 2026):** the practice clock («Pornește repetiția») and the «Testează pe stream» buttons were taken off /mod (owner): «Mod test» covers both with real events (clock, freeze, Ora dublă, donations, «Donează și alegi», sample sponsors). The database functions (`mod_rehearsal`, `tipeee_rehearsal`, `mod_overlay_test`, parts 'rehearsal'/'otest') and the overlays' handling of them are left in place, unused; don't rebuild a UI for them.
- **Mod test (24 Nov 2026):** /mod → SETĂRI → «Mod test» (any moderator, only while the timer is 'upcoming') saves every table in public/private into the schema `test_backup`, then the whole site, /mod, the OBS pieces and the cron jobs run the real code on fake data (yellow «TEST» bar on the site, TEST tag on the overlay timer). A strip on top of /mod adds fake subs, gifts, bits, donations, 25 fake viewers (they watch, vote, pick bingo, suggest), «Eu: abonat», «Eu: +2 h privit», stream LIVE. During a test any moderator may start/end the (test) marathon, Twitch chat lines and clips are off, Discord alerts say «TEST». «Oprește testul», or by itself at the chosen time (at the latest 30 min before the real start), puts every table back exactly, deletes the fake viewers, keeps real accounts. Never copied or restored: `private.test_keep()` (moderators/settings, prep checklist, TipeeeStream read position, cached public state, viewers' accounts). New tables are included automatically; add identity or preparation tables to `test_keep()`. Migration 20261209100000.
- **/mod menu (25 Nov 2026):** owner: «make it make sense, so I know where everything is». One home per thing, grouped by what it is: **ACUM** (Stream acum, Programate) · **ACTIVITĂȚI** (Vot with suggestions and the daily auto vote, Roata, Bingo with ticks + draw + settings on one page, Donează și alegi, Milestones) · **PREMII** (De dat, Tombole, Unde se câștigă) · **SPONSORI** (Sponsori, Raport) · **SETĂRI** (Checklist, Replici, Overlay OBS, Alerte Discord, Moderatori, Mod test) · **STREAMER** (Start, Prelungește, Încheiere). No item appears twice; old anchors redirect (`ALIAS` in `src/scripts/mod.ts`). New features get a home in this scheme, not a new group.
- **Vote round = exactly 5 of one level, 24 hours (25 Nov 2026):** owner: «never less or more», and no more 2 easy / 2 medium / 1 hard. Moderators pick the level (Ușor / Mediu / Greu) for a round opened by hand; «Alege altele» draws 5 of that level only (different categories first). The daily auto round has its own level in «Votul automat» (`private.autopilot.vote_level`). Rounds last 24 h by default (1–48 h). While open only «Schimbă» changes it; a new challenge takes a chosen place («În locul»). The database refuses other sizes (`round_needs_five`); with fewer than 5 of the level left the auto round doesn't open (Discord alert). The winner waits in «Provocări câștigătoare» and «De făcut acum» until a moderator adds the clip link and presses «Făcută». Migrations 20261217100000, 20261218100000.
- **Tombole + «Premii de dat» (25 Nov 2026):** moderators add raffles on /mod → PREMII → Tombole (prize, optional sponsor, who is on the list: everyone logged in with Twitch, subscribers only, or everyone with at least N hours watched in total, incl. chat-only viewers). Always free: the list builds itself, donations never add chances; the streamer is never on it. Three ticks per raffle (owner: «full control», migration 20261219100000): moderators on the list too (off by default), people who won another raffle (on), the same person can win this raffle again (off); they can change any time and act on the next draw. «Trage la sorți»: the server picks (no repeat winner per raffle), the OBS piece «Tragerea la sorți» (`?part=draw`, same reel as bingo, header TOMBOLĂ) plays it, the winner sees «Ai câștigat la tombolă» on the site and the win joins «Ultimele premii». PREMII → De dat is one list of every win (wheel, bingo, raffle) with «Dat». Migration 20261216100000.
- **Raffles with channel points (25 Nov 2026):** a raffle's rule can be «Cine răscumpără recompensa pe Twitch» with a points cost. The site creates the reward on Twitch (Edge Function `raffle-reward`, called by /mod after any raffle change; the streamer's token needs `channel:manage:redemptions`, so he reconnects once) and deletes it as soon as entries close («Închide înscrierile», or at the latest the first «Trage la sorți») or the raffle is deleted; entries stay saved for «Trage încă un câștigător». One entry per person: twitch-eventsub marks the first redemption FULFILLED and gives points back (CANCELED) for extra, late or test-mode ones. Channel points can't be bought, so entry stays free. Migration 20261220100000, `_shared/raffle.ts`.
- **Minimal site and /mod (24 Nov 2026):** removed from the site the Advent calendar («Program și cronologie»), the embedded Twitch player and «Timp adăugat azi» (Fidelii stays). /mod keeps only what a person must do: «Stream acum» bundles time, freeze, Ora dublă, secret code and the site note; the public-names, badges, legends and partners cards are gone (the name filter and badges still run by themselves).

## Open (ask, don't guess)

- **Prizes:** wheel prizes, "Ora dublă" schedule; the bingo prize (a sponsor product; set it on /mod → Bingo).
- **Multistreaming:** whether watch time from other platforms (YouTube, Kick, TikTok) should count; see the note in `docs/go-live.md`.
- **Sponsors:** (now edited on /mod → Sponsori) no main sponsor is signed yet, so the site and /mod show the neutral **Sponsor Principal** (24 Nov 2026: the owner's earlier example «Zona IT» was removed everywhere, since it may not be our sponsor; never show a brand name before it's confirmed). "SPONSOR PRINCIPAL" is plain text standing in for the official logo. Still needed: names, logos (ideally SVG plus all-white versions), links, tiers (main partner / partners / supporters), what each one backs, the discount code (`ICEMAN10` is a placeholder) and the contact email for new sponsors.
- Discord invite, social links, repo name.
