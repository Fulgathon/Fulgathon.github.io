// Live data from Supabase: loads everything the page shows, keeps it fresh
// (one small versioned call, see Live), and wraps the viewer actions (login,
// vote, spin, suggest). Loaded lazily, and never in ?demo mode.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { popSlots, prizeColors } from '../data/content';
import { site } from '../data/site';
import type { Completed, Prize, SiteData, TickerItem, UpNext } from '../data/types';
import type { Database } from '../lib/database.types';
import { amount, tickerItem } from '../lib/events';
import { ago, dateRo, fmtInt } from '../lib/format';

type DB = SupabaseClient<Database>;
type Patch = Partial<SiteData>;

export interface Me {
  name: string;
  isSub: boolean;
  /** Daily wheel: 1 when a spin is available, minutes watched today, already spun today. */
  spins: number;
  watchedToday: number;
  spunToday: boolean;
  myVote: string | null;
  /** This viewer's saved bingo pick (5 event ids), or null. */
  bingoSaved: number[] | null;
  /** Bonus spins from secret codes (included in `spins`). */
  bonusSpins: number;
  /** false when the viewer chose not to appear by name in public. */
  isPublic: boolean;
}

export interface LiveHandlers {
  /** Called with fresh data; `first` is true for the initial full load. */
  onData(patch: Patch, first: boolean): void;
  onMe(me: Me | null): void;
  /** Server time minus this device's time (ms), so countdowns don't trust a wrong clock. */
  onClock?(offsetMs: number): void;
}

export interface LiveOptions {
  /** How often to ask for changes while the page is visible (ms). */
  intervalMs?: number;
  /** Keep polling while hidden (the OBS overlay). */
  pollHidden?: boolean;
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);
// Loose JSON from public_state() / my_state().
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Public data comes from ONE call, public_state(versions), which returns only
 * the parts that changed since the versions this page already has (usually a
 * few hundred bytes). It is polled every few seconds while the page is
 * visible, never in a hidden tab (except the overlay), with backoff and jitter
 * when the backend is unreachable, and immediately on return or reconnect.
 */
export class Live {
  readonly db: DB;
  private data: SiteData;
  private handlers: LiveHandlers;
  private opts: Required<LiveOptions>;
  private versions: Record<string, number> = {};
  private parts: Record<string, Json> = {};
  private pollTimer: number | undefined;
  private polling = false;
  private failures = 0;
  private first = true;
  private meTimer: number | undefined;
  private subChecked = false;

  constructor(initial: SiteData, handlers: LiveHandlers, opts: LiveOptions = {}) {
    this.data = initial;
    this.handlers = handlers;
    this.opts = { intervalMs: opts.intervalMs ?? 8000, pollHidden: opts.pollHidden ?? false };
    this.db = createClient<Database>(site.supabase.url, site.supabase.publishableKey, {
      auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }

  async start() {
    await this.poll();
    await this.refreshMe();
    this.db.auth.onAuthStateChange(() => { void this.refreshMe(); });
    this.scheduleMe();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { void this.poll(); void this.refreshMe(); }
    });
    window.addEventListener('online', () => { this.failures = 0; void this.poll(); });
  }

  /** Visible (or overlay): poll again after the interval, longer after failures; hidden: stop until visible. */
  private schedule() {
    clearTimeout(this.pollTimer);
    if (document.visibilityState === 'hidden' && !this.opts.pollHidden) return;
    const base = this.failures ? Math.min(120_000, this.opts.intervalMs * 2 ** this.failures) : this.opts.intervalMs;
    const delay = base * (0.85 + Math.random() * 0.3); // jitter: thousands of tabs don't ask at the same instant
    this.pollTimer = window.setTimeout(() => void this.poll(), delay);
  }

  private scheduleMe() {
    clearInterval(this.meTimer);
    // Watch minutes for the daily wheel are credited every 5 minutes.
    this.meTimer = window.setInterval(() => { if (document.visibilityState === 'visible') void this.refreshMe(); }, 120_000);
  }

  /** Ask for the parts that changed; safe to call any time (one request at a time). */
  async poll() {
    if (this.polling) return;
    this.polling = true;
    const sent = Date.now();
    try {
      const { data, error } = await this.raw.rpc('public_state', { p_have: this.versions });
      if (error || !data) throw error ?? new Error('no_data');
      const got = Date.now();
      this.handlers.onClock?.(Date.parse(data.now) - (sent + got) / 2);
      this.failures = 0;
      this.apply(data.v ?? {}, data.parts ?? {});
    } catch {
      this.failures = Math.min(this.failures + 1, 6);
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  /** Bingo/sponsor RPCs aren't in the generated types; this is the same client, untyped. */
  private get raw() { return this.db as unknown as SupabaseClient; }

  private apply(v: Record<string, number>, changed: Record<string, Json>) {
    Object.assign(this.parts, changed);
    this.versions = { ...this.versions, ...Object.fromEntries(Object.keys(changed).map((k) => [k, v[k]])) };
    const P = this.parts;
    const patch: Patch = {};
    const has = (k: string) => k in changed;

    if (has('timer') && P.timer) {
      const t = P.timer;
      Object.assign(patch, {
        status: t.status as SiteData['status'], startsAt: ms(t.startsAt), endsAt: ms(t.endsAt),
        pausedUntil: ms(t.pausedUntil), scheduledEnd: ms(t.scheduledEnd),
        doubleSponsor: t.doubleSponsor ?? null, doubleFrom: ms(t.doubleFrom), doubleUntil: ms(t.doubleUntil),
      });
    }
    if (has('stats') && P.stats) {
      patch.subs = P.stats.subs;
      patch.raisedNum = Number(P.stats.raised);
      patch.raised = `${amount(Number(P.stats.raised))} €`;
    }
    if (has('goals') && Array.isArray(P.goals) && P.goals.length) {
      patch.goals = P.goals.map((g: Json) => ({ title: g.title, threshold: g.threshold, sponsor: g.sponsor }));
    }
    if (has('feed') && Array.isArray(P.feed)) {
      const items = P.feed.map((e: Json) =>
        tickerItem({ id: e.id, kind: e.kind, tier: e.tier, quantity: e.quantity, currency: e.currency, seconds_added: e.seconds, user_name: e.name, user_login: null }));
      patch.ticker = items;
      patch.pops = items.filter((i: Json) => i.time !== '—').slice(0, popSlots.length).map((i: Json, k: number) => ({ ...i, ...popSlots[k] }));
    }
    if ((has('vote') || has('timer')) && P.vote) {
      const vt = P.vote;
      const start = patch.startsAt ?? this.data.startsAt;
      patch.round = vt.round ? { id: vt.round.id, number: vt.round.number, closesAt: Date.parse(vt.round.closesAt) } : null;
      patch.challenges = (vt.challenges ?? []).map((c: Json) => ({ id: String(c.id), title: c.title ?? '', desc: c.desc ?? '', votes: c.votes }));
      patch.upNext = (vt.upNext ?? []).map((u: Json, i: number): UpNext => ({
        n: i + 1, title: u.title, round: u.round,
        pct: (u.total ? Math.round(((u.won ?? 0) / u.total) * 100) : 0) + '%', when: u.when || 'În curând',
      }));
      patch.completed = (vt.completed ?? []).map((c: Json): Completed => {
        const done = ms(c.doneAt);
        const when = done && start ? `ZIUA ${Math.floor((done - start) / 86_400_000) + 1}` : done ? dateRo(done).toUpperCase() : '';
        return { title: c.title, when, clip: c.clip };
      });
    }
    if (has('prizes') && Array.isArray(P.prizes) && P.prizes.length) {
      patch.prizes = P.prizes.map((p: Json): Prize => [p.short, p.full, prizeColors[p.position] ?? '#F2F5FA', p.sponsor]);
      const lose = P.prizes.find((p: Json) => !p.isWin);
      patch.losePrize = lose ? lose.position : -1;
    }
    // "acum 3 min" labels age even when the wins don't change.
    if (Array.isArray(P.wins)) {
      const now = Date.now();
      patch.recentWins = P.wins.slice(0, 4).map((w: Json) => ({ user: w.user, prize: w.prize ?? '', ago: ago(Date.parse(w.at), now), sponsor: w.sponsor ?? null }));
    }
    if (has('boards') && P.boards) {
      const b = P.boards;
      const rows = (list: Json) => (Array.isArray(list) ? list : []).map((r: Json) => [String(r[0]), fmtInt(Number(r[1]))] as [string, string]);
      patch.boards = { donations: rows(b.donations), gifts: rows(b.gifts), bits: rows(b.bits), hours: rows(b.hours) } as SiteData['boards'];
    }
    if (has('bingo') && P.bingo) {
      const g = P.bingo;
      patch.bingo = {
        closesAt: ms(g.closesAt), prize: g.prize ?? '', prizeSponsor: g.prizeSponsor ?? null, players: g.players ?? 0,
        items: (g.items ?? []).map((i: Json) => ({ id: i.id, label: i.label, happened: !!i.happened })),
      };
    }

    this.data = { ...this.data, ...patch };
    const first = this.first;
    this.first = false;
    if (first || Object.keys(patch).length) this.handlers.onData(patch, first);
  }

  // ---- The logged-in viewer: one call. ------------------------------------

  async refreshMe() {
    const { data: { session } } = await this.db.auth.getSession();
    if (!session) { this.handlers.onMe(null); return; }
    const { data: m, error } = await this.raw.rpc('my_state', { p_round: this.data.round?.id ?? null });
    if (error) return;
    if (!m) { this.handlers.onMe(null); return; }
    // First visit after login (or an old answer): ask Twitch whether they're subscribed.
    const checkedAt = m.subCheckedAt ? Date.parse(m.subCheckedAt) : 0;
    if (!this.subChecked && Date.now() - checkedAt > 10 * 60_000) {
      this.subChecked = true;
      void this.checkSub();
    }
    this.handlers.onMe({
      name: m.name || m.login || 'viewer',
      isSub: !!m.isSub,
      spins: m.spins ?? 0,
      watchedToday: m.minutesToday ?? 0,
      spunToday: !!m.spunToday,
      myVote: m.myVote != null ? String(m.myVote) : null,
      bingoSaved: Array.isArray(m.bingo) ? m.bingo.map(Number) : null,
      bonusSpins: m.bonusSpins ?? 0,
      isPublic: m.public !== false,
    });
  }

  login() {
    return this.db.auth.signInWithOAuth({ provider: 'twitch', options: { redirectTo: location.origin + location.pathname } });
  }

  async logout() {
    await this.db.auth.signOut();
    this.handlers.onMe(null);
  }

  /** "M-am abonat, verifică iar": ask the backend to re-check with Twitch, then reload. */
  async checkSub() {
    try { await this.db.functions.invoke('check-sub'); } catch { /* function not deployed yet */ }
    await this.refreshMe();
  }

  async vote(roundId: number, challengeId: number) {
    const { error } = await this.db.rpc('cast_vote', { p_round: roundId, p_challenge: challengeId });
    if (error) throw error;
    void this.poll();
  }

  async spin() {
    const { data, error } = await this.db.rpc('spin');
    if (error) throw error;
    return data[0];
  }

  /** Secret code from the stream → 1 bonus spin. Throws with the error code. */
  async claimCode(code: string): Promise<{ sponsor: string | null; bonus_spins: number }> {
    const { data, error } = await this.raw.rpc('claim_code', { p_code: code });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await this.refreshMe();
    return data;
  }

  /** Every event after `after` (oldest first, public names): the overlay queues them all. */
  async feedSince(after: number): Promise<TickerItem[]> {
    const { data, error } = await this.raw.rpc('feed_since', { p_after: after, p_limit: 100 });
    if (error || !Array.isArray(data)) return [];
    return data.map((e: Json) => tickerItem({ id: e.id, kind: e.kind, tier: e.tier, quantity: e.quantity, currency: e.currency, seconds_added: e.seconds, user_name: e.name, user_login: null }));
  }

  /** The OBS overlay's current secret code (private key from /mod). */
  overlayCode(key: string) {
    return this.raw.rpc('overlay_code', { p_key: key }) as unknown as Promise<{ data: { code: string; sponsor: string | null; expires_at: string }[] | null }>;
  }

  /** Count a sponsor click / code copy (no personal data). */
  track(sponsor: string, kind: 'click' | 'code_copy') {
    void this.raw.rpc('track_sponsor', { p_sponsor: sponsor, p_kind: kind });
  }

  async saveBingo(items: number[]) {
    const { error } = await this.raw.rpc('bingo_save', { p_items: items });
    if (error) throw error;
    void this.poll();
  }

  /** Show or hide this viewer's name in public (leaderboards, feed, overlay). */
  async setPublic(isPublic: boolean) {
    const { error } = await this.raw.rpc('set_public_name', { p_public: isPublic });
    if (error) throw error;
    await this.refreshMe();
    void this.poll();
  }

  async suggest(body: string) {
    const { error } = await this.db.rpc('suggest', { p_body: body });
    if (error) throw error;
  }
}
