// Every 5 minutes (pg_cron → pg_net): credit everyone in chat with 5 minutes
// of watch time. Subscribers earn double snowflakes, so their sub status is
// looked up in batches of 100. Does nothing unless the subathon is live and
// the stream is online. Deployed with verify_jwt = false; the cron call is
// checked with the x-cron-secret header (secret kept in Vault).

import { admin, broadcasterToken, getConfig, helix, json, safeEqual } from '../_shared/twitch.ts';

const MINUTES = 5;

Deno.serve(async (req) => {
  const db = admin();
  const cfg = await getConfig(db);
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', cfg.cron_secret)) return json({ error: 'forbidden' }, 403);

  const { data: timer } = await db.from('timer').select('status, stream_online').eq('id', 1).maybeSingle();
  if (timer?.status !== 'live' || !timer.stream_online) return json({ skipped: 'not live' });
  if (!cfg.token) return json({ skipped: 'broadcaster not connected' });

  const t = await broadcasterToken(db, cfg);

  // Everyone connected to chat.
  const chatters: { id: string; login: string; name: string; sub?: boolean }[] = [];
  let cursor = '';
  do {
    const r = await helix(`/chat/chatters?broadcaster_id=${t.user_id}&moderator_id=${t.user_id}&first=1000${cursor ? `&after=${cursor}` : ''}`, t.access_token);
    if (!r.ok) return json({ error: `chatters_${r.status}` }, 502);
    const j = await r.json();
    for (const c of j.data ?? []) chatters.push({ id: c.user_id, login: c.user_login, name: c.user_name });
    cursor = j.pagination?.cursor ?? '';
  } while (cursor);

  // Which of them are subscribed (100 ids per request).
  const subs = new Set<string>();
  for (let i = 0; i < chatters.length; i += 100) {
    const ids = chatters.slice(i, i + 100).map((c) => `user_id=${c.id}`).join('&');
    const r = await helix(`/subscriptions?broadcaster_id=${t.user_id}&${ids}`, t.access_token);
    if (r.ok) for (const s of (await r.json()).data ?? []) subs.add(s.user_id);
  }
  for (const c of chatters) c.sub = subs.has(c.id);

  const { data: credited, error } = await db.rpc('credit_watch_time', { p_viewers: chatters, p_minutes: MINUTES });
  if (error) return json({ error: error.message }, 500);
  return json({ credited, chatters: chatters.length, subs: subs.size });
});
