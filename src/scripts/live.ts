// Live data from Supabase: loads everything the page shows, keeps it fresh
// (one small versioned call, see Live), and wraps the viewer actions (login,
// vote, spin, suggest). Loaded lazily, and never in ?demo mode.
// Public data is plain fetch; the Supabase library (~57 KB) loads only for a viewer
// who logs in or already has a session.

import type { SupabaseClient } from '@supabase/supabase-js';
import { popSlots, prizeColors } from '../data/content';
import { site } from '../data/site';
import type { Completed, Loyalty, Mine, Prize, SiteData, TickerItem, UpNext } from '../data/types';
import type { Database } from '../lib/database.types';
import { amount, tickerItem } from '../lib/events';
import { ago, dateRo, fmtInt, safeUrl } from '../lib/format';

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
  /** Drawn as a bingo winner. */
  bingoWon: boolean;
  /** Bonus spins from secret codes (included in `spins`). */
  bonusSpins: number;
  /** false when the viewer chose not to appear by name in public. */
  isPublic: boolean;
  /** What this viewer added in total. */
  mine: Mine;
  /** Hours, daily streak and badges from chat presence (null before any watching). */
  loyalty: Loyalty | null;
  /** This viewer's latest sub/gift/donation/bits (for "your sub added 6 minutes"). */
  lastEvent: { id: number; kind: string; quantity: number; seconds: number; at: number } | null;
}


export interface LiveHandlers {
  /** Called with fresh data; `first` is true for the initial full load. */
  onData(patch: Patch, first: boolean): void;
  onMe(me: Me | null): void;
  /** Server time minus this device's time (ms), so countdowns don't trust a wrong clock. */
  onClock?(offsetMs: number): void;
  /** Consecutive failed polls (0 after a good one). */
  onConn?(failures: number): void;
  /** A moderator pressed «Testează» on /mod → Overlay OBS (only new ones, not on the first load). */
  onTest?(test: { kind: string; at: string; by?: string }): void;
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
  private client: Promise<DB> | null = null;
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
  }

  /** The Supabase client, loaded on first need (login, an existing session, a viewer action). */
  private db(): Promise<DB> {
    this.client ??= import('@supabase/supabase-js').then(({ createClient }) => {
      const db = createClient<Database>(site.supabase.url, site.supabase.publishableKey, {
        auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
      });
      db.auth.onAuthStateChange(() => { void this.refreshMe(); });
      return db;
    });
    return this.client;
  }
  private async raw() { return (await this.db()) as unknown as SupabaseClient; }

  /** Public calls without the library: one plain request (public state, feed, overlay code, tracking). */
  private async anon<T = Json>(fn: string, args: Record<string, unknown>): Promise<{ data: T | null; error: Error | null }> {
    try {
      const r = await fetch(`${site.supabase.url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: site.supabase.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!r.ok) return { data: null, error: new Error(`${fn}_${r.status}`) };
      const text = await r.text();
      return { data: text ? (JSON.parse(text) as T) : null, error: null };
    } catch (err) {
      return { data: null, error: err as Error };
    }
  }

  /** Could this visitor be logged in? A stored session, or the page is the return from Twitch. */
  private maySignIn() {
    if (this.client) return true;
    if (new URLSearchParams(location.search).has('code')) return true;
    try { return Object.keys(localStorage).some((k) => k.startsWith('sb-') && k.endsWith('-auth-token')); } catch { return false; }
  }

  async start() {
    await this.poll();
    await this.refreshMe();
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
      const { data, error } = await this.anon('public_state', { p_have: this.versions });
      if (error || !data) throw error ?? new Error('no_data');
      const got = Date.now();
      this.handlers.onClock?.(Date.parse(data.now) - (sent + got) / 2);
      this.failures = 0;
      this.handlers.onConn?.(0);
      this.apply(data.v ?? {}, data.parts ?? {});
    } catch {
      this.failures = Math.min(this.failures + 1, 6);
      this.handlers.onConn?.(this.failures);
    } finally {
      this.polling = false;
      this.schedule();
    }
  }

  /** Bingo/sponsor RPCs aren't in the generated types; this is the same client, untyped. */
  private apply(v: Record<string, number>, changed: Record<string, Json>) {
    Object.assign(this.parts, changed);
    this.versions = { ...this.versions, ...Object.fromEntries(Object.keys(changed).map((k) => [k, v[k]])) };
    const P = this.parts;
    const patch: Patch = {};
    const has = (k: string) => k in changed;
    if (this.first) patch.loaded = true;

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
      patch.goals = P.goals.map((g: Json) => ({ title: g.title, threshold: g.threshold, sponsor: g.sponsor, doneAt: ms(g.doneAt), clip: safeUrl(g.clip), when: g.when ?? null }));
    }
    if (has('feed') && Array.isArray(P.feed)) {
      const items = P.feed.map((e: Json) => ({
        ...tickerItem({ id: e.id, at: ms(e.at) ?? undefined, kind: e.kind, tier: e.tier, quantity: e.quantity, currency: e.currency, seconds_added: e.seconds, user_name: e.name, user_login: null }),
        ...('line' in e ? { line: e.line ?? null } : {}),
      }));
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
        return { title: c.title, when, clip: safeUrl(c.clip) };
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
        opensAt: ms(g.opensAt), closesAt: ms(g.closesAt),
        winners: Array.isArray(g.winners) ? g.winners.map((w: Json) => ({ id: Number(w.id), name: String(w.name ?? ''), at: Date.parse(w.at) })) : [],
        draw: g.draw ? { id: Number(g.draw.id), name: String(g.draw.name ?? ''), at: Date.parse(g.draw.at), shownAt: Date.parse(g.draw.shownAt),
          entrants: Array.isArray(g.draw.entrants) ? g.draw.entrants.map(String) : [], total: Number(g.draw.total) || 0 } : null,
        prize: g.prize ?? '', prizeSponsor: g.prizeSponsor ?? null, players: g.players ?? 0,
        items: (g.items ?? []).map((i: Json) => ({ id: i.id, label: i.label, happened: !!i.happened })),
      };
    }

    if (has('today') && P.today) {
      const t = P.today;
      patch.today = { seconds: Number(t.seconds) || 0, people: Number(t.people) || 0, subs: Number(t.subs) || 0, donated: Number(t.donated) || 0, bits: Number(t.bits) || 0, events: Number(t.events) || 0 };
    }
    if (has('loyal') && Array.isArray(P.loyal)) {
      patch.loyal = P.loyal.map((l: Json) => ({ name: String(l.name), hours: Number(l.hours) || 0, streak: Number(l.streak) || 0, badges: Array.isArray(l.badges) ? l.badges.map(String) : [] }));
    }
    if (has('together') && P.together) {
      patch.together = { hours: Number(P.together.hours) || 0, goals: (P.together.goals ?? []).map((g: Json) => ({ title: String(g.title), hours: Number(g.hours) || 0 })) };
    }
    if (has('now') && P.now) {
      patch.now = { title: P.now.title ?? null, game: P.now.game ?? null, viewers: P.now.viewers ?? null, note: P.now.note ?? null };
    }

    if (has('sponsors')) {
      patch.sponsors = Array.isArray(P.sponsors) ? P.sponsors.map((s: Json) => ({
        id: Number(s.id), tier: s.tier === 'main' || s.tier === 'supporter' ? s.tier : 'partner', name: String(s.name ?? ''),
        logo: safeUrl(s.logo), role: s.role ?? null, description: s.description ?? null, url: safeUrl(s.url), cta: s.cta ?? null,
        code: s.code ?? null, codeNote: s.codeNote ?? null, offerUntil: ms(s.offerUntil), overlayLine: s.overlayLine ?? null,
        socials: Object.fromEntries(Object.entries(s.socials ?? {}).map(([k, u]) => [k, safeUrl(u as string)]).filter(([, u]) => u)),
        site: s.site !== false, overlay: s.overlay !== false, from: ms(s.from), until: ms(s.until),
      })) : null;
    }
    if (has('rehearsal')) {
      const r = P.rehearsal;
      patch.rehearsal = r && r.until ? {
        until: ms(r.until)!, endsAt: ms(r.endsAt)!, pausedUntil: ms(r.pausedUntil), doubleFrom: ms(r.doubleFrom), doubleUntil: ms(r.doubleUntil),
        last: r.last ? { n: Number(r.last.n) || 0, kind: r.last.kind === 'gift' ? 'gift' : 'donation', user: String(r.last.user ?? 'TEST'), amount: Number(r.last.amount) || 0, seconds: Number(r.last.seconds) || 0, doubled: !!r.last.doubled } : null,
      } : null;
    }
    if (has('tasks')) {
      const t = P.tasks;
      patch.tasks = t && Array.isArray(t.menu) ? {
        menu: t.menu.map((m: Json) => ({ price: Number(m.price) || 0, title: String(m.title ?? '') })),
        queue: (t.queue ?? []).map((x: Json) => ({ id: Number(x.id), price: Number(x.price) || 0, title: String(x.title ?? ''), name: String(x.name ?? 'Anonim'), at: Date.parse(x.at) })),
        pending: Number(t.pending) || 0,
      } : null;
    }
    if (has('test')) {
      patch.testMode = P.test?.on && P.test.until ? { until: ms(P.test.until)!, by: P.test.by ?? null } : null;
    }
    if (has('lines') && P.lines) {
      const groups = P.lines.groups ?? {};
      patch.lines = Object.fromEntries(Object.entries(groups).filter(([, l]) => Array.isArray(l)).map(([k, l]) => [k, (l as unknown[]).map(String)]));
      patch.smallDonation = Number(P.lines.smallDonation) || 10;
    }
    if (has('advent') && Array.isArray(P.advent)) {
      patch.advent = P.advent.map((a: Json) => ({ day: Number(a.day), note: a.note ?? '', clip: safeUrl(a.clip), sponsor: a.sponsor ?? null }));
    }
    if (has('badges') && P.badges) {
      patch.badgeCounts = Object.fromEntries(Object.entries(P.badges).map(([k, n]) => [k, Number(n) || 0]));
    }

    this.data = { ...this.data, ...patch };
    const first = this.first;
    this.first = false;
    if (has('otest') && !first && P.otest?.kind) this.handlers.onTest?.(P.otest);
    if (first || Object.keys(patch).length) this.handlers.onData(patch, first);
  }

  // ---- The logged-in viewer: one call. ------------------------------------

  async refreshMe() {
    if (!this.maySignIn()) { this.handlers.onMe(null); return; }
    const db = await this.db();
    const { data: { session } } = await db.auth.getSession();
    if (!session) { this.handlers.onMe(null); return; }
    const { data: m, error } = await (db as unknown as SupabaseClient).rpc('my_state', { p_round: this.data.round?.id ?? null });
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
      bingoWon: !!m.bingoWon,
      bonusSpins: m.bonusSpins ?? 0,
      isPublic: m.public !== false,
      mine: {
        seconds: Number(m.mine?.seconds) || 0, subs: Number(m.mine?.subs) || 0, gifts: Number(m.mine?.gifts) || 0,
        bits: Number(m.mine?.bits) || 0, donated: Number(m.mine?.donated) || 0,
      },
      loyalty: m.loyalty ? {
        hours: Number(m.loyalty.hours) || 0, streak: Number(m.loyalty.streak) || 0, best: Number(m.loyalty.best) || 0,
        days: Number(m.loyalty.days) || 0, badges: Array.isArray(m.loyalty.badges) ? m.loyalty.badges.map(String) : [],
      } : null,
      lastEvent: m.lastEvent ? { id: Number(m.lastEvent.id), kind: String(m.lastEvent.kind), quantity: Number(m.lastEvent.quantity) || 0,
        seconds: Number(m.lastEvent.seconds) || 0, at: Date.parse(m.lastEvent.at) } : null,
    });
  }

  async login() {
    return (await this.db()).auth.signInWithOAuth({ provider: 'twitch', options: { redirectTo: location.origin + location.pathname } });
  }

  async logout() {
    if (this.client) await (await this.db()).auth.signOut();
    this.handlers.onMe(null);
  }

  /** "M-am abonat, verifică iar": ask the backend to re-check with Twitch, then reload. */
  async checkSub() {
    try { await (await this.db()).functions.invoke('check-sub'); } catch { /* function not deployed yet */ }
    await this.refreshMe();
  }

  async vote(roundId: number, challengeId: number) {
    const { error } = await (await this.db()).rpc('cast_vote', { p_round: roundId, p_challenge: challengeId });
    if (error) throw error;
    void this.poll();
  }

  async spin() {
    const { data, error } = await (await this.db()).rpc('spin');
    if (error) throw error;
    return data[0];
  }

  /** Secret code from the stream → 1 bonus spin. Throws with the error code. */
  async claimCode(code: string): Promise<{ sponsor: string | null; bonus_spins: number }> {
    const { data, error } = await (await this.raw()).rpc('claim_code', { p_code: code });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    await this.refreshMe();
    return data;
  }

  /** Every event after `after` (oldest first, public names): the overlay queues them all. */
  async feedSince(after: number): Promise<TickerItem[]> {
    const { data, error } = await this.anon('feed_since', { p_after: after, p_limit: 100 });
    if (error || !Array.isArray(data)) return [];
    return data.map((e: Json) => tickerItem({ id: e.id, at: ms(e.at) ?? undefined, kind: e.kind, tier: e.tier, quantity: e.quantity, currency: e.currency, seconds_added: e.seconds, user_name: e.name, user_login: null }));
  }

  /** The OBS overlay's current secret code (private key from /mod). */
  overlayCode(key: string) {
    return this.anon<{ code: string; sponsor: string | null; expires_at: string }[]>('overlay_code', { p_key: key });
  }

  /** Count a sponsor click / code copy (no personal data). */
  track(sponsor: string, kind: 'click' | 'code_copy') {
    void this.anon('track_sponsor', { p_sponsor: sponsor, p_kind: kind });
  }

  async saveBingo(items: number[]) {
    const { error } = await (await this.raw()).rpc('bingo_save', { p_items: items });
    if (error) throw error;
    void this.poll();
  }


  async suggest(body: string) {
    const { error } = await (await this.db()).rpc('suggest', { p_body: body });
    if (error) throw error;
  }
}
