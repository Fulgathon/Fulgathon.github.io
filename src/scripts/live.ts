// Live data from Supabase: loads everything the page shows, keeps it fresh
// with realtime subscriptions, and wraps the viewer actions (login, vote,
// spin, suggest). Loaded lazily, and never in ?demo mode.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { popSlots, prizeColors } from '../data/content';
import { site } from '../data/site';
import type { BoardTab, Completed, Prize, SiteData, UpNext } from '../data/types';
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
}

export interface LiveHandlers {
  /** Called with fresh data; `first` is true for the initial full load. */
  onData(patch: Patch, first: boolean): void;
  onMe(me: Me | null): void;
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);

export class Live {
  readonly db: DB;
  private data: SiteData;
  private pending = new Set<string>();
  private timer: number | undefined;
  private handlers: LiveHandlers;
  private subChecked = false;

  constructor(initial: SiteData, handlers: LiveHandlers) {
    this.data = initial;
    this.handlers = handlers;
    this.db = createClient<Database>(site.supabase.url, site.supabase.publishableKey, {
      auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }

  async start() {
    await this.refresh(Object.keys(this.loaders), true);
    this.subscribe();
    this.db.auth.onAuthStateChange(() => { void this.refreshMe(); });
    // Safety net for anything realtime missed (and the "acum 3 min" labels).
    window.setInterval(() => this.queue(...Object.keys(this.loaders)), 60_000);
    // Watch minutes for the daily wheel are credited every 5 minutes.
    window.setInterval(() => { void this.refreshMe(); }, 120_000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.queue(...Object.keys(this.loaders), 'me');
    });
  }

  // ---- Loaders: each returns the part of SiteData it owns. ----------------

  /** Bingo tables aren't in the generated types; this is the same client, untyped. */
  private get raw() { return this.db as unknown as SupabaseClient; }

  private loaders: Record<string, () => Promise<Patch>> = {
    bingo: async () => {
      const [{ data: items }, { data: set }, { data: stats }] = await Promise.all([
        this.raw.from('bingo_items').select('id, label, happened_at').order('position'),
        this.raw.from('bingo_settings').select('closes_at, prize, prize_sponsor').eq('id', 1).maybeSingle(),
        this.raw.rpc('bingo_stats'),
      ]);
      if (!items) return {};
      return {
        bingo: {
          closesAt: ms(set?.closes_at ?? null), prize: set?.prize ?? '', prizeSponsor: set?.prize_sponsor ?? null, players: stats?.[0]?.players ?? 0,
          items: items.map((i: { id: number; label: string; happened_at: string | null }) => ({ id: i.id, label: i.label, happened: !!i.happened_at })),
        },
      };
    },
    timer: async () => {
      const { data: t } = await this.db.from('timer').select('*').eq('id', 1).maybeSingle();
      if (!t) return {};
      return {
        status: t.status as SiteData['status'],
        startsAt: ms(t.starts_at), endsAt: ms(t.ends_at),
        pausedUntil: ms(t.paused_until), scheduledEnd: ms(t.scheduled_end),
        doubleSponsor: (t as { double_sponsor?: string | null }).double_sponsor ?? null,
        doubleFrom: ms(t.double_from), doubleUntil: ms(t.double_until),
      };
    },
    stats: async () => {
      const { data: s } = await this.db.from('stats').select('subs, raised').eq('id', 1).maybeSingle();
      return s ? { subs: s.subs, raised: `${amount(Number(s.raised))} €`, raisedNum: Number(s.raised) } : {};
    },
    goals: async () => {
      const { data } = await this.raw.from('goals').select('title, threshold, sponsor').order('position');
      return data?.length ? { goals: data } : {};
    },

    events: async () => {
      const { data } = await this.db.from('events').select('*').order('id', { ascending: false }).limit(12);
      const items = (data ?? []).map(tickerItem);
      return {
        ticker: items,
        pops: items.filter((i) => i.time !== '—').slice(0, popSlots.length).map((i, k) => ({ ...i, ...popSlots[k] })),
      };
    },
    round: async () => {
      const { data: rounds } = await this.db.from('vote_rounds')
        .select('id, number, closes_at').lte('opens_at', new Date().toISOString())
        .order('opens_at', { ascending: false }).limit(1);
      const r = rounds?.[0];
      if (!r) return { round: null, challenges: [] };
      const { data: rc } = await this.db.from('round_challenges')
        .select('challenge_id, votes, challenges(title, how)').eq('round_id', r.id).order('position');
      return {
        round: { id: r.id, number: r.number, closesAt: Date.parse(r.closes_at) },
        challenges: (rc ?? []).map((x) => ({
          id: String(x.challenge_id), title: x.challenges?.title ?? '', desc: x.challenges?.how ?? '', votes: x.votes,
        })),
      };
    },
    upNext: async () => {
      const { data: rounds } = await this.db.from('vote_rounds')
        .select('number, winner_id, round_challenges(challenge_id, votes)')
        .not('winner_id', 'is', null).order('number', { ascending: false }).limit(20);
      const ids = (rounds ?? []).map((r) => r.winner_id as number);
      if (!ids.length) return { upNext: [] };
      const { data: ch } = await this.db.from('challenges').select('id, title, status, scheduled_for').in('id', ids);
      const byId = new Map((ch ?? []).map((c) => [c.id, c]));
      const upNext: UpNext[] = [];
      for (const r of rounds ?? []) {
        const c = byId.get(r.winner_id as number);
        if (!c || c.status !== 'scheduled') continue;
        const total = r.round_challenges.reduce((a, x) => a + x.votes, 0);
        const won = r.round_challenges.find((x) => x.challenge_id === c.id)?.votes ?? 0;
        upNext.push({
          n: upNext.length + 1, title: c.title, round: r.number,
          pct: (total ? Math.round((won / total) * 100) : 0) + '%', when: c.scheduled_for || 'În curând',
        });
      }
      return { upNext };
    },
    completed: async () => {
      const { data } = await this.db.from('challenges').select('title, done_at, clip_url')
        .eq('status', 'done').order('done_at', { ascending: false }).limit(10);
      const start = this.data.startsAt;
      const completed: Completed[] = (data ?? []).map((c) => {
        const done = ms(c.done_at);
        const when = done && start ? `ZIUA ${Math.floor((done - start) / 86_400_000) + 1}` : done ? dateRo(done).toUpperCase() : '';
        return { title: c.title, when, clip: c.clip_url };
      });
      return { completed };
    },
    prizes: async () => {
      const { data } = await this.raw.from('prizes').select('position, short_label, full_label, is_win, sponsor').order('position');
      if (!data?.length) return {};
      const prizes: Prize[] = data.map((p: { position: number; short_label: string; full_label: string; sponsor: string | null }) =>
        [p.short_label, p.full_label, prizeColors[p.position] ?? '#F2F5FA', p.sponsor]);
      const lose = data.find((p: { is_win: boolean }) => !p.is_win);
      return { prizes, losePrize: lose ? lose.position : -1 };
    },
    wins: async () => {
      type Row = { user_login: string; created_at: string; prizes: { win_label: string | null; is_win: boolean; sponsor: string | null } | null };
      const { data } = await this.raw.from('spins').select('user_login, created_at, prizes(win_label, is_win, sponsor)')
        .order('created_at', { ascending: false }).limit(12);
      const now = Date.now();
      return {
        recentWins: ((data ?? []) as unknown as Row[]).filter((s) => s.prizes?.is_win).slice(0, 4)
          .map((s) => ({ user: s.user_login, prize: s.prizes?.win_label ?? '', ago: ago(Date.parse(s.created_at), now), sponsor: s.prizes?.sponsor ?? null })),
      };
    },
    boards: async () => {
      const views = { donations: 'leaderboard_donations', gifts: 'leaderboard_gifts', bits: 'leaderboard_bits', hours: 'leaderboard_hours' } as const;
      const entries = await Promise.all((Object.keys(views) as BoardTab[]).map(async (tab) => {
        const { data } = await this.db.from(views[tab]).select('user_login, user_name, total').limit(5);
        return [tab, (data ?? []).map((r) => [r.user_name || r.user_login || '', fmtInt(r.total ?? 0)] as [string, string])] as const;
      }));
      return { boards: Object.fromEntries(entries) as SiteData['boards'] };
    },
  };

  /** Run some loaders now (in parallel) and hand the merged result over. */
  private async refresh(names: string[], first = false) {
    const parts = await Promise.all(names.filter((n) => n in this.loaders).map((n) => this.loaders[n]().catch(() => ({}))));
    const patch = Object.assign({}, ...parts) as Patch;
    this.data = { ...this.data, ...patch };
    this.handlers.onData(patch, first);
    if (first || names.includes('me')) await this.refreshMe();
  }

  /** Batch realtime bursts (a 50-gift bomb is 50 events) into one refresh. */
  private queue(...names: string[]) {
    names.forEach((n) => this.pending.add(n));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      const list = [...this.pending];
      this.pending.clear();
      void this.refresh(list);
    }, 300);
  }

  private subscribe() {
    const watch: Record<string, string[]> = {
      timer: ['timer', 'completed'],
      stats: ['stats'],
      goals: ['goals'],
      events: ['events', 'boards'],
      spins: ['wins', 'me'],
      vote_rounds: ['round', 'upNext', 'completed'],
      round_challenges: ['round'],
      bingo_items: ['bingo'],
      bingo_settings: ['bingo'],
    };
    const ch = this.db.channel('icemaraton');
    for (const [table, loaders] of Object.entries(watch)) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => this.queue(...loaders));
    }
    ch.subscribe();
  }

  // ---- The logged-in viewer. ----------------------------------------------

  async refreshMe() {
    const { data: { session } } = await this.db.auth.getSession();
    if (!session) { this.handlers.onMe(null); return; }
    const [{ data: v }, { data: ws }] = await Promise.all([
      this.db.from('viewers').select('login, display_name, is_subscriber, sub_checked_at').eq('id', session.user.id).maybeSingle(),
      this.db.rpc('wheel_status'),
    ]);
    // First visit after login (or an old answer): ask Twitch whether they're subscribed.
    const checkedAt = v?.sub_checked_at ? Date.parse(v.sub_checked_at) : 0;
    if (v && !this.subChecked && Date.now() - checkedAt > 10 * 60_000) {
      this.subChecked = true;
      void this.checkSub();
    }
    let myVote: string | null = null;
    if (this.data.round) {
      const { data: vote } = await this.db.from('votes').select('challenge_id')
        .eq('round_id', this.data.round.id).eq('viewer_id', session.user.id).maybeSingle();
      myVote = vote ? String(vote.challenge_id) : null;
    }
    const w = ws?.[0];
    const { data: bp } = await this.raw.from('bingo_picks').select('items').eq('viewer_id', session.user.id).maybeSingle();
    this.handlers.onMe({
      name: v?.display_name || v?.login || 'viewer',
      isSub: !!v?.is_subscriber,
      spins: w?.spins_available ?? 0,
      watchedToday: w?.minutes_today ?? 0,
      spunToday: !!w?.spun_today,
      myVote,
      bingoSaved: Array.isArray(bp?.items) ? bp.items.map(Number) : null,
      bonusSpins: (w as { bonus_spins?: number } | undefined)?.bonus_spins ?? 0,
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
    this.queue('round');
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
    this.queue('bingo');
  }

  async suggest(body: string) {
    const { error } = await this.db.rpc('suggest', { p_body: body });
    if (error) throw error;
  }
}
