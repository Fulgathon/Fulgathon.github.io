# Handoff: layout v2, a new /mod, and a richer overlay

Written 23 Nov 2026 at the end of the mockup round. The owner approved the new layout on the Design canvas and asked for three things:

1. Build the new public page from the mockup.
2. Redesign **/mod** to the same standard: organised, clear, and as rich as the new page.
3. Make the **OBS overlay** much more creative, using everything the site now knows and can push to it.

Read `CLAUDE.md` first. All of its rules still apply.

## Source material

- **Design canvas (approved):** https://claude.ai/artifact/2wFduAUjgPWPi5qUJnXjHd. It's private to the owner. Read it with the Artifact tool, and see the comment threads for the reasoning behind each choice.
- **Local copy of the canvas:** `design/layout-v2/`
  - `Main.dc.html`: desktop, 1440 px
  - `Phone.dc.html`: phone, 390 px
  - `Festive.dc.html`: the "festive but restrained" rules sheet
  - `Badges.dc.html`: badge tiers
  - `Mod.dc.html`: the /mod editor for Iceman's lines
  - `canvas.json`: holds the numbered notes that explain the page order
- Same `.dc.html` format as `design/Main.dc.html` (see CLAUDE.md, "Reading the .dc.html design files"). The hero and the calculator have working state and handlers in the `Component` class. Port the behaviour, not just the look.
- **Image blobs in the v2 files:**
  - `/_blob/51e59ce68f7aa662cd8f9d2d578e0105` = `assets/logo-mascot.webp`
  - `/_blob/713780c343892b89eac96649ced1b2fe` = `assets/emote.png`
- The sample names, amounts and Iceman's bubble lines in the mockup are **placeholders**. Never ship invented lines in Iceman's voice (see "Iceman's voice" below).

## Decisions made in the comment round (all approved)

**Whole page**
- The LIVE strip (newest donors, gifters, subs) and the one-row navbar stay **sticky** at the top. The nav has no wordmark, just «TIMP RĂMAS» + clock + links.
- Snow over the whole page, sparse, off with reduced motion. No drawn snowdrifts.
- The eyebrow above the title reads «STREAM MARATON 2026–2027».

**Hero: a live stage**
- Desktop has three columns:
  - left: «INTRĂ ACUM», the newest 4 events, the newest one sliding in;
  - middle: the Iceman illustration hops slightly on each event and reacts in a white speech bubble: a small «MERSI, {NUME}!» line plus one of his lines;
  - right: «Cât adaugi tu?».
- The timer ticks; on each event it jumps by the added time, the digit boxes flash ice blue and a «+18:00» tag pops above them.
- «Cât adaugi tu?» is a calculator:
  - options 5 €, 10 €, 25 €, Sub T1, Sub T3, 5 gift;
  - it shows «+30 min», where the timer would land, and a light «≈ …» equivalent;
  - **one button that says only «DONEAZĂ»**. The owner said users don't care where they pay.
- Display line: **«Voi decideți cât durează.»** («cât durează.» in the white-to-ice gradient), with «Fiecare sub și fiecare donație adaugă timp pe cronometru» under it. Slang like «dați hype» was rejected as cringe.
- Phone:
  - the bubble sits on the illustration, with one «intră acum» strip at its bottom;
  - the timer pops the same way;
  - the full calculator card sits under the timer, with DONEAZĂ as the main button and «Urmărește live» secondary.
- Rate chips («Cum adaugi timp») and «Prezentat de» with a **logo slot next to the sponsor name** stay in the timer card.
- Reduced motion: nothing animates, the values just update.

**01 Parteneri:** main partner card, 4 partner tiles, a row of 6 «Susținători».

**02 Comunitatea: three rows read top to bottom** (the old side column was "all over the place")
1. One band: Contribuția ta (time added, stats, badges as emblems «Insignele tale · 2 din 6», thank-you line) + Obiectiv comunitar (hours in chat for everyone together, bar, next goal).
2. Legende: three equal panels (Donatori, Subs dăruite, Biți), top 5, cumulative totals:
   - place 1 is the **prism** card;
   - places 2/3/4 are **gold/silver/bronze**;
   - place 5 is grey.
3. Timp adăugat azi + Fidelii: two equal panels. Fidelii ranks use the same prism/gold/silver/bronze order.

**Badges** (see `Badges.dc.html`)
- Real badges, not outlined text:
  - big hexagon emblems in Contribuția ta;
  - slanted tags with an icon block in lists;
  - not-yet-earned ones are grey with progress («4 din 7 zile»).
- **Tooltip on hover, focus and tap:** the name, «Cum o obții:» + the exact rule, and «O au N oameni din chat». The point is that people can copy what the top viewers did.
- Five difficulty tiers, the six badges in order of difficulty:
  1. Bronz (ușor): ZIUA 1 OG, 10 ORE
  2. Argint (mediu): TURA DE NOAPTE
  3. Aur (greu): SERIE DE 7 ZILE
  4. Platină (foarte greu), **teal-green**: 50 DE ORE
  5. Prismă (legendar): 100 DE ORE
- Prism = one smooth cool gradient (#9FE8FF → #A9B8FF → #E2B6FF → #FFD6C2 → #C8FFE9), with no hard stripes and no rainbow order (it must not read as a flag), and **no white glare**.
- The rules match `private.loyalty` in `supabase/migrations/20261124210000_checkins.sql`.

**03 Milestone Maraton: three steps** (the first version was too much at once)
1. One track with all 12 milestones as numbered steps:
   - done = ice blue with ✓ and «CLIP»;
   - unlocked = white «URMEAZĂ LIVE»;
   - next = glowing «URMĂTORUL»;
   - the rest grey;
   - amounts under the steps, names on hover.
2. One big card for the next goal with its bar and «mai sunt N €», plus one line about the unlocked one that hasn't happened yet.
3. «Ai ratat? Vezi clipurile»: a simple list of finished milestones with a thumbnail and «Vezi clipul →», so late viewers can catch up. Mods paste the clip link on /mod, like completed vote challenges already do (`Completed.clip`).

**04 Joacă:** all four games are always visible, **no tabs**.
- The wheel is full width and first:
  - 12 slices = **categories**, not single prizes, since names stop being readable past about 12;
  - partner slices in gold, the emote in the middle;
  - the full prize list next to it on desktop, behind «Vezi toate premiile» on phone.
- Vote and Propune side by side.
- **Bingo full width**, so every square holds its sentence:
  - 5×5 with the real 25 events from `src/data/content.ts`;
  - arrows for row, column and diagonal, as on the live site;
  - the chosen line has an ice border, and squares that happened show «✓ S-A ÎNTÂMPLAT»;
  - a side panel with «Linia ta · 2 din 5», prize, deadline and «Salvează linia»;
  - phone: the full 5×5 with small text, plus the chosen 5 listed again at full size underneath.

**05 Live:** the player moves down and loads on request.

**06 Program și cronologie:** an Advent calendar of the 22 days (past = open with the day's clip, today = lit, future = closed with what's scheduled; sponsors can appear on their days).

## Iceman's voice and the bubble lines (approved)

- The mods will write the lines. Add a **«Replicile lui Iceman»** editor on /mod (see `Mod.dc.html`):
  - 6 groups: Sub T1/Prime, Sub T2/T3, Subs cadou, Donație mică (< 10 €, threshold to confirm), Donație mare, Biți;
  - one line per row, at least 5 per group;
  - placeholders {nume} {timp} {suma} {subs};
  - max 70 characters;
  - a live bubble preview;
  - a group under 5 lines is marked yellow and falls back to «Mersi, {nume}!».
- The site picks a random line with no repeat until all are used. Names go through `public_name`.
- **Twitch chat:** a /mod switch «Trimite replica și în chatul Twitch» sends the same line to chat with @name and the time added.
  - At most 1 message every 5 s; a gift wave gets one message.
  - It is off until the owner answers the open questions below.

## New: /mod in the same standard

The owner wants /mod redesigned "in this complex fashion": the same visual system as the new page, organised, nothing all over the place.

Suggested structure (propose it on the canvas first, see "How to work"):
- **Top status bar:** LIVE/offline, timer and its state (running / frozen until … / Ora dublă), health of each data source (EventSub, watch-time, TipeeeStream, state cron), last event.
- **Left nav, grouped by job:**
  - **Live:** timer, freeze, Ora dublă, «Acum pe stream» note, moments queue.
  - **Content:** Replicile lui Iceman, milestones (with clip links), community goals, Advent days (clip + what's scheduled), vote rounds and completed challenges.
  - **Games:** wheel prizes and categories, bingo ticks / close / draw, codes.
  - **People:** names (hide / blocked words), badges overview, legends.
  - **Sponsors:** tiers, logos, per-sponsor report.
  - **Overlay:** see below.
- Every existing /mod feature must survive (`src/scripts/mod.ts`, `src/pages/mod.astro`). Same RPCs, same security: moderators only, RLS and security-definer RPCs, nothing new readable by anon.

## New: a much more creative overlay

The owner: "we can play with so much more in there." Today the overlay (`src/pages/overlay.astro`, `src/scripts/overlay.ts`) has:
- the alert queue (big moments: 20+ gifts, 50 €+, 5,000+ bits);
- «LEGENDĂ NOUĂ»;
- the wheel win pop-up with the sponsor line;
- a quiet partner mention every 10 min.

Ideas built on data the site already has (pitch a set, let the owner pick):
- **Iceman's bubble on stream:** the same /mod lines, next to a small mascot in a corner.
- **Living timer:**
  - jumps with «+timp» and an ice flash;
  - frost creeps over it when frozen («Îngheață până la …»);
  - an x2 glow during Ora dublă.
- **Gift-sub wave = snowstorm:** snow density follows how many gifts came in the last minute, with a short «VISCOL» banner on big waves.
- **Milestone moments:** the bar fills live; on unlock, a full-width banner «MILESTONE 06 DEBLOCAT · Karaoke cu colinde».
- **Legend takeover:** when someone takes place 1, a prism sweep with their name. Also gold/silver/bronze changes.
- **Badge moments:** someone reaches Platină or Prismă (50 h / 100 h), with a short emblem reveal.
- **Bingo live:** when a mod ticks an event, «S-a întâmplat: Rage quit · N jucători mai au linia întreagă».
- **Vote live:** bars move during a round, and the winner is announced.
- **Wheel on stream:** when a subscriber spins on the site, the wheel spins on the overlay too, with the emote in the middle.
- **Community goal and channel-points check-ins:** a counter of check-ins today and hours together.
- **Mod-triggered moments from /mod:** celebrate, show the next milestone, show legends, show a sponsor code. A BRB/idle scene rotating legends, milestones and the Advent day.
- Keep sponsors calm (no flashing). Keep `?key=` private. Add `?calm=1` for less motion. Nothing may suggest donations buy raffle chances.

## How to work

1. Work on a branch with small, focused commits. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
2. Order:
   1. public page (layout v2), section by section, keeping `src/data/sample.ts`, `src/demo/backend.ts` and the live data path working;
   2. the lines editor (DB table + RPCs + /mod panel);
   3. /mod redesign;
   4. overlay.
3. For /mod and the overlay, **mock it on the Design canvas first** (new boards on the same artifact, or a new one). The owner reviews through artifact comments, then you build. The owner rejects things that only describe instead of showing: draw real content, not placeholders that say what will go there.
4. Database changes go in new files in `supabase/migrations/`. Apply them only after the owner OKs it. Never touch the elomental Supabase projects.
5. **Hosting is Cloudflare** (`npm run deploy`). GitHub only stores code. Commit, push and deploy only when the owner says so.
6. Before calling it done, check:
   - 390 / 768 / 1280 / 1440 px, navbar on one row;
   - `prefers-reduced-motion`;
   - contrast of at least 4.5:1, touch targets of at least 44 px;
   - real buttons and labels;
   - Lighthouse (was 94 mobile / 100 desktop: don't regress);
   - overlay burst test (30 events in order);
   - the existing headless checks.

## Open questions (ask, don't guess)

- **Twitch chat messages:** answered 23 Nov: Iceman's own account. Still open: does a bot already thank in chat (StreamElements / Nightbot)? If so, avoid thanking people twice.
- **Iceman's real lines:** the mods will fill them in on /mod. Ask for his phrases, clips or alert texts if any copy in his voice is needed elsewhere.
- **Thresholds:** small vs large donation (10 €?).
- **Prizes:** the bingo prize and the real wheel prizes. «Căști de gaming de la Zona IT» in the mockup is an example.
- **Badge tiers:** confirmed as listed above. The owner may want more badges for the upper tiers (for example «30 de zile la rând», «5 nopți»).
- Everything still open in CLAUDE.md: sponsors, logos, discount code, Discord, socials, domain.

## Build status (23 Nov 2026, branch `claude/layout-v2-7bf252`)

Done on the branch (not deployed, nothing pushed). **The migration was applied to Supabase on 23 Nov 2026 with the owner's OK.**
- **Public page v2** (`src/components/*`, `src/styles/v2.css`, `src/lib/derive.ts`, `src/lib/views.ts`, `src/scripts/app.ts`): every section of the mockup at 390 / 768 / 1280 / 1440, demo backend and live data path both working. Lighthouse on the production build: mobile 94, desktop 100, accessibility 100, best practices 100 (same as before). Every animation is covered by a reduced-motion rule (checked in the page).
- **Iceman's bubble**: `src/lib/lines.ts` (groups, placeholders, no-repeat bag, «Mersi, {nume}!» fallback). The demo ships no lines, so it shows the fallback until someone types lines on `/mod/?demo`.
- **«Replicile lui Iceman» editor** on the current /mod (it moves into the new /mod when that's built).
- **Lines in Twitch chat** (owner, 23 Nov: from Iceman's own account, not a bot). The database picks the line when it records the event (`events.bubble_line`, no repeats per group), so the hero bubble and chat say the same thing. `chat_line_claim()` (service role only) decides and builds the text: switch on, at most one message every 5 s, once per event, no hidden names, nothing older than 2 minutes. `chatLine()` in `supabase/functions/_shared/twitch.ts` posts it with `POST /helix/chat/messages` from `twitch-eventsub` and `tipeee-donations`. Needs the `user:write:chat` scope (added to `SCOPES`: Iceman reconnects once) and the two functions redeployed. The /mod switch is off by default. Tested in PGlite (line picking, the claim rules, the message text); not tested against Twitch.
- **Migration** `supabase/migrations/20261125100000_layout_v2.sql`: `iceman_lines` + `mod_set_lines`, milestone `done_at` / `clip_url` / `scheduled_for` (and `mod_set_goals` accepting `done`, `clip`, `when`), `advent_days` + `mod_set_advent`, and the `lines` / `advent` / `badges` parts of `public_state`. Applied 23 Nov 2026 (checked: all 16 parts served, anon can't read the new tables or call `chat_line_claim`, the line picker and the claim tested inside a rolled-back block). `src/lib/database.types.ts` regenerated.
- **Canvas boards for review**: `ModLive`, `ModContent`, `ModPhone`, `Overlay` (also in `design/layout-v2/`). The owner approved the /mod boards on 23 Nov (after the menu rounds: grouped blocks, «Conexiuni», prism on dark).
- **/mod rebuilt** to the approved boards (`src/pages/mod.astro`, `src/scripts/mod.ts`): a sticky status bar (LIVE, clock, running / frozen until … / Ora dublă, the four connection dots, the moderator), a grouped menu (Live · Conținut · Jocuri · Oameni · Sponsori · Overlay, with counts of what waits), one page per group (`#section` in the address opens it), «De făcut acum», «Intră acum» and «Conexiuni» beside the Live page. Every earlier card is still there with the same RPCs and checks; the timer card is split into Cronometru / Îngheață / Ora dublă. New: milestone state + «când se face» + clip link (`mod_set_goals` with `done`, `clip`, `when`), the Advent day editor (`mod_set_advent`), read-only Insigne și Fidelii, Legende, Parteneri (from `site.ts`) and an Overlay page with ready-made OBS links. Not built (proposals on the board that need new backend): «Momente pe stream» and «last change by».

Waiting on the owner:
- Redeploy the `twitch-auth`, `twitch-eventsub` and `tipeee-donations` Edge Functions (chat lines and the new scope), then Iceman reconnects once on /mod.
- Comments on the /mod and overlay boards, then build them.
- Before the chat switch goes on: does StreamElements / Nightbot already thank people in chat? (The account question is answered: Iceman's own.)
- The small-donation threshold (10 € for now) and the prizes.

Not built yet, on purpose:
- A 12-slice wheel: the wheel now draws any number of slices, but the database holds 8 (`mod_set_prizes` needs 8). Going to 12 categories needs a prize-table change and the owner's real prize list.
- The "last change by" line and "Momente pe stream" on `ModLive` are proposals (they need a small mod-action log and an overlay command queue).
