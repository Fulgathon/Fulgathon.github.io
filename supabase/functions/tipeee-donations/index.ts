// Every 15 seconds (pg_cron → pg_net): fetch new TipeeeStream donations and
// turn them into time on the clock. TipeeeStream has no webhooks and Twitch
// never sees these donations, so this polls the TipeeeStream events API.
//   * The API key is in Vault (tipeee_api_key) or an Edge Function secret
//     (TIPEEE_API_KEY, or any secret name containing "tipee").
//   * The first run only sets the starting point: older donations never count.
//   * Each run looks back two minutes, so a donation listed late isn't missed;
//     record_event() dedupes on the donation id.
//   * Donations count only while the subathon is live (and after it started), and only in
//     euros: any other currency goes to /mod for a moderator to decide (tipeee_skip).
//   * Each new donation may send Iceman's bubble line to Twitch chat (chatLine; /mod switch).
//   * Not live + a rehearsal running on /mod: the donation plays on the practice clock only.
// Deployed with verify_jwt = false; the cron call is checked with x-cron-secret.

import { admin, chatLine, json, safeEqual } from '../_shared/twitch.ts';

const API = 'https://api.tipeeestream.com/v1.0/events.json';
const LOOKBACK_MS = 2 * 60_000;

interface TipeeeEvent {
  id?: number | string;
  ref?: string;
  type?: string;
  created_at?: string;
  inserted_at?: string;
  parameters?: { username?: string; amount?: number | string; currency?: string; message?: string };
  'parameters.amount'?: number | string;
}

// TipeeeStream wants a datetime with a timezone offset.
const tipeeeDate = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+00:00');
// ...and answers with offsets like "+0100"; make them ISO ("+01:00") before parsing.
const parseDate = (s?: string) => Date.parse((s ?? '').replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
// The list is in datas.items (the 2019 docs say "events").
// deno-lint-ignore no-explicit-any
const items = (d: any): TipeeeEvent[] => d?.datas?.items ?? d?.events ?? [];

Deno.serve(async (req) => {
  const db = admin();
  const { data: cfg, error: cfgError } = await db.rpc('tipeee_config');
  if (cfgError) return json({ error: cfgError.message }, 500);
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', cfg.cron_secret ?? '')) return json({ error: 'forbidden' }, 403);

  const mark = (since: number | null, count: number, err: string | null) =>
    db.rpc('tipeee_mark', { p_since: since ? new Date(since).toISOString() : null, p_count: count, p_error: err });

  // Vault first, then an Edge Function secret: TIPEEE_API_KEY or any name with "tipee" in it.
  const envName = Deno.env.get('TIPEEE_API_KEY')
    ? 'TIPEEE_API_KEY'
    : Object.keys(Deno.env.toObject()).find((k) => /tipee/i.test(k));
  const apiKey: string | undefined = cfg.api_key ?? (envName ? Deno.env.get(envName) : undefined);
  const keySource = cfg.api_key ? 'vault:tipeee_api_key' : envName ? `secret:${envName}` : null;
  if (!apiKey) {
    await mark(null, 0, 'no_api_key');
    return json({ skipped: 'no api key' });
  }

  // {"check": true}: confirm the key works by asking for the account's all-time totals.
  const body = await req.json().catch(() => ({}));
  if (body?.check) {
    const k = encodeURIComponent(apiKey.trim());
    const r = await fetch(`https://api.tipeeestream.com/v1.0/events/forever.json?apiKey=${k}`);
    const j = await r.json().catch(() => null);
    // The start filter: donations since 1 Nov, oldest first (dates and amounts only).
    const from = Date.parse('2026-11-01T00:00:00Z');
    const t = await fetch(`${API}?apiKey=${k}&type[]=donation&start=${encodeURIComponent(tipeeeDate(from))}&sort=createdAt&order=asc&limit=5`);
    const list = items(await t.json().catch(() => null));
    const probes = {
      status: t.status, count: list.length,
      allAfterStart: list.every((e) => parseDate(e.created_at) >= from),
      sample: list.map((e) => ({ id: e.id, created_at: e.created_at, parsed: new Date(parseDate(e.created_at)).toISOString(), amount: e.parameters?.amount, currency: e.parameters?.currency })),
    };
    return json({ status: r.status, message: j?.message ?? null, totals: j?.datas ? { donations: j.datas.donations, followers: j.datas.followers, subscribers: j.datas.subscribers } : null, probes, keySource });
  }

  const now = Date.now();
  if (!cfg.started) {
    await mark(now, 0, null);
    return json({ started: new Date(now).toISOString(), keySource });
  }

  const started = Date.parse(cfg.started);
  const since = Math.max(started, Date.parse(cfg.since ?? cfg.started) - LOOKBACK_MS);
  const url = new URL(API);
  url.searchParams.set('apiKey', apiKey.trim());
  url.searchParams.append('type[]', 'donation');
  url.searchParams.set('start', tipeeeDate(since));
  url.searchParams.set('sort', 'createdAt');
  url.searchParams.set('order', 'asc');
  url.searchParams.set('limit', '100');

  let events: TipeeeEvent[] = [];
  try {
    const r = await fetch(url);
    if (!r.ok) {
      const err = `tipeee_${r.status} (${keySource})`;
      console.error(err, (await r.text()).slice(0, 200));
      await mark(null, 0, err);
      return json({ error: err }, 502);
    }
    events = items(await r.json());
  } catch (e) {
    console.error(e);
    await mark(null, 0, 'tipeee_unreachable');
    return json({ error: 'tipeee_unreachable' }, 502);
  }

  const live = cfg.timer_status === 'live';
  const timerStarted = cfg.timer_started ? Date.parse(cfg.timer_started) : 0;
  let newest = Date.parse(cfg.since ?? cfg.started);
  let counted = 0;

  for (const e of events) {
    if (e.type && e.type !== 'donation') continue;
    const at = parseDate(e.created_at ?? e.inserted_at);
    if (!Number.isFinite(at) || at < started) continue;
    newest = Math.max(newest, at);

    const p = e.parameters ?? {};
    const amount = Number(p.amount ?? e['parameters.amount']) || 0;
    const id = e.id ?? e.ref;
    if (!live) {
      // Not live: nothing counts, but an active rehearsal on /mod plays it on the practice clock.
      if (amount > 0 && id !== undefined) {
        const { error: rhError } = await db.rpc('tipeee_rehearsal', {
          p_id: `tipeee:${id}`, p_user: (p.username ?? '').trim() || 'Anonim', p_amount: amount, p_currency: String(p.currency ?? 'EUR').toUpperCase(),
        });
        if (rhError) console.error('tipeee_rehearsal', id, rhError.message);
      }
      continue;
    }
    if (at < timerStarted) continue;
    if (amount <= 0 || id === undefined) continue;
    const currency = String(p.currency ?? 'EUR').toUpperCase();
    // Euros only (owner, 23 Nov 2026, B-09): no conversion table. A donation in another
    // currency adds no time and isn't added to Strâns; it waits on /mod («De făcut acum»)
    // for a moderator to decide, and the warning stays in the function logs.
    if (currency !== 'EUR') {
      console.warn('donation not in EUR, not counted; sent to /mod', id, amount, currency);
      const { error: skipError } = await db.rpc('tipeee_skip', {
        p_external_id: `tipeee:${id}`,
        p_user_name: (p.username ?? '').trim() || 'Anonim',
        p_amount: amount,
        p_currency: currency,
        p_at: new Date(at).toISOString(),
      });
      if (skipError) console.error('tipeee_skip', id, skipError.message);
      continue;
    }

    const { data: ev, error } = await db.rpc('record_event', {
      p_source: 'donation',
      p_kind: 'donation',
      p_external_id: `tipeee:${id}`,
      p_user_name: (p.username ?? '').trim() || 'Anonim',
      p_quantity: amount,
      p_currency: currency,
    });
    if (error) {
      console.error('record_event', id, error.message);
      await mark(null, counted, `record_${error.code ?? 'error'}`);
      return json({ error: error.message }, 500);
    }
    await chatLine(db, (ev as { id?: number } | null)?.id);
    counted++;
  }

  await mark(newest, counted, null);
  return json({ checked: events.length, counted, live, keySource });
});
