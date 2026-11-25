// Turned off (owner, 25 Nov 2026): clips are never made automatically. A moderator or the streamer
// pastes the clip link on /mod, so the moment is the right one. Kept only so an old /mod page in a
// browser tab gets a clear answer instead of a clip.
//   POST /make-clip → { error: 'disabled' }

import { cors, json } from '../_shared/twitch.ts';

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  return json({ error: 'disabled' }, 410);
});
