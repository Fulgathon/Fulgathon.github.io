// Receives Twitch EventSub webhooks and turns them into time on the clock.
//   channel.subscribe            → sub (gift recipients skipped: the gift event counts them);
//                                  the viewer is a subscriber on the site at once
//   channel.subscription.message → resub, unless the chat badge already counted that month
//   channel.subscription.end     → the viewer is no longer a subscriber on the site
//   channel.subscription.gift    → gift (quantity = number of subs)
//   channel.chat.message         → resubs nobody shared: the subscriber badge carries the
//                                  cumulative months; when it goes up, that's a resub
//                                  (chat_sub_months decides, no double counting)
//   channel.cheer                → bits
//   stream.online / offline      → timer.stream_online
//   channel.update               → "Acum pe stream" title + game, at once
//   channel points redemption of "Check-in ICEMARATON" → the day counts for the viewer's streak
// Subs, gifts and bits may also send Iceman's bubble line to chat (chatLine; /mod switch).
// Every request is verified with the EventSub HMAC signature; Twitch retries
// reuse the message id, which record_event() dedupes.
// Deployed with verify_jwt = false (Twitch can't send a Supabase JWT).

import { admin, broadcasterToken, chatLine, getConfig, helix, hmacHex, safeEqual, type Config, type Db } from '../_shared/twitch.ts';
import { subBadge } from '../_shared/badges.ts';

const MAX_AGE_MS = 10 * 60_000;

// Chat sends many requests: keep the config for a minute, and remember the months already
// reported per chatter so an unchanged badge never reaches the database twice.
let cfgCache: { at: number; cfg: Config } | null = null;
const seenMonths = new Map<string, number>();

async function config(db: Db): Promise<Config> {
  if (cfgCache && Date.now() - cfgCache.at < 60_000) return cfgCache.cfg;
  const cfg = await getConfig(db);
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ICEMARATON EventSub endpoint', { status: 200 });

  const body = await req.text();
  const id = req.headers.get('Twitch-Eventsub-Message-Id') ?? '';
  const ts = req.headers.get('Twitch-Eventsub-Message-Timestamp') ?? '';
  const sig = req.headers.get('Twitch-Eventsub-Message-Signature') ?? '';
  const type = req.headers.get('Twitch-Eventsub-Message-Type') ?? '';

  const db = admin();
  let cfg = await config(db);
  let expected = 'sha256=' + (await hmacHex(cfg.eventsub_secret, id + ts + body));
  if (id && !safeEqual(sig, expected) && cfgCache) {
    // The secret may have changed since it was cached.
    cfgCache = null;
    cfg = await config(db);
    expected = 'sha256=' + (await hmacHex(cfg.eventsub_secret, id + ts + body));
  }
  if (!id || !safeEqual(sig, expected)) return new Response('bad signature', { status: 403 });
  if (Math.abs(Date.now() - Date.parse(ts)) > MAX_AGE_MS) return new Response('stale', { status: 403 });

  const msg = JSON.parse(body);

  if (type === 'webhook_callback_verification') {
    return new Response(msg.challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  if (type === 'revocation') {
    console.warn('EventSub subscription revoked', msg.subscription?.type, msg.subscription?.status);
    return new Response(null, { status: 204 });
  }
  if (type !== 'notification') return new Response(null, { status: 204 });

  const e = msg.event ?? {};
  const user = (anon: boolean) => (anon ? [null, null, 'Anonim'] : [e.user_id ?? null, e.user_login ?? null, e.user_name ?? null]);
  const record = async (kind: string, tier: string | null, quantity: number, anon = false) => {
    const [uid, login, name] = user(anon);
    const { data, error } = await db.rpc('record_event', {
      p_source: 'twitch', p_kind: kind, p_external_id: id,
      p_user_id: uid, p_user_login: login, p_user_name: name,
      p_tier: tier, p_quantity: quantity,
    });
    if (error) throw error;
    // A gift wave is one gift event (the gifted subs are skipped above), so it gets one message.
    await chatLine(db, (data as { id?: number } | null)?.id, cfg);
  };
  const subStatus = async (isSub: boolean) => {
    const { error } = await db.rpc('sub_status_changed', {
      p_user_id: e.user_id ?? null, p_login: e.user_login ?? null, p_is_sub: isSub, p_tier: e.tier ?? null,
    });
    if (error) console.error('sub_status_changed', error.message);
  };

  switch (msg.subscription?.type) {
    case 'channel.subscribe':
      await subStatus(true);
      if (!e.is_gift) await record('sub', e.tier, 1);
      break;
    case 'channel.subscription.end':
      await subStatus(false);
      break;
    case 'channel.subscription.message': {
      const { data: fresh, error } = await db.rpc('resub_shared', {
        p_user_id: e.user_id ?? null, p_login: e.user_login ?? null, p_months: Number(e.cumulative_months) || null,
      });
      if (error) console.error('resub_shared', error.message);
      if (error || fresh !== false) await record('resub', e.tier, 1);
      if (e.user_id && e.cumulative_months) seenMonths.set(e.user_id, Number(e.cumulative_months));
      break;
    }
    case 'channel.chat.message':
      await chatBadge(db, cfg, e);
      break;
    case 'channel.subscription.gift':
      await record('gift', e.tier, Number(e.total) || 1, !!e.is_anonymous);
      break;
    case 'channel.cheer':
      await record('bits', null, Number(e.bits) || 0, !!e.is_anonymous);
      break;
    case 'stream.online':
      await db.rpc('set_stream_online', { p_online: true });
      break;
    case 'stream.offline':
      await db.rpc('set_stream_online', { p_online: false });
      break;
    case 'channel.update':
      await db.rpc('save_stream_title', { p_title: e.title ?? null, p_game: e.category_name ?? null });
      break;
    case 'channel.channel_points_custom_reward_redemption.add':
      // Any reward whose title mentions "check-in" / "checkin" (e.g. "Check-in ICEMARATON").
      if (/check[\s-]?in/i.test(e.reward?.title ?? '')) {
        await db.rpc('record_checkin', { p_user_id: e.user_id ?? null, p_login: e.user_login ?? null, p_name: e.user_name ?? null });
      }
      break;
  }
  return new Response(null, { status: 204 });
});

/** A chat message: if the subscriber badge shows more months than before, count a resub. */
async function chatBadge(db: Db, cfg: Config, e: Record<string, any>) {
  const uid: string | undefined = e.chatter_user_id;
  const badge = subBadge(e.badges);
  if (!uid || !badge) return;
  if (seenMonths.get(uid) === badge.months) return;

  const { data: verdict, error } = await db.rpc('chat_sub_months', {
    p_user_id: uid, p_login: e.chatter_user_login ?? null, p_months: badge.months,
  });
  if (error) { console.error('chat_sub_months', error.message); return; }
  seenMonths.set(uid, badge.months);
  if (seenMonths.size > 50_000) seenMonths.clear();
  if (verdict !== 'credit') return;

  // The badge can't always tell Tier 2/3 apart; ask Twitch for the real tier.
  let tier = badge.tier;
  try {
    const t = await broadcasterToken(db, cfg);
    const r = await helix(`/subscriptions?broadcaster_id=${t.user_id}&user_id=${uid}`, t.access_token);
    if (r.ok) tier = (await r.json())?.data?.[0]?.tier ?? tier;
  } catch { /* keep the badge's tier */ }

  const { data, error: recErr } = await db.rpc('record_event', {
    p_source: 'twitch', p_kind: 'resub', p_external_id: `chatbadge:${uid}:${badge.months}`,
    p_user_id: uid, p_user_login: e.chatter_user_login ?? null, p_user_name: e.chatter_user_name ?? null,
    p_tier: tier, p_quantity: 1,
  });
  if (recErr) { console.error('record_event (chat resub)', recErr.message); return; }
  await chatLine(db, (data as { id?: number } | null)?.id, cfg);
}
