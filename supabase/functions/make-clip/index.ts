// "Făcută" on /mod also clips the moment: a moderator's click creates a Twitch clip of
// the last ~30 seconds on Iceman's channel and returns its link, which /mod saves with
// the challenge or milestone. Needs Iceman's token with clips:edit (one reconnect).
//   POST /make-clip  (Authorization: the moderator's Supabase session)
//   → { url } or { error: 'offline' | 'no_scope' | 'not_moderator' | … }
// Deployed with verify_jwt = true: only logged-in users reach it; the moderator check is below.

import { admin, broadcasterToken, cors, getConfig, helix, json } from '../_shared/twitch.ts';

export const CLIP_SCOPE = 'clips:edit';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  const db = admin();
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: who } = await db.auth.getUser(jwt);
  if (!who?.user) return json({ error: 'not_logged_in' }, 401);
  const { data: me } = await db.from('viewers').select('is_moderator').eq('id', who.user.id).maybeSingle();
  if (!me?.is_moderator) return json({ error: 'not_moderator' }, 403);

  try {
    const cfg = await getConfig(db);
    const t = await broadcasterToken(db, cfg);
    if (!t.scopes.includes(CLIP_SCOPE)) return json({ error: 'no_scope' });
    const r = await helix(`/clips?broadcaster_id=${t.user_id}`, t.access_token, { method: 'POST' });
    if (r.status === 404) return json({ error: 'offline' });
    if (!r.ok) {
      console.error('make-clip', r.status, (await r.text()).slice(0, 200));
      return json({ error: `twitch_${r.status}` });
    }
    const id = (await r.json())?.data?.[0]?.id;
    if (!id) return json({ error: 'no_clip' });
    return json({ url: `https://clips.twitch.tv/${id}` });
  } catch (err) {
    console.error('make-clip', err);
    return json({ error: 'failed' });
  }
});
