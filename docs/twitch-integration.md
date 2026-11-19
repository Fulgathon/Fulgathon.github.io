# Twitch integration plan (phase 2)

A starting plan, not a finished design. Check every endpoint, scope and event name against the current Twitch docs (https://dev.twitch.tv/docs/) before building. Twitch changes things.

## What needs real data

| Feature on the page | Source |
| --- | --- |
| Live / starting soon | `GET /helix/streams?user_login=icemanlucky`, or EventSub `stream.online` / `stream.offline` |
| Timer, time added | Server-side: an authoritative end timestamp, extended on each sub, gift, bit or donation event |
| Sub count, goals | EventSub `channel.subscribe`, `channel.subscription.message` (resubs), `channel.subscription.gift` |
| Bits | EventSub `channel.cheer` (scope `bits:read`) |
| Donations | Not Twitch: the donation provider's realtime API (StreamElements or Streamlabs; to be decided) |
| Ticker, "+time" chips, toasts | The same events, pushed to browsers |
| Leaderboard (gifts, bits) | Aggregated from the events above |
| Leaderboard (hours watched), wheel snowflakes | Watch time (see below) |
| Login with Twitch | OAuth authorization code flow; only identity needed |
| Subscriber-only voting and suggestions | Sub check for the logged-in viewer (see below) |
| Player and chat | Twitch embeds; both require the `parent=<your domain>` parameter |

## Architecture sketch

- **Backend** holds the broadcaster's token (scopes such as `channel:read:subscriptions`, `bits:read`, `moderator:read:chatters`). It receives EventSub webhooks (or keeps an EventSub WebSocket open), updates the database, and pushes changes to browsers over WebSocket or server-sent events.
- **Timer is server-authoritative:** store `ends_at`. Adding time moves `ends_at`. During "Ora dublă" the added time is multiplied by 2. The wheel's "Îngheți timpul" prize pauses the countdown (store a pause window). Browsers only render `ends_at - now`.
- **Viewer login:** Twitch OAuth with no extra scopes, just to learn the viewer's user id and name. Keep a session cookie.
- **Sub check:** server-side with the broadcaster token: `GET /helix/subscriptions?broadcaster_id=…&user_id=…`. This avoids asking viewers for extra permissions. Cache the result for a few minutes; the "M-am abonat, verifică iar" button forces a fresh check.
- **Watch time:** Twitch has no per-viewer watch-time API. One option: poll `GET /helix/chat/chatters` every few minutes during the stream and credit minutes to everyone listed (only counts people connected to chat). Another: use the donation provider's loyalty points if it has them. Decide with the owner.
- **Voting:** rounds (open, close time, 5 challenges), one vote per subscriber per round, changeable until close. Seed challenges from `data/challenges.json` (skip `votable: false`). Moderators need a simple admin view to start and close rounds, pick the 5, and approve suggestions.
- **Database:** a hosted Postgres works well (Supabase is one option and has realtime built in). Tables roughly: `events`, `timer`, `goals`, `viewers`, `watch_minutes`, `vote_rounds`, `round_challenges`, `votes`, `suggestions`, `spins`.

## Safety and fairness

- Verify EventSub webhook signatures.
- Never trust the browser for sub status, votes, spins or time added; all of it is decided on the server.
- Rate-limit votes, spins and suggestions; moderate suggestions before they're shown.
