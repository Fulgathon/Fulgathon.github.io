# Go-live checklist

Everything is built, deployed and tested. What's left is connecting Twitch
(about 15 minutes, with Iceman), then running the subathon from `/mod`.

Pages (the one-letter addresses forward to the long ones and keep anything
after `?`, so `/o?pos=bl` opens `/overlay/?pos=bl`):

| Short | Long | For |
| --- | --- | --- |
| — | https://icemaraton.icemaraton.workers.dev/ | Viewers |
| https://icemaraton.icemaraton.workers.dev/m | …/mod/ | Moderators (Twitch login, moderator accounts only) |
| https://icemaraton.icemaraton.workers.dev/o | …/overlay/ | OBS Browser Source, 1920×1080: a slim strip top-right. Options: `?pos=tl/tr/bl/br`, `?scale=0.8`, `?show=timer,goal,events`, `?style=box` (large box), `?demo` (sample data for placing it) |
| https://icemaraton.icemaraton.workers.dev/d | …/?demo | Preview of the site with sample data |
| https://icemaraton.icemaraton.workers.dev/s | …/sponsori/ | Presentation for brands: type the brand name at the top and every placement (site, overlay, report) shows it; packages at the end. Audience numbers and prices: `src/data/pitch.ts` |
| https://icemaraton.icemaraton.workers.dev/p | …/prezentare/ | Guided demo of everything, for presenting (simulated data, never touches the database) |
| …/m?demo · …/o?demo | …/mod/?demo · …/overlay/?demo | The demo per page; `/d`, `/m?demo`, `/o?demo` and `/p` share one simulated subathon across tabs |

After launch, delete the demo pages: `src/pages/d.astro`, `src/pages/p.astro`
and `src/pages/prezentare.astro` (plus `src/demo/` and the `?demo` code paths
if wanted).

## 1. Connect Twitch (once)

Secrets go only into the dashboards below, never into chat or the repo.

1. **Twitch app** at https://dev.twitch.tv/console → Register Your Application
   (needs 2FA on the account):
   - Name: `ICEMARATON`
   - OAuth Redirect URLs, **both**:
     - `https://yvbxtsuddjqqoogdoqrx.supabase.co/auth/v1/callback` (viewer login)
     - `https://yvbxtsuddjqqoogdoqrx.supabase.co/functions/v1/twitch-auth` (streamer connect)
   - Category: Website Integration · Client type: Confidential
   - Manage → copy the **Client ID**, click New Secret → copy the **Client Secret**.
2. **Supabase → Authentication → Sign In / Providers → Twitch**: enable, paste
   Client ID + Client Secret, save.
3. **Supabase → Authentication → URL Configuration**: Site URL
   `https://icemaraton.icemaraton.workers.dev`; Redirect URLs `https://icemaraton.icemaraton.workers.dev/**`
   and `http://localhost:4321/**`.
4. **Supabase → Edge Functions → Secrets**: add `TWITCH_CLIENT_ID` and
   `TWITCH_CLIENT_SECRET` (same values).
5. **Switch login on**: done (22 Nov 2026, `twitchLogin: true` in `src/data/site.ts`).
6. **Iceman** opens https://icemaraton.icemaraton.workers.dev/m, logs in with Twitch
   (he's a moderator automatically), clicks **Conectează contul de streamer**
   and approves. The page should say "Gata!" with eight events "activ".
   **He must do this once more after 24 Nov 2026.** The daily check-in needs
   a new permission (channel points), and the title/game updates need two new
   events.
   **And once more after the layout v2 migration is applied:** «Replicile lui
   Iceman» can also go to Twitch chat from his own account, which needs the
   `user:write:chat` permission ("Send chat messages as you"). The connect
   page now asks for it and refuses the connection without it. Until he
   reconnects, /mod shows «Lipsește permisiunea» and nothing is sent.
7. **Daily check-in (channel points):** Twitch dashboard → Viewer Rewards →
   Channel Points → Manage Rewards → Add New Custom Reward:
   - Title: `Check-in ICEMARATON`. Any title containing "check-in" works.
   - Cost: something small, e.g. 100.
   - Limit per user per stream: 1 (optional; the site counts one per day anyway).
   - Turn on "Skip Reward Requests Queue" so moderators don't have to approve each one.
   Each redemption counts that day toward the viewer's streak on the site.

8. **Iceman's lines in chat (optional):** /mod → Replicile lui Iceman → «Trimite
   replica și în chatul Twitch». Off by default. The same line as the bubble on
   the site goes to chat from Iceman's account, with @name and the time added;
   at most one message every 5 seconds (extra events in those 5 s get the bubble
   only), one message per gift wave, none for hidden names, never late (events
   older than 2 minutes are skipped). **Before switching it on, ask Iceman
   whether StreamElements, Nightbot or another bot already thanks people in
   chat**, otherwise people are thanked twice. Sent by the `twitch-eventsub`
   (subs, gifts, bits) and `tipeee-donations` (donations) Edge Functions:
   redeploy both after the migration.

Dashboard: https://supabase.com/dashboard/project/yvbxtsuddjqqoogdoqrx

## 2. Before the start

- **Supabase plan**: the free plan pauses a project after a week without
  activity. Upgrade the IceMaraton organization (Pro) for the event.
- On `/mod`: set the **start date** (countdown on the site) and the
  **scheduled end**; add the other **moderators** by Twitch login.
- **OBS**: add a Browser Source, 1920×1080, with the link from `/mod` → Cod secret («Copiază linkul pentru OBS»: the overlay plus the private key, so secret codes show on stream). Keep that link private. Without codes: `https://icemaraton.icemaraton.workers.dev/o`.
- Open with Iceman, then tell Claude: time rates (now Tier 1/Prime +1 min,
  Tier 2 +2, Tier 3 +5, gift +1 each, 400 bits +1, 5 € +1), goals, prizes,
  sponsor details, Discord and social links.
- Optional dry run: start the timer from `/mod`, have someone sub or cheer,
  check the site and overlay, then end it and ask Claude to reset the data.

## 3. Going live

On `/mod` → **Pornește acum** with the starting hours. From then on:

| What | How it works |
| --- | --- |
| Subs, resubs, gifts, bits | Twitch → `twitch-eventsub` → time added, ticker, goals, leaderboard (instant) |
| Donations | TipeeeStream (euros), polled every 15 s by `tipeee-donations` → time added (5 € = +1 min), ticker, «Strâns» total. Counted only while the timer is live |
| Live / offline | Twitch `stream.online/offline` |
| Watch time & wheel | Every 5 min while live and online, everyone in chat gets 5 min (total and per Romanian day). A subscriber with 2 h watched that day gets 1 spin per day |
| Milestone Maraton | Unlocked by the donation total (€); edit the list on `/mod` → Milestone Maraton |
| Bingo | Viewers pick 5 events until the close (default 25 Dec 12:00); `/mod` → Bingo: set the close and prize, edit events, tick what happened, draw the winner from everyone with all 5 |
| Sponsors | `/mod`: «Oferită de» on Ora dublă, sponsor per milestone, wheel prizes (Premiile roții), bingo prize sponsor. Shown on site and overlay («de la …») |
| Cod secret | `/mod` → Cod secret → «Arată un cod nou» during a sponsor moment; the overlay shows it (needs the OBS link with `?key=` from that box); viewers enter it on the site for 1 bonus spin (6 tries/min) |
| Sponsor report | `/mod` → Raport pentru sponsori: clicks, code copies, code claims, donations and peak viewers in their double hours; «Copiază» gives a text to send |
| Long freeze | `/mod` → Cronometru → «Îngheață până la» a date (e.g. 25 Dec), «Dezgheață acum» to resume early; time still adds up meanwhile |
| Viewer login & sub check | "Conectează-te cu Twitch"; sub status checked on login and with "M-am abonat, verifică iar" |
| Vote rounds | `/mod` opens a round (auto-proposes 2 easy, 2 medium, 1 hard); it closes itself on time and schedules the winner |
| Timer end | At zero it ends by itself (moderators can add time or end it early) |
| Ora dublă, freeze, manual time | Buttons on `/mod` |
| Suggestions, prizes to give | Lists on `/mod` |

TipeeeStream API key: Supabase Vault secret `tipeee_api_key` (or the Edge Function
secret `TIPEEE_API_KEY`). Status: `select * from private.tipeee_state`.

## If something looks wrong

- Site not updating: check `/mod` → Stare (stream online, streamer connected).
- "Streamer neconectat": Iceman presses the connect button again.
- Twitch revoked access (password change etc.): same, connect again.
- Logs: Supabase dashboard → Edge Functions → each function → Logs.

## Multistreaming (not built)

Watch time and the wheel count only Twitch chat. Viewers on YouTube, Kick or
TikTok have no Twitch account, so the site can't recognise them. Counting them
would need: their own login on the site (Google/Kick), each platform's chat
list (YouTube Live Chat API, Kick API; TikTok has no official one), and a way
for one person to link accounts so their minutes add up. Possible as a phase 3;
YouTube is the most practical first step.
