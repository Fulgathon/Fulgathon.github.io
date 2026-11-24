# Design spec

The source of truth is `design/Main.dc.html`. This file summarises it so you don't have to reverse-engineer everything.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| bg | `#050608` | Page background |
| bg-alt | `#0A0E15` | Alternating sections (Vote, Rates, Discord strip) |
| panel | `#0B1018` / `#090C11` | Cards, scoreboard, chat box |
| line | `#1A2230` | Hairlines, row dividers |
| line-strong | `#2A3445` | Ghost button borders, dotted leaders, inactive |
| text | `#F2F5FA` | Main text, section rules (2 px under headings) |
| text-2 | `#AEB8C7` / `#C9D2DF` | Secondary text |
| muted | `#8C97A8` | Labels, descriptions |
| dim | `#7D8899` | Meta text (keep at least this light for contrast) |
| ice (accent) | `#3FD0FF` | Primary accent; exposed as CSS var `--ice` |
| energy | `linear-gradient(90deg, #1E5BFF, var(--ice))` + soft glow | Progress bars, thin accent lines |
| twitch | `#9146FF` | "Conectează-te cu Twitch" only |
| live | `#D5162B` | Live badge only |
| on-ice text | `#04101A` | Text on ice-blue fills |

Corners are square everywhere (no border-radius), except round elements (wheel, hub, avatar dot).

## Type

- Display: **Barlow Condensed**, 800–900, mostly *italic*, uppercase. Mirrors the slanted lettering in the logo.
- Body: **Barlow** 400–700.
- Google Fonts: `Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,700;1,800;1,900` and `Barlow:wght@400;500;600;700`.
- Fluid sizes use container query units (`cqi`) against the page root (`container-type: inline-size; container-name: page`). Plain `vw` works too if you don't need the phone preview.

## Responsive breakpoints (container width)

- ≤ 1080 px: nav links collapse into a menu button.
- ≤ 760 px: goals list goes to one column.
- ≤ 640 px: hide "Urmărește live" in the nav and the "cu Twitch" suffix; toast moves under the nav, full width; smaller background numbers.
- Everything else reflows with `flex-wrap` and `auto-fit` grids. Test at 390 px.

## Page structure, top to bottom

1. **Ticker** (40 px): live badge, then a scrolling marquee of time-added events (`+5:00 frostbyte_77 sub Tier 3 / …`).
2. **Nav:** a mini countdown on the left (no logo, on purpose), section links, login (or viewer chip with ABONAT/URMĂRITOR badge), "Urmărește live", menu button on small screens.
3. **Hero** (`#timer`):
   - Faint blue grid behind, masked to an ellipse; two slow sweeping spotlight beams (blue, `mix-blend-mode: screen`).
   - Corner labels "TWITCH · RO" and "EDIȚIA 01".
   - Eyebrow "Subathonul de Crăciun · 2026".
   - Giant "ICEMARATON" (`min(16.5cqi, 252px)`), "ICE" with a white-to-ice gradient fill, "MARATON" as an ice outline. (The design files still say FULGATHON, the project's earlier name.)
   - Logo art below, slightly overlapping the bottom of the word, floating gently with a flickering ice glow.
   - Short paragraph and two buttons: "Urmărește live" (ice) and "Votează provocări" (ghost).
   - **Scoreboard:** HUD corner brackets; label "Timp rămas" and live badge; four ice-block tiles DD : HH : MM : SS (white-to-ice gradient digits, flip-clock split, a light glint sweeping across in turn); "+time" chips floating up out of the top edge; three stats (Suburi, Următorul obiectiv, Strâns până acum); progress bar to the next goal; "ORA DUBLĂ" note and scheduled end date.
5. **01 În direct:** Twitch player (16:9) and Twitch chat side by side, stacking on phones.
6. **02 Votul abonaților** (`#vote`): round countdown, gate banner, tabs (Vot deschis / Urmează / Făcute), challenge rows (number, title, description, bar, votes, %, button).
7. **03 Roata lui Lucky** (`#roata`): spin wheel left, rules + status + spin button + recent winners right.
8. **04 Obiectivele de Crăciun** (`#goals`): 12 goals in two columns; done = struck through with a check, current = "URMEAZĂ" tag and progress bar, locked = lock icon.
9. **05 Cum adaugi timp** (`#tarife`): two price-list columns with dotted leaders (Suburi / Donații și biți) and an "Ora dublă" box.
10. **06 Clasament + Programul de Crăciun:** leaderboard with tabs (Suburi dăruite / Biți / Ore văzute) and the schedule.
11. **07 Joacă și tu** (`#joaca`): bingo card (4×4) and "Propune o provocare".
12. **08 Partenerii subathonului** (`#parteneri`): sponsors in three tiers (see below).
13. **Discord strip**, then the **footer** with social links.

Section headings: a small skewed ice tag with the number, a big italic uppercase title, a 2 px white rule under it, and a huge faint outlined number behind on the right.

## Viewer states (drive the interactive parts)

| State | Nav | Vote | Wheel | Suggest |
| --- | --- | --- | --- | --- |
| Logged out | "Conectează-te cu Twitch" | Purple banner + login button; vote buttons say "Doar abonați" | "Conectează-te ca să învârți" | Locked, login button |
| Logged in, not subscribed | Chip with URMĂRITOR | Banner + "Abonează-te" + "M-am abonat, verifică iar"; votes locked | Spins allowed (watch time) | Locked, subscribe button |
| Subscriber | Chip with ABONAT | "Ai 1 vot în runda asta"; one vote per round, can be moved until the round closes | Spins allowed | Form enabled (140 chars max) |

Stream states: **live** (red "ÎN DIRECT", timer counting down, live data) and **upcoming** ("ÎNCEPE CURÂND", countdown to start, zeroed stats, placeholder ticker).

## Interactions

- **Vote:** clicking a row's button records the vote; the row turns ice, its count goes up by one, and a "Vot înregistrat" toast appears. Moving the vote is allowed.
- **Wheel:** 8 equal segments (+5 min, VIP 24h, Shoutout, Sub cadou, Alegi jocul, O colindă, Îngheți timpul, Mai încearcă). The result is decided first, then the wheel rotates 5 full turns plus the offset to land on it (4.6 s ease-out). The 48 rim ticks turn ice while spinning. The emote sits in the hub. 3 snowflakes = 1 spin, 1 snowflake per hour watched, subscribers earn double.
- **Bingo:** tap to mark cells; any full row, column or diagonal shows "Bingo!" with "scrie !bingo în chat".
- **Toast:** "Obiectiv deblocat" (latest goal) or "Vot înregistrat"; dismissible; emote on the left.
- **Menu:** the mobile menu toggles a full-width list of links.

## Motion (all off under `prefers-reduced-motion`)

Snowfall in two layers (back: small, slow; front: bigger, faster, above content, `pointer-events: none`), ticker marquee, spotlight sweep, logo float and glow flicker, timer glints, rising "+time" chips, wheel spin.

**Motion tokens, «tăietura» (the broadcast cut), 23 Nov 2026.** One motion language for the whole site, in `:root` of `src/styles/global.css`: a quick start and a long, soft landing, like an esports lower third, calm on purpose (nothing bounces or overshoots).

| Token | Value | Use |
| --- | --- | --- |
| `--m-ease` | `cubic-bezier(.2, .8, .2, 1)` | Everything that appears or changes |
| `--m-ease-io` | `cubic-bezier(.65, 0, .35, 1)` | Travel: the page scroll (mirrored in `src/scripts/motion.ts`) |
| `--m-fast` | 140 ms | Hover, press, focus |
| `--m-base` | 240 ms | State changes, the nav underline |
| `--m-slow` | 560 ms | Reveals: the section cut-in, new feed rows |
| `--m-skew` | −12° | The slant every moving bar shares |

Behaviour (`src/scripts/motion.ts`): in-page links glide to their section in 450–900 ms (eased, stops if the visitor scrolls or presses a key) and focus it; the menu underlines the section you're in (`aria-current`); each section header plays its cut-in the first time it scrolls into view and again when a menu link lands on it (the numeral slides in, the ice bar sweeps from the left). Under reduced motion: links jump, headers are just there. The small things (end of `src/styles/v2.css`): tooltips and milestone names rise and fade in (and leave quicker than they came); the toast slides in from the right; the phone menu drops in with its rows one after another; «Vezi tot» rows and opened panels cut in; bars and fills slide to their new value; picks, tabs and hover states glide; buttons give 1 px when pressed. Live regions are patched in place (`src/lib/morph.ts`) so those transitions run on live data too; the feeds (hero, ticker, today) are still rebuilt so the newest row animates in. New motion should use these tokens rather than new durations.

## Sponsors

Sponsors appear in four places. All logos are dashed placeholders for now (`.logo-slot`).

1. **Top section (main sponsor, mockup: «Sponsor Principal» until a sponsor is signed):**
   - a "Prezentat de | SPONSOR PRINCIPAL" plate with small corner brackets, centred above the eyebrow line;
   - an offer line under the buttons: "Ofertă pentru comunitate de la Sponsor Principal" + code chip `ICEMAN10` + "Vezi oferta →";
   - "Cronometru oferit de SPONSOR PRINCIPAL" at the bottom right of the scoreboard.
   "SPONSOR PRINCIPAL" is plain text standing in for the official logo; swap in the real logo file when the sponsor sends it.
2. **Spin wheel:** "Premii oferite de" with a sponsor logo, under the section heading.
3. **Section 08:**
   - **Main partner card** with HUD corner brackets: a large logo area, "PARTENER PRINCIPAL" tag, name, one-line pitch, a discount code button (click copies `ICEMAN10` and shows "Copiat ✓" for 2 s) and a "Vezi oferta →" button.
   - **Partners:** a grid of logo tiles, each with a name and what it supports (Premii roată, Obiective, Ora dublă, Bingo).
   - **Supporters:** a row of smaller logo tiles.
   - A contact line for new sponsors: `[EMAIL CONTACT]`.
4. **Nav:** a "Parteneri" link.

Style rule: sponsor logos go on the dark panels as supplied (or as all-white versions if a logo clashes); nothing loud or animated, so sponsors look professional next to the design.


Note: the owner removed the scrolling band under the hero ("ugly, not professional"). Don't add decorative marquee bands; the top ticker is the only scrolling strip.
