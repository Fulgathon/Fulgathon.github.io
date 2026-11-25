// Tombole with channel points: /mod calls this after any raffle change (add, save, close, reopen,
// draw, delete) so the raffle's reward on Twitch follows: created while entries are open, deleted as
// soon as they close or the raffle is deleted. All the rules live in raffle_reward_plan().
//   POST /raffle-reward  (Authorization: the moderator's Supabase session)
//   → { created, deleted, errors: ['no_scope' | 'not_connected' | 'title_taken' | 'test' | …] }
// Deployed with verify_jwt = true: only logged-in users reach it; the moderator check is below.

import { admin, cors, json } from '../_shared/twitch.ts';
import { raffleSync } from '../_shared/raffle.ts';

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
    return json(await raffleSync(db));
  } catch (err) {
    console.error('raffle-reward', err);
    return json({ error: 'failed' });
  }
});
