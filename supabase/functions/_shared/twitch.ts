// Shared helpers for the ICEMARATON Edge Functions: database client, config,
// Twitch tokens (app + broadcaster, with refresh) and small responses.
//
// Needs two Edge Function secrets, set in the Supabase dashboard
// (Edge Functions → Secrets): TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.
// Everything else (EventSub secret, cron secret, broadcaster token) lives in
// Supabase Vault and is read through public.twitch_config().

import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

export type Db = ReturnType<typeof createClient>;

export function admin(): Db {
  const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
  const key = keys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  return createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scopes: string[];
  user_id: string;
  login: string;
}

export interface Config {
  broadcaster_login: string;
  broadcaster_id: string | null;
  functions_url: string;
  eventsub_secret: string;
  cron_secret: string;
  token: Token | null;
}

// channel:read:redemptions: the daily check-in with channel points ("Check-in ICEMARATON").
export const SCOPES = ['channel:read:subscriptions', 'bits:read', 'moderator:read:chatters', 'channel:read:redemptions'];

export async function getConfig(db: Db): Promise<Config> {
  const { data, error } = await db.rpc('twitch_config');
  if (error) throw error;
  return data as Config;
}

export function twitchApp() {
  const id = Deno.env.get('TWITCH_CLIENT_ID');
  const secret = Deno.env.get('TWITCH_CLIENT_SECRET');
  if (!id || !secret) throw new Error('twitch_not_configured');
  return { id, secret };
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams(params) });
  if (!res.ok) throw new Error(`twitch_token_${res.status}: ${await res.text()}`);
  return await res.json();
}

/** App access token (client credentials), used to manage EventSub subscriptions. */
export async function appToken(): Promise<string> {
  const { id, secret } = twitchApp();
  const j = await tokenRequest({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
  return j.access_token;
}

/** Exchange an OAuth code for the broadcaster's token and check who it belongs to. */
export async function exchangeCode(code: string, redirectUri: string): Promise<Token> {
  const { id, secret } = twitchApp();
  const j = await tokenRequest({ client_id: id, client_secret: secret, code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  const v = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${j.access_token}` } });
  if (!v.ok) throw new Error('twitch_validate_failed');
  const who = await v.json();
  return {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + j.expires_in * 1000,
    scopes: j.scope ?? [],
    user_id: who.user_id,
    login: who.login,
  };
}

/** The broadcaster's token, refreshed (and saved) when it's about to expire. */
export async function broadcasterToken(db: Db, cfg: Config): Promise<Token> {
  let t = cfg.token;
  if (!t) throw new Error('broadcaster_not_connected');
  if (t.expires_at - Date.now() < 5 * 60_000) {
    const { id, secret } = twitchApp();
    const j = await tokenRequest({ client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: t.refresh_token });
    t = {
      ...t,
      access_token: j.access_token,
      refresh_token: j.refresh_token ?? t.refresh_token,
      expires_at: Date.now() + j.expires_in * 1000,
      scopes: j.scope ?? t.scopes,
    };
    const { error } = await db.rpc('save_broadcaster_token', { p_token: t });
    if (error) throw error;
  }
  return t;
}

export async function helix(path: string, token: string, init: RequestInit = {}) {
  const { id } = twitchApp();
  return await fetch(`https://api.twitch.tv/helix${path}`, {
    ...init,
    headers: { 'Client-Id': id, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

/** A small page in the site's look, for the streamer-connect flow. */
export function page(title: string, text: string, ok: boolean, status = 200) {
  const color = ok ? '#3FD0FF' : '#D5162B';
  return new Response(
    `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ICEMARATON</title><meta name="robots" content="noindex">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050608;color:#F2F5FA;font:17px/1.5 system-ui,sans-serif;padding:20px}
main{max-width:560px;border:2px solid ${color};background:#0B1018;padding:28px}
h1{margin:0 0 10px;font:italic 900 34px/1 system-ui,sans-serif;text-transform:uppercase;color:${color}}
p{margin:8px 0;color:#C9D2DF}a{color:#3FD0FF}</style></head>
<body><main><h1>${title}</h1>${text}<p><a href="https://icemaraton.icemaraton.workers.dev/mod/">Înapoi la pagina de moderatori</a></p></main></body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

/** HMAC-SHA256 hex. */
export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
