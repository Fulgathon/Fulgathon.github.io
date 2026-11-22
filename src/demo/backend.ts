// Demo backend: the same rules as the real Supabase backend (time rates,
// Ora dublă, freeze, goals, vote rounds, votes, snowflakes, spins,
// suggestions, moderators), simulated in the browser for presentations.
//
// State lives in localStorage and every change is broadcast, so the site
// (?demo), the moderator page (/mod/?demo), the overlay (/overlay/?demo) and
// the presentation page (/prezentare/) all show the same subathon at once,
// in separate tabs or side by side. Nothing here touches the real database.

import challengesJson from '../../data/challenges.json';
import { defaultGoals, defaultPrizes, popSlots } from '../data/content';
import type { BoardTab, Goal, SiteData } from '../data/types';
import { amount, tickerItem } from '../lib/events';
import { ago, fmtInt } from '../lib/format';

const KEY = 'icemaraton-demo-v1';
const CHANNEL = 'icemaraton-demo';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type Viewer = 'out' | 'nonsub' | 'sub';
type Status = 'upcoming' | 'live' | 'ended';
type ChallengeStatus = 'pool' | 'in_round' | 'scheduled' | 'done' | 'vetoed';

export interface DemoEvent {
  id: number; kind: string; tier: string | null; quantity: number; currency: string | null;
  seconds_added: number; doubled: boolean; user_login: string | null; user_name: string | null; at: number;
}
interface DemoChallenge {
  id: number; title: string; how: string; level: string; category: string; votable: boolean;
  status: ChallengeStatus; scheduledFor: string | null; clip: string | null;
  wonRound?: number; wonPct?: string; doneAt?: number;
}
interface DemoRound { id: number; number: number; opensAt: number; closesAt: number; winnerId: number | null; items: { challengeId: number; votes: number }[] }
interface DemoSpin { id: number; user: string; prize: number; at: number; fulfilled: boolean }
interface DemoSuggestion { id: number; body: string; user: string; at: number; status: 'pending' | 'approved' | 'rejected' }

export interface DemoState {
  v: 2;
  seq: number;
  timer: {
    status: Status; startsAt: number | null; endsAt: number | null; pausedUntil: number | null;
    scheduledEnd: number | null; doubleFrom: number | null; doubleUntil: number | null; streamOnline: boolean;
  };
  stats: { subs: number; bits: number; raised: number };
  goals: Goal[];
  events: DemoEvent[];
  boardBase: Record<BoardTab, Record<string, number>>;
  challenges: DemoChallenge[];
  rounds: DemoRound[];
  myVotes: Record<number, number>;
  spins: DemoSpin[];
  suggestions: DemoSuggestion[];
  /** Daily wheel: minutes watched on `day` (local date), and the day of the last spin. */
  viewer: { state: Viewer; name: string; day: string; watched: number; spunDay: string | null };
  mods: string[];
  streamerConnected: boolean;
}

/** Same as the seeded `rates` table: seconds for every `per` units. */
const RATES = { tier1: [360, 1], tier2: [720, 1], tier3: [1080, 1], gift: [360, 1], bits: [240, 400], donation: [360, 1] } as const;
const WHEEL_MINUTES = 120;
const today = () => new Date().toLocaleDateString('sv-SE');
const WIN_LABELS = ['+5 minute pe cronometru', 'VIP 24 de ore', 'un shoutout live', 'un sub cadou de la Iceman',
  'alegerea următorului joc', 'o colindă de la Iceman', 'cronometrul înghețat 5 minute', 'nimic de data asta'];
const LOSE = 7;

const NAMES = ['snowdrift_tv', 'frostbyte_77', 'mistletoe_mike', 'polarpixel', 'kxtrin', 'northpole_nik', 'auroraaa',
  'yeti_yolo', 'coldbrew_cam', 'iceberg_ionut', 'fulgusor', 'zapada_rares', 'ninsoare_ana', 'sanie_sebi', 'brad_bogdan',
  'colinda_cris', 'renul_radu', 'turtadulce_tea', 'glacier_gabi', 'vifor_vlad'];
const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/** Next 21:00 local time. */
function next21(now: number) {
  const d = new Date(now);
  d.setHours(21, 0, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/** The design's sample subathon, mid-way through, as a starting point. */
function seed(now: number): DemoState {
  const challenges: DemoChallenge[] = (challengesJson as { challenges: any[] }).challenges.map((c) => ({
    id: c.id, title: c.title, how: c.how, level: c.level, category: c.category, votable: c.votable,
    status: 'pool', scheduledFor: null, clip: null,
  }));
  const ch = (id: number) => challenges.find((c) => c.id === id)!;
  // Current round 4: the design's five (closest matches in the challenge list).
  const roundItems = [[1, 412], [63, 386], [18, 248], [4, 197], [52, 143]].map(([challengeId, votes]) => ({ challengeId, votes }));
  roundItems.forEach((x) => { ch(x.challengeId).status = 'in_round'; });
  // Winners of rounds 1–3, waiting to be done.
  ([[87, 3, '41%', 'Diseară, 22:00'], [36, 2, '37%', 'Mâine, 18:00'], [101, 1, '52%', 'Mâine, 21:00']] as const)
    .forEach(([id, round, pct, when]) => Object.assign(ch(id), { status: 'scheduled', wonRound: round, wonPct: pct, scheduledFor: when }));
  // Already done.
  ([[13, 2], [5, 1.5], [3, 1]] as const).forEach(([id, daysAgo]) =>
    Object.assign(ch(id), { status: 'done', doneAt: now - daysAgo * DAY, clip: '#' }));

  const ev = (id: number, minsAgo: number, kind: string, user: string, tier: string | null, quantity: number, seconds: number, currency: string | null = null): DemoEvent =>
    ({ id, kind, tier, quantity, currency, seconds_added: seconds, doubled: false, user_login: user, user_name: user, at: now - minsAgo * MIN });

  return {
    v: 2,
    seq: 1000,
    timer: {
      status: 'live',
      startsAt: now - 2 * DAY - 3 * HOUR,
      endsAt: now + 3 * DAY + 14 * HOUR + 27 * MIN + 52_000,
      pausedUntil: null,
      scheduledEnd: now + 4 * DAY,
      doubleFrom: next21(now),
      doubleUntil: next21(now) + HOUR,
      streamOnline: true,
    },
    stats: { subs: 1284, bits: 48_500, raised: 1_180 },
    goals: defaultGoals.map((g) => ({ ...g })),
    events: [
      ev(6, 1, 'donation', 'mistletoe_mike', null, 20, 7200, 'EUR'),
      ev(5, 3, 'sub', 'frostbyte_77', '3000', 1, 1080),
      ev(4, 5, 'gift', 'snowdrift_tv', '1000', 10, 3600),
      ev(3, 8, 'donation', 'auroraaa', null, 5, 1800, 'EUR'),
      ev(2, 11, 'sub', 'kxtrin', 'prime', 1, 360),
      ev(1, 14, 'bits', 'northpole_nik', null, 400, 240),
    ],
    boardBase: {
      donations: { mistletoe_mike: 230, auroraaa: 175, polarpixel: 120, yeti_yolo: 75, kxtrin: 50 },
      gifts: { snowdrift_tv: 132, frostbyte_77: 96, mistletoe_mike: 71, polarpixel: 58, kxtrin: 44 },
      bits: { northpole_nik: 48_100, auroraaa: 31_200, frostbyte_77: 22_000, coldbrew_cam: 15_400, yeti_yolo: 9_800 },
      hours: { northpole_nik: 86, auroraaa: 79, kxtrin: 74, polarpixel: 71, frostbyte_77: 66 },
    },
    challenges,
    rounds: [{ id: 4, number: 4, opensAt: now - 20 * MIN, closesAt: now + 40 * MIN, winnerId: null, items: roundItems }],
    myVotes: {},
    spins: [
      { id: 4, user: 'yeti_yolo', prize: 2, at: now - 40 * MIN, fulfilled: true },
      { id: 3, user: 'auroraaa', prize: 5, at: now - 26 * MIN, fulfilled: true },
      { id: 2, user: 'kxtrin', prize: 0, at: now - 11 * MIN, fulfilled: true },
      { id: 1, user: 'snowdrift_tv', prize: 1, at: now - 3 * MIN, fulfilled: false },
    ],
    suggestions: [
      { id: 2, body: 'Joacă un meci doar cu portarul în atac', user: 'polarpixel', at: now - 9 * MIN, status: 'pending' },
      { id: 1, body: 'Citește comentariile chatului cu voce de Moș Crăciun', user: 'auroraaa', at: now - 32 * MIN, status: 'pending' },
    ],
    viewer: { state: 'out', name: 'viewer_name', day: today(), watched: 95, spunDay: null },
    mods: ['icemanlucky', 'frostbyte_77'],
    streamerConnected: true,
  };
}

export class DemoError extends Error {}
const fail = (code: string): never => { throw new DemoError(code); };

export class DemoBackend {
  private raw = '';
  private cached: DemoState | null = null;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;

  constructor() {
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => this.emit();
    } catch { /* old browser: storage events still sync other tabs */ }
    window.addEventListener('storage', (e) => { if (e.key === KEY) this.emit(); });
    this.load();
  }

  // ---- Storage and sync ----------------------------------------------------

  private load(): DemoState {
    let raw: string | null = null;
    try { raw = localStorage.getItem(KEY); } catch { /* storage blocked */ }
    if (raw && raw === this.raw && this.cached) return this.cached;
    if (raw) {
      try {
        const s = JSON.parse(raw) as DemoState;
        if (s.v === 2) { this.raw = raw; this.cached = s; return s; }
      } catch { /* corrupt: reseed */ }
    }
    // No saved demo (or storage blocked): start from the seed, keep it in memory.
    if (!this.cached) {
      this.cached = seed(Date.now());
      this.save(this.cached);
    }
    return this.cached;
  }

  private save(s: DemoState) {
    this.cached = s;
    this.raw = JSON.stringify(s);
    try { localStorage.setItem(KEY, this.raw); } catch { /* storage blocked: this tab only */ }
  }

  private emit() { this.listeners.forEach((fn) => fn()); }

  /** Read fresh, change, save, tell everyone. */
  private mutate<T>(fn: (s: DemoState) => T): T {
    const s = structuredClone(this.load());
    const out = fn(s);
    this.save(s);
    this.emit();
    this.channel?.postMessage('changed');
    return out;
  }

  get state(): DemoState { return this.load(); }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Back to the starting point (subathon mid-way, design sample data). */
  reset() { this.mutate((s) => { Object.assign(s, seed(Date.now())); }); }

  // ---- Twitch events (what EventSub does on the real site) -------------------

  recordEvent(kind: 'sub' | 'resub' | 'gift' | 'bits' | 'donation', user: string | null, tier: string | null, quantity = 1, currency: string | null = null) {
    return this.mutate((s) => {
      const key = kind === 'sub' || kind === 'resub' ? (tier === '2000' ? 'tier2' : tier === '3000' ? 'tier3' : 'tier1') : kind;
      const [secs, per] = RATES[key as keyof typeof RATES];
      let seconds = Math.floor((quantity / per) * secs);
      const t = s.timer;
      const now = Date.now();
      let doubled = false;
      if (t.status !== 'live' || t.endsAt === null) seconds = 0;
      else if (seconds > 0 && t.doubleFrom !== null && t.doubleUntil !== null && now >= t.doubleFrom && now < t.doubleUntil) { seconds *= 2; doubled = true; }
      if (seconds) t.endsAt = (t.endsAt ?? now) + seconds * 1000;
      s.stats.subs += kind === 'sub' || kind === 'resub' ? 1 : kind === 'gift' ? quantity : 0;
      s.stats.bits += kind === 'bits' ? quantity : 0;
      s.stats.raised += kind === 'donation' ? quantity : 0;
      const e: DemoEvent = { id: ++s.seq, kind, tier, quantity, currency, seconds_added: seconds, doubled, user_login: user, user_name: user ?? 'Anonim', at: now };
      s.events = [e, ...s.events].slice(0, 60);
      return e;
    });
  }

  /** A random, realistic event for the auto simulation. */
  randomEvent() {
    const r = Math.random();
    const user = pick(NAMES);
    if (r < 0.42) return this.recordEvent('sub', user, Math.random() < 0.25 ? 'prime' : '1000');
    if (r < 0.50) return this.recordEvent('sub', user, '2000');
    if (r < 0.55) return this.recordEvent('sub', user, '3000');
    if (r < 0.70) return this.recordEvent('resub', user, '1000');
    if (r < 0.82) return this.recordEvent('gift', user, '1000', pick([1, 1, 5, 5, 10, 20]));
    if (r < 0.95) return this.recordEvent('bits', Math.random() < 0.2 ? null : user, null, pick([100, 200, 400, 500, 1000, 2500]));
    return this.recordEvent('donation', user, null, pick([2, 5, 10, 20]), 'EUR');
  }

  setStream(online: boolean) { this.mutate((s) => { s.timer.streamOnline = online; }); }
  setStatus(status: Status) {
    this.mutate((s) => {
      s.timer.status = status;
      if (status === 'upcoming' && (!s.timer.startsAt || s.timer.startsAt < Date.now())) s.timer.startsAt = Date.now() + 6 * DAY + 9 * HOUR;
      if (status === 'live' && (!s.timer.endsAt || s.timer.endsAt < Date.now())) s.timer.endsAt = Date.now() + 3 * DAY;
    });
  }
  connectStreamer() { this.mutate((s) => { s.streamerConnected = true; }); }

  // ---- Moderator actions (the mod_* functions) --------------------------------

  startTimer(hours: number, scheduledEnd: number | null = null) {
    this.mutate((s) => {
      Object.assign(s.timer, { status: 'live', startsAt: Date.now(), endsAt: Date.now() + hours * HOUR, pausedUntil: null });
      if (scheduledEnd) s.timer.scheduledEnd = scheduledEnd;
    });
  }
  setSchedule(startsAt: number | null, scheduledEnd: number | null) { this.mutate((s) => { s.timer.startsAt = startsAt; s.timer.scheduledEnd = scheduledEnd; }); }
  addTime(minutes: number) {
    this.mutate((s) => {
      if (s.timer.status !== 'live' || s.timer.endsAt === null) fail('timer_not_live');
      const seconds = Math.round(minutes * 60);
      s.timer.endsAt! += seconds * 1000;
      s.events = [{ id: ++s.seq, kind: 'manual', tier: null, quantity: 1, currency: null, seconds_added: Math.max(0, seconds), doubled: false, user_login: null, user_name: 'ICEMARATON', at: Date.now() }, ...s.events].slice(0, 60);
    });
  }
  freeze(minutes: number) {
    this.mutate((s) => {
      if (s.timer.status !== 'live' || s.timer.endsAt === null) fail('timer_not_live');
      const now = Date.now();
      s.timer.endsAt! += minutes * MIN;
      s.timer.pausedUntil = Math.max(s.timer.pausedUntil ?? now, now) + minutes * MIN;
    });
  }
  doubleHour(from: number, minutes: number) { this.mutate((s) => { s.timer.doubleFrom = from; s.timer.doubleUntil = from + minutes * MIN; }); }
  endTimer() { this.mutate((s) => { s.timer.status = 'ended'; }); }

  openRound(challengeIds: number[], minutes: number) {
    return this.mutate((s) => {
      const now = Date.now();
      if (s.rounds.some((r) => now < r.closesAt)) fail('round_already_open');
      if (challengeIds.length < 2) fail('need_two_challenges');
      const number = Math.max(0, ...s.rounds.map((r) => r.number)) + 1;
      const round: DemoRound = { id: ++s.seq, number, opensAt: now, closesAt: now + minutes * MIN, winnerId: null, items: challengeIds.map((challengeId) => ({ challengeId, votes: 0 })) };
      s.rounds.push(round);
      s.challenges.forEach((c) => { if (challengeIds.includes(c.id)) c.status = 'in_round'; });
      return round.id;
    });
  }
  private finishRound(s: DemoState, r: DemoRound) {
    r.closesAt = Math.min(r.closesAt, Date.now());
    const total = r.items.reduce((a, x) => a + x.votes, 0);
    const winner = [...r.items].sort((a, b) => b.votes - a.votes)[0];
    r.winnerId = winner?.challengeId ?? null;
    s.challenges.forEach((c) => {
      if (c.id === r.winnerId) Object.assign(c, { status: 'scheduled', wonRound: r.number, wonPct: (total ? Math.round((winner.votes / total) * 100) : 0) + '%', scheduledFor: 'În curând' });
      else if (c.status === 'in_round' && r.items.some((x) => x.challengeId === c.id)) c.status = 'pool';
    });
  }
  closeRound(roundId: number) { this.mutate((s) => { const r = s.rounds.find((x) => x.id === roundId); if (r && r.winnerId === null) this.finishRound(s, r); }); }
  setChallenge(id: number, status: ChallengeStatus, scheduledFor?: string | null, clip?: string | null) {
    this.mutate((s) => {
      const c = s.challenges.find((x) => x.id === id);
      if (!c) return;
      c.status = status;
      if (scheduledFor) c.scheduledFor = scheduledFor;
      if (clip) c.clip = clip;
      c.doneAt = status === 'done' ? (c.doneAt ?? Date.now()) : undefined;
    });
  }
  reviewSuggestion(id: number, approve: boolean) {
    this.mutate((s) => {
      const sg = s.suggestions.find((x) => x.id === id);
      if (!sg) return;
      sg.status = approve ? 'approved' : 'rejected';
      if (approve) {
        s.challenges.push({ id: Math.max(...s.challenges.map((c) => c.id)) + 1, title: sg.body, how: `Propusă de ${sg.user}.`, level: 'mediu', category: 'propuneri', votable: true, status: 'pool', scheduledFor: null, clip: null });
      }
    });
  }
  fulfilSpin(id: number) { this.mutate((s) => { const sp = s.spins.find((x) => x.id === id); if (sp) sp.fulfilled = true; }); }
  setModerator(login: string, on: boolean) {
    this.mutate((s) => {
      const l = login.trim().toLowerCase();
      s.mods = on ? [...new Set([...s.mods, l])] : s.mods.filter((m) => m !== l);
    });
  }

  // ---- The demo viewer (what a logged-in visitor does) ----------------------

  setViewer(state: Viewer) { this.mutate((s) => { s.viewer.state = state; }); }

  castVote(challengeId: number) {
    this.mutate((s) => {
      if (s.viewer.state === 'out') fail('not_logged_in');
      if (s.viewer.state !== 'sub') fail('not_subscribed');
      const r = this.currentRound(s);
      if (!r || Date.now() >= r.closesAt) fail('round_closed');
      const old = s.myVotes[r!.id];
      if (old === challengeId) return;
      r!.items.forEach((x) => {
        if (x.challengeId === old) x.votes -= 1;
        if (x.challengeId === challengeId) x.votes += 1;
      });
      s.myVotes[r!.id] = challengeId;
    });
  }

  /** Other subscribers voting, for showing the tally move. */
  simulateVotes(n: number) {
    this.mutate((s) => {
      const r = this.currentRound(s);
      if (!r || Date.now() >= r.closesAt) fail('round_closed');
      const weights = r!.items.map((_, i) => 1 / (i + 1.5));
      const sum = weights.reduce((a, b) => a + b, 0);
      for (let k = 0; k < n; k++) {
        let x = Math.random() * sum;
        const i = weights.findIndex((w) => (x -= w) < 0);
        r!.items[i < 0 ? 0 : i].votes += 1;
      }
    });
  }

  suggest(body: string) {
    this.mutate((s) => {
      if (s.viewer.state !== 'sub') fail('not_subscribed');
      const recent = s.suggestions.filter((x) => x.user === s.viewer.name && Date.now() - x.at < 10 * MIN).length;
      if (recent >= 3) fail('too_many');
      s.suggestions.push({ id: ++s.seq, body: body.trim(), user: s.viewer.name, at: Date.now(), status: 'pending' });
    });
  }

  /** Half an hour watched today (the real site counts chat presence every 5 minutes). */
  watchHalfHour() {
    this.mutate((s) => {
      if (s.viewer.day !== today()) { s.viewer.day = today(); s.viewer.watched = 0; }
      s.viewer.watched = Math.min(600, s.viewer.watched + 30);
    });
  }

  /** Same rules as the database: live, subscriber, 2 hours watched today, once per day. */
  spin(): { prize: number; spinsLeft: number } {
    return this.mutate((s) => {
      if (s.viewer.state === 'out') fail('not_logged_in');
      if (s.timer.status !== 'live') fail('wheel_closed');
      if (s.viewer.state !== 'sub') fail('not_subscriber');
      if ((s.viewer.day === today() ? s.viewer.watched : 0) < WHEEL_MINUTES) fail('not_enough_watch');
      if (s.viewer.spunDay === today()) fail('already_spun');
      const prize = Math.floor(Math.random() * 8);
      s.viewer.spunDay = today();
      s.spins.push({ id: ++s.seq, user: s.viewer.name, prize, at: Date.now(), fulfilled: false });
      return { prize, spinsLeft: 0 };
    });
  }

  /** Milestone Maraton list from the moderator page (title + € amount). */
  setGoals(list: { title: string; threshold: number | string }[]) {
    const goals = (Array.isArray(list) ? list : []).map((g) => ({ title: String(g.title ?? '').trim(), threshold: Number(g.threshold) }));
    if (goals.length > 40 || goals.some((g) => !g.title || g.title.length > 140 || !Number.isInteger(g.threshold) || g.threshold <= 0)) fail('bad_goals');
    if (new Set(goals.map((g) => g.threshold)).size !== goals.length) fail('duplicate_amount');
    this.mutate((s) => { s.goals = goals.sort((a, b) => a.threshold - b.threshold); });
  }

  viewerInfo() {
    const s = this.load();
    const r = this.currentRound(s);
    return {
      state: s.viewer.state,
      name: s.viewer.name,
      ...(() => {
        const watched = s.viewer.day === today() ? s.viewer.watched : 0;
        const spunToday = s.viewer.spunDay === today();
        const ok = s.viewer.state === 'sub' && s.timer.status === 'live' && watched >= WHEEL_MINUTES && !spunToday;
        return { spins: ok ? 1 : 0, watchedToday: watched, spunToday };
      })(),
      myVote: r && s.myVotes[r.id] !== undefined ? String(s.myVotes[r.id]) : null,
    };
  }

  // ---- Background jobs (pg_cron on the real site) ----------------------------

  /** Close rounds whose time is up; end the subathon at zero. */
  tick() {
    const s = this.load();
    const now = Date.now();
    const due = s.rounds.some((r) => r.winnerId === null && r.closesAt <= now);
    const over = s.timer.status === 'live' && s.timer.endsAt !== null && s.timer.endsAt < now && !(s.timer.pausedUntil && s.timer.pausedUntil > now);
    if (!due && !over) return;
    this.mutate((m) => {
      m.rounds.filter((r) => r.winnerId === null && r.closesAt <= now).forEach((r) => this.finishRound(m, r));
      if (over) m.timer.status = 'ended';
    });
  }

  // ---- Views -----------------------------------------------------------------

  private currentRound(s: DemoState) {
    return [...s.rounds].filter((r) => r.opensAt <= Date.now()).sort((a, b) => b.number - a.number)[0] ?? null;
  }

  /** Everything the public page shows, in the same shape as the live data. */
  toSiteData(now = Date.now()): SiteData {
    const s = this.load();
    const r = this.currentRound(s);
    const ticker = s.events.slice(0, 12).map(tickerItem);
    const board = (tab: BoardTab, kind?: string) => {
      const totals: Record<string, number> = { ...s.boardBase[tab] };
      if (kind) for (const e of s.events) if (e.kind === kind && e.user_login) totals[e.user_login] = (totals[e.user_login] ?? 0) + e.quantity;
      return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([u, n]) => [u, fmtInt(n)] as [string, string]);
    };
    const start = s.timer.startsAt;
    return {
      status: s.timer.status,
      startsAt: s.timer.startsAt, endsAt: s.timer.endsAt, pausedUntil: s.timer.pausedUntil,
      scheduledEnd: s.timer.scheduledEnd, doubleFrom: s.timer.doubleFrom, doubleUntil: s.timer.doubleUntil,
      subs: s.stats.subs,
      raised: `${amount(s.stats.raised)} €`,
      raisedNum: s.stats.raised,
      goals: s.goals,
      ticker,
      pops: ticker.filter((t) => t.time !== '—').slice(0, popSlots.length).map((t, k) => ({ ...t, ...popSlots[k] })),
      round: r ? { id: r.id, number: r.number, closesAt: r.closesAt } : null,
      challenges: r ? r.items.map((x) => {
        const c = s.challenges.find((ch) => ch.id === x.challengeId)!;
        return { id: String(c.id), title: c.title, desc: c.how, votes: x.votes };
      }) : [],
      upNext: s.challenges.filter((c) => c.status === 'scheduled').sort((a, b) => (b.wonRound ?? 0) - (a.wonRound ?? 0))
        .map((c, i) => ({ n: i + 1, title: c.title, round: c.wonRound ?? 0, pct: c.wonPct ?? '—', when: c.scheduledFor ?? 'În curând' })),
      completed: s.challenges.filter((c) => c.status === 'done').sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 10)
        .map((c) => ({ title: c.title, when: start && c.doneAt ? `ZIUA ${Math.max(1, Math.floor((c.doneAt - start) / DAY) + 1)}` : '', clip: c.clip })),
      prizes: defaultPrizes,
      losePrize: LOSE,
      recentWins: [...s.spins].filter((x) => x.prize !== LOSE).sort((a, b) => b.at - a.at).slice(0, 4)
        .map((x) => ({ user: x.user, prize: WIN_LABELS[x.prize], ago: ago(x.at, now) })),
      boards: { donations: board('donations', 'donation'), gifts: board('gifts', 'gift'), bits: board('bits', 'bits'), hours: board('hours') },
    };
  }

  /** What the moderator page shows, in the same shape it reads from the database. */
  modState() {
    const s = this.load();
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    const r = [...s.rounds].sort((a, b) => b.number - a.number)[0];
    const title = (id: number) => s.challenges.find((c) => c.id === id)?.title ?? '';
    const toCh = (c: DemoChallenge) => ({ id: c.id, title: c.title, level: c.level, category: c.category, status: c.status, scheduled_for: c.scheduledFor });
    return {
      me: { login: 'icemanlucky', is_moderator: true },
      status: { broadcaster_login: 'icemanlucky', broadcaster_connected: s.streamerConnected, connect_url: '#connect-demo' },
      timer: {
        status: s.timer.status, stream_online: s.timer.streamOnline,
        starts_at: iso(s.timer.startsAt), ends_at: iso(s.timer.endsAt), paused_until: iso(s.timer.pausedUntil),
        scheduled_end: iso(s.timer.scheduledEnd), double_from: iso(s.timer.doubleFrom), double_until: iso(s.timer.doubleUntil),
      } as Record<string, any>,
      stats: { subs: s.stats.subs, bits: s.stats.bits, raised: s.stats.raised } as Record<string, any>,
      goals: s.goals.map((g) => ({ title: g.title, threshold: g.threshold, unlocked_at: s.stats.raised >= g.threshold ? 'yes' : null })),
      round: r ? { id: r.id, number: r.number, closes_at: iso(r.closesAt)!, winner_id: r.winnerId, items: r.items.map((x) => ({ challenge_id: x.challengeId, votes: x.votes, title: title(x.challengeId) })) } : null,
      pool: s.challenges.filter((c) => c.status === 'pool' && c.votable).map(toCh),
      scheduled: s.challenges.filter((c) => c.status === 'scheduled').map(toCh),
      suggestions: s.suggestions.filter((x) => x.status === 'pending').map((x) => ({ id: x.id, body: x.body, created_at: iso(x.at)!, viewers: { login: x.user, display_name: x.user } })),
      prizes: s.spins.filter((x) => !x.fulfilled && x.prize !== LOSE).map((x) => ({ id: x.id, user_login: x.user, created_at: iso(x.at)!, prizes: { win_label: WIN_LABELS[x.prize], is_win: true } })),
      mods: s.mods.map((login) => ({ login, display_name: login === 'icemanlucky' ? 'Icemanlucky' : null })),
    };
  }

  /** The moderator page calls the same function names as on the real site. */
  rpc(fn: string, a: Record<string, any>): unknown {
    const ms = (iso: string | null) => (iso ? Date.parse(iso) : null);
    switch (fn) {
      case 'mod_set_schedule': return this.setSchedule(ms(a.p_starts_at), ms(a.p_scheduled_end));
      case 'mod_start_timer': return this.startTimer(Number(a.p_hours), ms(a.p_scheduled_end));
      case 'mod_add_time': return this.addTime(Number(a.p_minutes));
      case 'mod_freeze': return this.freeze(Number(a.p_minutes));
      case 'mod_double_hour': return this.doubleHour(ms(a.p_from) ?? Date.now(), Number(a.p_minutes) || 60);
      case 'mod_end_timer': return this.endTimer();
      case 'mod_open_round': return this.openRound(a.p_challenges, Number(a.p_minutes) || 60);
      case 'mod_close_round': return this.closeRound(Number(a.p_round));
      case 'mod_set_challenge': return this.setChallenge(Number(a.p_id), a.p_status, a.p_scheduled_for, a.p_clip);
      case 'mod_review_suggestion': return this.reviewSuggestion(Number(a.p_id), !!a.p_approve);
      case 'mod_fulfil_spin': return this.fulfilSpin(Number(a.p_id));
      case 'mod_set_moderator': return this.setModerator(String(a.p_login), !!a.p_on);
      case 'mod_set_goals': return this.setGoals(a.p_goals);
      default: return fail(`unknown_${fn}`);
    }
  }
}
