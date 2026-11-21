# Go-live checklist

Everything is built, deployed and tested. What's left is connecting Twitch
(about 15 minutes, with Iceman), then running the subathon from `/mod`.

Pages (the one-letter addresses forward to the long ones and keep anything
after `?`, so `/o?pos=bl` opens `/overlay/?pos=bl`):

| Short | Long | For |
| --- | --- | --- |
| — | https://fulgathon.github.io/ | Viewers |
| https://fulgathon.github.io/m | …/mod/ | Moderators (Twitch login, moderator accounts only) |
| https://fulgathon.github.io/o | …/overlay/ | OBS Browser Source, 1920×1080: a slim strip top-right. Options: `?pos=tl/tr/bl/br`, `?scale=0.8`, `?show=timer,goal,events`, `?style=box` (large box), `?demo` (sample data for placing it) |
| https://fulgathon.github.io/d | …/?demo | Preview of the site with sample data |
| https://fulgathon.github.io/p | …/prezentare/ | Guided demo of everything, for presenting (simulated data, never touches the database) |
| …/m?demo · …/o?demo | …/mod/?demo · …/overlay/?demo | The demo per page; `/d`, `/m?demo`, `/o?demo` and `/p` share one simulated subathon across tabs |

After launch, delete the demo pages: `src/pages/d.astro`, `src/pages/p.astro`
and `src/pages/prezentare.astro` (plus `src/demo/` and the `?demo` code paths
if wanted).

## 1. Connect Twitch (once)

Secrets go only into the dashboards below, never into chat or the repo.

1. **Twitch app** at https://dev.twitch.tv/console → Register Your Application
   (needs 2FA on the account):
   - Name: `FULGATHON`
   - OAuth Redirect URLs, **both**:
     - `https://yvbxtsuddjqqoogdoqrx.supabase.co/auth/v1/callback` (viewer login)
     - `https://yvbxtsuddjqqoogdoqrx.supabase.co/functions/v1/twitch-auth` (streamer connect)
   - Category: Website Integration · Client type: Confidential
   - Manage → copy the **Client ID**, click New Secret → copy the **Client Secret**.
2. **Supabase → Authentication → Sign In / Providers → Twitch**: enable, paste
   Client ID + Client Secret, save.
3. **Supabase → Authentication → URL Configuration**: Site URL
   `https://fulgathon.github.io`; Redirect URLs `https://fulgathon.github.io/**`
   and `http://localhost:4321/**`.
4. **Supabase → Edge Functions → Secrets**: add `TWITCH_CLIENT_ID` and
   `TWITCH_CLIENT_SECRET` (same values).
5. **Switch login on**: `twitchLogin: true` in `src/data/site.ts`, commit, push
   (or ask Claude to).
6. **Iceman** opens https://fulgathon.github.io/m, logs in with Twitch
   (he's a moderator automatically), clicks **Conectează contul de streamer**
   and approves. The page should say "Gata!" with six events "activ".

Dashboard: https://supabase.com/dashboard/project/yvbxtsuddjqqoogdoqrx

## 2. Before the start

- **Supabase plan**: the free plan pauses a project after a week without
  activity. Upgrade the Fulgathon organization (Pro) for the event.
- On `/mod`: set the **start date** (countdown on the site) and the
  **scheduled end**; add the other **moderators** by Twitch login.
- **OBS**: add a Browser Source with `https://fulgathon.github.io/o`, 1920×1080.
- Open with Iceman, then tell Claude: time rates (now Tier 1/Prime +1 min,
  Tier 2 +2, Tier 3 +5, gift +1 each, 400 bits +1, 25 lei +1), goals, prizes,
  donation provider, sponsor details, Discord and social links.
- Optional dry run: start the timer from `/mod`, have someone sub or cheer,
  check the site and overlay, then end it and ask Claude to reset the data.

## 3. Going live

On `/mod` → **Pornește acum** with the starting hours. From then on:

| What | How it works |
| --- | --- |
| Subs, resubs, gifts, bits | Twitch → `twitch-eventsub` → time added, ticker, goals, leaderboard (instant) |
| Live / offline | Twitch `stream.online/offline` |
| Watch time & snowflakes | Every 5 min while live and online, everyone in chat gets 5 min; 1 snowflake/hour, 2 for subs |
| Viewer login & sub check | "Conectează-te cu Twitch"; sub status checked on login and with "M-am abonat, verifică iar" |
| Vote rounds | `/mod` opens a round (auto-proposes 2 easy, 2 medium, 1 hard); it closes itself on time and schedules the winner |
| Timer end | At zero it ends by itself (moderators can add time or end it early) |
| Ora dublă, freeze, manual time | Buttons on `/mod` |
| Suggestions, prizes to give | Lists on `/mod` |

Not automatic yet: **donations** (waiting for the provider choice; moderators
can add the time by hand meanwhile).

## If something looks wrong

- Site not updating: check `/mod` → Stare (stream online, streamer connected).
- "Streamer neconectat": Iceman presses the connect button again.
- Twitch revoked access (password change etc.): same, connect again.
- Logs: Supabase dashboard → Edge Functions → each function → Logs.
