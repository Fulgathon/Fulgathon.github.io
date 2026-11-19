# FULGATHON: Icemanlucky's Christmas subathon website

A one-page website for **FULGATHON**, Icemanlucky's Christmas subathon on Twitch (twitch.tv/icemanlucky). The audience is Romanian, so **all copy visitors see is in Romanian**, with correct diacritics (ă â î ș ț; comma-below ș/ț, not cedilla).

The design was made and approved on a Claude design canvas. This folder is the handoff. The job is to turn it into a real website hosted on **GitHub Pages**, then later connect it to Twitch.

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

## Hosting: GitHub Pages

The owner is setting up the GitHub repository and will host on GitHub Pages.

- GitHub Pages serves **static files only**. Phase 1 must build to plain static HTML/CSS/JS.
- Deploy with a **GitHub Actions** workflow (build, then deploy to Pages). Check GitHub's and the framework's current docs for the right actions and versions.
- Without a custom domain the site lives under `https://<user>.github.io/<repo>/`, so set the framework's **base path** to the repo name, and make every asset and link respect it. With a custom domain, the base is `/` and a `CNAME` file is needed. Ask which applies.
- Suggested stack (confirm with the owner before starting): **Astro** with static output and plain CSS, a small amount of client-side JS for the interactive parts. Vite + vanilla TypeScript is a fine alternative. Avoid anything that needs a server at runtime.
- Phase 2 needs a backend, which **cannot** run on GitHub Pages. Plan it as a separate service (for example Supabase or Cloudflare Workers) that the static site calls. See `docs/twitch-integration.md`.

## First task: phase 1

Build the static site so it matches the design, with every interaction working on the sample data in `renderVals()`:

1. Scaffold the project and the GitHub Pages deploy workflow.
2. Build the page section by section in the order of `docs/design-spec.md`.
3. Make the interactive parts work client-side: live countdown, mobile menu, viewer-state switch (logged out / not subscribed / subscriber), vote with "move vote", spin wheel, bingo, suggestion form, toasts, leaderboard tabs, copy-code button.
4. Keep the sample data in one module (for example `src/data/sample.ts`) so phase 2 can swap it for live data.
5. Before calling it done: check it at 390, 768, 1280 and 1440 px wide; the navbar must stay on one row; check `prefers-reduced-motion`; run a Lighthouse pass for accessibility and performance.

**Phase 2: Twitch connection.** Real timer, subs, goals, leaderboard, live status, login with Twitch, subscriber-only voting, watch-time spins, sponsors from config. See `docs/twitch-integration.md`.

## Rules

- Romanian copy everywhere visitors see it. Code, comments and docs can be English.
- Keep the look: near-black, electric ice blue (`#3FD0FF`), white; Barlow Condensed italic display type; square corners; snowfall. The owner rejected softer, playful versions as "girly", "AI-looking" and "not professional". Don't drift back to rounded cards, pastels, red-and-white candy-cane stripes, Christmas light strings, chrome lettering or gradient-wash backgrounds.
- The owner explicitly asked for: the snowfall, the white-to-ice gradient on "FULG" (not chrome), the emote in the middle of the spin wheel, and a **navbar that always stays on one row**.
- Sponsors stay calm and professional: logos on dark panels, no flashing.
- Every animation needs a `prefers-reduced-motion` fallback.
- Text contrast at least 4.5:1, touch targets at least 44 px, real `<button>`/`<a>`/`<label>` elements.

## Decided

- **Name:** FULGATHON (fulg + maraton; ties in with the snowflakes viewers collect for the wheel). Band line: "Fiecare sub e un fulg. Facem viscol."
- **Hosting:** GitHub Pages (static), backend separate in phase 2.

## Open (ask, don't guess)

- **Dates:** start date and the scheduled end date (`[DATA FINALĂ]`). The subathon ends on that date if no more time is added.
- **Time rates:** the design uses Tier 1/Prime +1 min, Tier 2 +2, Tier 3 +5, gift sub +1 each, 25 lei donation +1, 400 bits +1. To be confirmed.
- **Donation provider** (StreamElements, Streamlabs or other) and currency.
- **Prizes:** bingo prize (`[PREMIU]`), wheel prizes, "Ora dublă" schedule.
- **Sponsors:** the main sponsor in the mockup is **Zona IT** (an example the owner gave; confirm it's signed). "ZONA IT" is plain text standing in for the official logo. Still needed: names, logos (ideally SVG plus all-white versions), links, tiers (main partner / partners / supporters), what each one backs, the discount code (`ICEMAN10` is a placeholder) and the contact email for new sponsors.
- Discord invite, social links, repo name, custom domain or not.
