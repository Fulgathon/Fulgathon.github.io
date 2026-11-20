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
| `src/data/sample.ts` | The design's sample data, used with `?demo`, and the empty first-paint state. |
| `src/data/content.ts` | Fixed content: schedule, bingo squares, partners, default goals and prizes. |
| `src/scripts/live.ts` | Live data from Supabase, realtime updates, login, votes, spins, suggestions. |
| `src/data/site.ts` | Links, sponsor, discount code and the open `[PLACEHOLDERS]`. |
| `src/lib/derive.ts` | Port of the design's `renderVals()`: state + data → what the page shows. |
| `src/lib/views.ts` | HTML for the lists that re-render (ticker, vote, goals, leaderboard, bingo). |
| `src/scripts/app.ts` | Browser state, timers and click handlers; updates the page via `data-*` bindings. |
| `src/components/` | One Astro component per section, ported from `design/Main.dc.html`. |
| `src/styles/global.css` | Global styles from the design's `<helmet>`. |
| `supabase/migrations/` | Database schema, functions and seed data for phase 2 (see `docs/supabase.md`). |
| `src/lib/database.types.ts` | TypeScript types generated from the database. |
| `scripts/gen-seed.py` | Regenerates the seed migration from the project data. |
