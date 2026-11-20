// "Is the logged-in viewer subscribed?" Called by the site after login and by
// "M-am abonat, verifică iar". Asks Twitch with the broadcaster's token (so
// viewers never grant extra permissions) and saves the answer.
// Deployed with verify_jwt = false; the user's JWT is checked here.

import { admin, broadcasterToken, cors, getConfig, helix, json } from '../_shared/twitch.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const db = admin();
  const { data: { user } } = await db.auth.getUser(jwt);
  if (!user) return json({ error: 'not_logged_in' }, 401);

  const { data: viewer } = await db.from('viewers').select('id, twitch_id').eq('id', user.id).maybeSingle();
  if (!viewer?.twitch_id) return json({ error: 'no_twitch_account' }, 400);

  const cfg = await getConfig(db);
  let isSub = false;
  let tier: string | null = null;
  try {
    if (viewer.twitch_id === cfg.broadcaster_id) {
      isSub = true; tier = 'broadcaster';           // Iceman can always vote
    } else {
      const t = await broadcasterToken(db, cfg);
      const r = await helix(`/subscriptions?broadcaster_id=${t.user_id}&user_id=${viewer.twitch_id}`, t.access_token);
      if (!r.ok) throw new Error(`helix_${r.status}`);
      const sub = (await r.json()).data?.[0];
      isSub = !!sub; tier = sub?.tier ?? null;
    }
  } catch (err) {
    console.error(err);
    return json({ error: 'twitch_unavailable' }, 503);
  }

  await db.rpc('set_viewer_sub', { p_viewer: viewer.id, p_is_sub: isSub, p_tier: tier });
  return json({ isSub, tier });
});
