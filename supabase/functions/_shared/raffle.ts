// Tombole with channel points (migration 20261220100000): the site keeps each points raffle's reward on
// Twitch in step with the database. raffle_reward_plan() says what to create and what to delete;
// raffleSync() does it with the streamer's token and reports back with raffle_reward_done().
// Needs channel:manage:redemptions (the streamer reconnects once on /mod). Twitch only lets an app
// manage rewards it created itself, which is exactly these.

import { broadcasterToken, getConfig, helix, type Db } from './twitch.ts';

export const MANAGE_REDEMPTIONS = 'channel:manage:redemptions';

/** Reward title on Twitch: at most 45 characters. */
const title = (prize: string) => {
  const t = `Tombolă: ${prize.trim()}`;
  return t.length > 45 ? `${t.slice(0, 44).trimEnd()}…` : t;
};
const PROMPT = 'O intrare de persoană. Câștigătorul se trage pe stream.';

export async function raffleSync(db: Db): Promise<{ created: number; deleted: number; errors: string[] }> {
  const { data: plan, error } = await db.rpc('raffle_reward_plan');
  if (error) throw error;
  const p = plan as { test: boolean; create: { id: number; prize: string; cost: number }[]; delete: { id: number; reward: string }[]; trash: string[] };
  const out = { created: [] as Record<string, unknown>[], deleted: [] as Record<string, unknown>[], trashed: [] as string[] };
  const errors: string[] = [];
  if (!p.create.length && !p.delete.length && !p.trash.length) return { created: 0, deleted: 0, errors };
  // «Mod test»: nothing on Twitch; the raffles say why.
  if (p.test) {
    out.created = p.create.map((c) => ({ id: c.id, error: 'test' }));
    await db.rpc('raffle_reward_done', { p: out });
    return { created: 0, deleted: 0, errors: ['test'] };
  }
  let token: string, bid: string;
  try {
    const cfg = await getConfig(db);
    const t = await broadcasterToken(db, cfg);
    if (!t.scopes.includes(MANAGE_REDEMPTIONS)) throw new Error('no_scope');
    token = t.access_token; bid = t.user_id;
  } catch (e) {
    const code = e instanceof Error && e.message === 'no_scope' ? 'no_scope' : 'not_connected';
    out.created = p.create.map((c) => ({ id: c.id, error: code }));
    await db.rpc('raffle_reward_done', { p: out });
    return { created: 0, deleted: 0, errors: [code] };
  }

  for (const c of p.create) {
    const r = await helix(`/channel_points/custom_rewards?broadcaster_id=${bid}`, token, {
      method: 'POST',
      body: JSON.stringify({ title: title(c.prize), cost: c.cost, prompt: PROMPT, is_enabled: true, background_color: '#3FD0FF', should_redemptions_skip_request_queue: false }),
    });
    if (r.ok) {
      out.created.push({ id: c.id, reward: (await r.json())?.data?.[0]?.id ?? '' });
    } else {
      const body = (await r.text()).slice(0, 300);
      console.error('raffle reward create', r.status, body);
      const code = r.status === 400 && /duplicate|same title|title/i.test(body) ? 'title_taken' : r.status === 403 ? 'not_allowed' : `twitch_${r.status}`;
      out.created.push({ id: c.id, error: code });
      errors.push(code);
    }
  }
  const remove = async (reward: string) => {
    const r = await helix(`/channel_points/custom_rewards?broadcaster_id=${bid}&id=${encodeURIComponent(reward)}`, token, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) { console.error('raffle reward delete', r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  };
  for (const d of p.delete) if (await remove(d.reward)) out.deleted.push({ id: d.id, reward: d.reward });
  for (const t of p.trash) if (await remove(t)) out.trashed.push(t);
  const { error: e2 } = await db.rpc('raffle_reward_done', { p: out });
  if (e2) throw e2;
  return { created: out.created.filter((x) => x.reward).length, deleted: out.deleted.length + out.trashed.length, errors };
}

/** A redemption of a raffle reward: FULFILLED when it entered, CANCELED (points back) otherwise. */
export async function raffleRedemption(db: Db, e: Record<string, any>): Promise<void> {
  const rewardId: string | undefined = e.reward?.id;
  if (!rewardId) return;
  const { data: verdict, error } = await db.rpc('raffle_redeem', {
    p_reward_id: rewardId, p_redemption_id: e.id ?? null, p_user_id: e.user_id ?? null, p_login: e.user_login ?? null, p_name: e.user_name ?? null,
  });
  if (error) { console.error('raffle_redeem', error.message); return; }
  if (!verdict) return;   // not a raffle reward
  try {
    const cfg = await getConfig(db);
    const t = await broadcasterToken(db, cfg);
    if (!t.scopes.includes(MANAGE_REDEMPTIONS)) return;
    const status = verdict === 'entered' ? 'FULFILLED' : 'CANCELED';
    const r = await helix(`/channel_points/custom_rewards/redemptions?broadcaster_id=${t.user_id}&reward_id=${encodeURIComponent(rewardId)}&id=${encodeURIComponent(e.id)}`, t.access_token, {
      method: 'PATCH', body: JSON.stringify({ status }),
    });
    if (!r.ok) console.error('raffle redemption status', r.status, (await r.text()).slice(0, 200));
    // A redemption for a closed raffle: make sure its reward leaves Twitch.
    if (verdict === 'closed') await raffleSync(db);
  } catch (err) {
    console.error('raffle redemption', err);
  }
}
