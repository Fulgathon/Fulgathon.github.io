// Receives Twitch EventSub webhooks and turns them into time on the clock.
//   channel.subscribe            → sub (gift recipients skipped: the gift event counts them)
//   channel.subscription.message → resub
//   channel.subscription.gift    → gift (quantity = number of subs)
//   channel.cheer                → bits
//   stream.online / offline      → timer.stream_online
//   channel.update               → "Acum pe stream" title + game, at once
//   channel points redemption of "Check-in ICEMARATON" → the day counts for the viewer's streak
// Subs, gifts and bits may also send Iceman's bubble line to chat (chatLine; /mod switch).
// Every request is verified with the EventSub HMAC signature; Twitch retries
// reuse the message id, which record_event() dedupes.
// Deployed with verify_jwt = false (Twitch can't send a Supabase JWT).

import { admin, chatLine, getConfig, hmacHex, safeEqual } from '../_shared/twitch.ts';

const MAX_AGE_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ICEMARATON EventSub endpoint', { status: 200 });

  const body = await req.text();
  const id = req.headers.get('Twitch-Eventsub-Message-Id') ?? '';
  const ts = req.headers.get('Twitch-Eventsub-Message-Timestamp') ?? '';
  const sig = req.headers.get('Twitch-Eventsub-Message-Signature') ?? '';
  const type = req.headers.get('Twitch-Eventsub-Message-Type') ?? '';

  const db = admin();
  const cfg = await getConfig(db);
  const expected = 'sha256=' + (await hmacHex(cfg.eventsub_secret, id + ts + body));
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

  switch (msg.subscription?.type) {
    case 'channel.subscribe':
      if (!e.is_gift) await record('sub', e.tier, 1);
      break;
    case 'channel.subscription.message':
      await record('resub', e.tier, 1);
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
