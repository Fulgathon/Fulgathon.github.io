# FULGATHON: Icemanlucky's Christmas subathon

Website for Icemanlucky's Christmas subathon on Twitch (Romanian audience).
Static site built with [Astro](https://astro.build), hosted on GitHub Pages.

- Brief: `CLAUDE.md`. Design: `design/` (source) and `docs/design-spec.md` (summary).
- Challenges for the subscriber vote: `docs/provocari.md` and `data/challenges.json`.
- Twitch connection plan (phase 2): `docs/twitch-integration.md`; the Supabase backend: `docs/supabase.md`.
- Images: `assets/` (the site imports them from there; the `-original` files are not shipped).

## Run it locally

Needs Node.js 22.23.4 or newer (24 LTS or 26 LTS are fine).

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # static site in dist/
npm run check      # type-check
```

Normal visitors get **live data** from the Supabase backend (see
`docs/supabase.md`): timer, ticker, goals, votes, leaderboard and wheel update
in real time. Add `?demo` to the URL for the design's **sample data** and a small
panel for switching the viewer state (logged out / not subscribed / subscriber),
the stream state (live / starting soon) and the snowfall.

Other pages: `/mod/` (moderators: run the timer, vote rounds, suggestions,
prizes), `/overlay/` (OBS Browser Source) and `/prezentare/` (guided demo of
everything, for presenting). Going live: `docs/go-live.md`.

**Short addresses:** `/m` → `/mod/`, `/o` → `/overlay/`, `/d` → `/?demo`,
`/p` → `/prezentare/` (`src/components/ShortLink.astro`; the query string is
kept, so `/o?pos=bl` and `/m?demo` work). `/d` and `/p` go with the demos
after launch.

**Demo mode:** `?demo` on `/`, `/mod/` and `/overlay/` runs on a simulated
backend (`src/demo/backend.ts`) with the same rules as the real one, stored in
the browser and shared between tabs. Nothing touches the real database.

## Deploy (GitHub Pages)

`.github/workflows/deploy.yml` builds and deploys on every push to `main`.
One-time setup in the repository: **Settings → Pages → Source: GitHub Actions**.

The base path comes from `actions/configure-pages`, so the site works at
`https://<user>.github.io/<repo>/` whatever the repo is called. For a custom
domain, add `public/CNAME` with the domain and set it in the Pages settings;
the base then becomes `/` automatically.

## Where things live

| Path | What |
| --- | --- |
| `src/data/sample.ts` | The empty first-paint state and the demo's pre-ticked bingo squares. |
| `src/demo/backend.ts` | Simulated backend for `?demo` and `/prezentare/`, seeded with the design's sample subathon. |
| `src/pages/prezentare.astro`, `src/scripts/prezentare.ts` | Guided presentation page. |
| `src/data/content.ts` | Fixed content: schedule, bingo squares, partners, default goals and prizes. |
| `src/scripts/live.ts` | Live data from Supabase, realtime updates, login, votes, spins, suggestions. |
| `src/data/site.ts` | Links, sponsor, discount code and the open `[PLACEHOLDERS]`. |
| `src/lib/derive.ts` | Port of the design's `renderVals()`: state + data → what the page shows. |
| `src/lib/views.ts` | HTML for the lists that re-render (ticker, vote, goals, leaderboard, bingo). |
| `src/scripts/app.ts` | Browser state, timers and click handlers; updates the page via `data-*` bindings. |
| `src/components/` | One Astro component per section, ported from `design/Main.dc.html`. |
| `src/styles/global.css` | Global styles from the design's `<helmet>`. |
| `supabase/migrations/` | Database schema, functions and seed data for phase 2 (see `docs/supabase.md`). |
| `supabase/functions/` | Edge Functions: Twitch EventSub, streamer connect, sub check, watch time. |
| `src/pages/mod.astro`, `src/scripts/mod.ts` | Moderator page. |
| `src/pages/overlay.astro`, `src/scripts/overlay.ts` | OBS overlay. |
| `src/lib/database.types.ts` | TypeScript types generated from the database. |
| `scripts/gen-seed.py` | Regenerates the seed migration from the project data. |
