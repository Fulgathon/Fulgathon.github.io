// "Connect the streamer account": Iceman opens this once (button on /mod).
//   GET /twitch-auth            → redirect to Twitch to approve the scopes
//   GET /twitch-auth?code=…     → save his token in Vault, then (re)create the
//                                  EventSub webhooks for subs, gifts, bits, live,
//                                  title/game changes and channel-point check-ins
// Only the broadcaster account set in private.settings is accepted.
// Deployed with verify_jwt = false (it's a browser redirect target).

import { admin, appToken, exchangeCode, getConfig, helix, hmacHex, page, safeEqual, SCOPES, twitchApp } from '../_shared/twitch.ts';

const EVENTS: [type: string, version: string][] = [
  ['channel.subscribe', '1'],
  ['channel.subscription.message', '1'],
  ['channel.subscription.gift', '1'],
  ['channel.cheer', '1'],
  ['stream.online', '1'],
  ['stream.offline', '1'],
  ['channel.update', '2'],
  ['channel.channel_points_custom_reward_redemption.add', '1'],
];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const db = admin();
  let cfg;
  let app;
  try {
    cfg = await getConfig(db);
    app = twitchApp();
  } catch {
    return page('Lipsește configurarea', '<p>Cheile aplicației Twitch nu sunt încă salvate în Supabase (Edge Functions → Secrets: TWITCH_CLIENT_ID și TWITCH_CLIENT_SECRET).</p>', false, 500);
  }
  const redirectUri = `${cfg.functions_url}/twitch-auth`;

  // Step 1: send the streamer to Twitch.
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
    const issued = String(Date.now());
    const state = `${issued}.${await hmacHex(cfg.eventsub_secret, 'state:' + issued)}`;
    const auth = new URL('https://id.twitch.tv/oauth2/authorize');
    auth.search = new URLSearchParams({
      response_type: 'code', client_id: app.id, redirect_uri: redirectUri,
      scope: SCOPES.join(' '), state, force_verify: 'true',
    }).toString();
    return Response.redirect(auth.toString(), 302);
  }

  if (url.searchParams.has('error')) {
    return page('Anulat', '<p>Twitch nu a dat acces. Poți încerca din nou oricând.</p>', false, 400);
  }

  // Step 2: back from Twitch.
  const [issued, mac] = (url.searchParams.get('state') ?? '').split('.');
  const fresh = Date.now() - Number(issued) < 15 * 60_000;
  if (!fresh || !mac || !safeEqual(mac, await hmacHex(cfg.eventsub_secret, 'state:' + issued))) {
    return page('Link expirat', '<p>Pornește conectarea din nou de pe pagina de moderatori.</p>', false, 400);
  }

  let token;
  try {
    token = await exchangeCode(url.searchParams.get('code')!, redirectUri);
  } catch (err) {
    console.error(err);
    return page('Nu a mers', '<p>Twitch a refuzat codul. Încearcă din nou.</p>', false, 400);
  }
  if (token.login.toLowerCase() !== cfg.broadcaster_login.toLowerCase()) {
    return page('Cont greșit', `<p>Trebuie conectat contul <strong>${cfg.broadcaster_login}</strong>, nu ${token.login}.</p>`, false, 403);
  }
  const missing = SCOPES.filter((s) => !token.scopes.includes(s));
  if (missing.length) {
    return page('Lipsesc permisiuni', `<p>Twitch nu a dat: ${missing.join(', ')}. Încearcă din nou și aprobă tot.</p>`, false, 400);
  }

  const { error } = await db.rpc('save_broadcaster_token', { p_token: token });
  if (error) {
    console.error(error);
    return page('Nu a mers', '<p>Nu am putut salva conexiunea.</p>', false, 500);
  }

  // (Re)create the EventSub webhooks, removing old ones that point here.
  const callback = `${cfg.functions_url}/twitch-eventsub`;
  const results: string[] = [];
  try {
    const at = await appToken();
    let cursor = '';
    do {
      const r = await helix(`/eventsub/subscriptions${cursor ? `?after=${cursor}` : ''}`, at);
      const j = await r.json();
      for (const s of j.data ?? []) {
        if (s.transport?.callback === callback) await helix(`/eventsub/subscriptions?id=${s.id}`, at, { method: 'DELETE' });
      }
      cursor = j.pagination?.cursor ?? '';
    } while (cursor);

    for (const [type, version] of EVENTS) {
      const r = await helix('/eventsub/subscriptions', at, {
        method: 'POST',
        body: JSON.stringify({
          type, version,
          condition: { broadcaster_user_id: token.user_id },
          transport: { method: 'webhook', callback, secret: cfg.eventsub_secret },
        }),
      });
      results.push(`${type}: ${r.ok ? 'activ' : `eroare ${r.status}`}`);
      if (!r.ok) console.error(type, await r.text());
    }
  } catch (err) {
    console.error(err);
    return page('Aproape gata', '<p>Contul e conectat, dar abonarea la evenimente a eșuat. Mai apasă o dată butonul de conectare.</p>', false, 500);
  }

  const allOk = results.every((r) => r.endsWith('activ'));
  return page(
    allOk ? 'Gata!' : 'Aproape gata',
    `<p>Contul <strong>${token.login}</strong> e conectat. Subs, gift-urile, biții și statusul live ajung acum pe site.</p>
<p style="font-size:14px;color:#8C97A8">${results.join('<br>')}</p>`,
    allOk,
  );
});
