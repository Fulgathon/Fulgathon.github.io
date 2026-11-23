// Demo backend: the same rules as the real Supabase backend (time rates,
// Ora dublă, freeze, goals, vote rounds, votes, snowflakes, spins,
// suggestions, moderators), simulated in the browser for presentations.
//
// State lives in localStorage and every change is broadcast, so the site
// (?demo), the moderator page (/mod/?demo), the overlay (/overlay/?demo) and
// the presentation page (/prezentare/) all show the same subathon at once,
// in separate tabs or side by side. Nothing here touches the real database.

import challengesJson from '../../data/challenges.json';
import { bingoItems, defaultGoals, defaultPrizes, popSlots, prizeColors } from '../data/content';
import type { BoardTab, Goal, Prize, SiteData } from '../data/types';
import { amount, tickerItem } from '../lib/events';
import { ago, fmtInt } from '../lib/format';

// ?demo=pitch (the sponsor presentation) keeps its own copy, apart from ?demo.
const VARIANT = typeof location !== 'undefined' ? (new URLSearchParams(location.search).get('demo') ?? '').replace(/[^a-z0-9-]/gi, '') : '';
const keyFor = (v: string) => (v ? `icemaraton-demo-${v}-v1` : 'icemaraton-demo-v1');
const channelFor = (v: string) => (v ? `icemaraton-demo-${v}` : 'icemaraton-demo');
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
  /** Moderator note for "Acum pe stream" and the community goal list (demo only). */
  note?: { text: string; until: number } | null;
  communityGoals?: { title: string; hours: number }[];
  /** Moderator name rules (hide / allow), like private.name_rules. */
  nameRules?: { name: string; rule: 'hide' | 'allow'; at: number }[];
  v: 6;
  seq: number;
  timer: {
    status: Status; startsAt: number | null; endsAt: number | null; pausedUntil: number | null;
    scheduledEnd: number | null; doubleFrom: number | null; doubleUntil: number | null; streamOnline: boolean;
    doubleSponsor: string | null;
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
  viewer: { state: Viewer; name: string; day: string; watched: number; spunDay: string | null; bonus: number };
  /** Wheel slices as moderators set them (labels, sponsor, win or not, weight). */
  prizes: { short: string; full: string; win: string; sponsor: string | null; isWin: boolean; weight: number }[];
  /** Secret codes shown on stream (newest first) and the viewer's claims. */
  codes: { code: string; sponsor: string | null; shownAt: number; expiresAt: number; claims: number; mine: boolean }[];
  promo: { clicks: number; copies: number; doubleHours: number; donatedInHours: number };
  mods: string[];
  streamerConnected: boolean;
  /** Prediction bingo: the viewer's pick plus simulated players' picks. */
  bingo: {
    closesAt: number | null; prize: string; prizeSponsor?: string | null;
    items: { id: number; label: string; happened: boolean }[];
    pick: number[] | null;
    others: { user: string; items: number[] }[];
    draws: string[];
  };
}

/** Same as the seeded `rates` table: seconds for every `per` units. */
const RATES = { tier1: [360, 1], tier2: [720, 1], tier3: [1080, 1], gift: [360, 1], bits: [240, 400], donation: [360, 1] } as const;
const WHEEL_MINUTES = 120;
const today = () => new Date().toLocaleDateString('sv-SE');
/** The 12 lines of a 5×5 bingo card (ids row by row), each sorted. */
function bingoLines(ids: number[]): number[][] {
  if (ids.length !== 25) return [];
  const L = [
    ...[0, 1, 2, 3, 4].map((r) => ids.slice(r * 5, r * 5 + 5)),
    ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((j) => ids[c + 5 * j])),
    [0, 1, 2, 3, 4].map((j) => ids[6 * j]),
    [0, 1, 2, 3, 4].map((j) => ids[20 - 4 * j]),
  ];
  return L.map((l) => [...l].sort((a, b) => a - b));
}
const WIN_LABELS = ['+5 minute pe cronometru', 'VIP 24 de ore', 'un shoutout live', 'un sub cadou de la Iceman',
  'alegerea următorului joc', 'o colindă de la Iceman', 'cronometrul înghețat 5 minute', 'nimic de data asta'];
const LOSE = 7;

const NAMES = ['vladutz97', 'Rares1337', 'andreiGG', 'cristi_lol', 'kxtrin', 'teo_mid', 'dianaplays',
  'xBogdy', 'mihai_tzr', 'ionutz95', 'alexx_ro', 'sebi_jgl', 'darius_ro', 'sebastian_77', 'bogdan_adc',
  'crisss', 'radu_nexus', 'teodora_x', 'gabi_supp', 'vlad_tz'];
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
    v: 6,
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
      doubleSponsor: 'Zona IT',
    },
    stats: { subs: 1284, bits: 48_500, raised: 1_180 },
    goals: defaultGoals.map((g, i) => ({ ...g, sponsor: i === 5 || i === 8 ? 'Zona IT' : null })),
    events: [
      ev(6, 1, 'donation', 'andreiGG', null, 20, 7200, 'EUR'),
      ev(5, 3, 'sub', 'Rares1337', '3000', 1, 1080),
      ev(4, 5, 'gift', 'vladutz97', '1000', 10, 3600),
      ev(3, 8, 'donation', 'dianaplays', null, 5, 1800, 'EUR'),
      ev(2, 11, 'sub', 'kxtrin', 'prime', 1, 360),
      ev(1, 14, 'bits', 'teo_mid', null, 400, 240),
    ],
    boardBase: {
      donations: { andreiGG: 230, dianaplays: 175, cristi_lol: 120, xBogdy: 75, kxtrin: 50 },
      gifts: { vladutz97: 132, Rares1337: 96, andreiGG: 71, cristi_lol: 58, kxtrin: 44 },
      bits: { teo_mid: 48_100, dianaplays: 31_200, Rares1337: 22_000, mihai_tzr: 15_400, xBogdy: 9_800 },
      hours: { teo_mid: 86, dianaplays: 79, kxtrin: 74, cristi_lol: 71, Rares1337: 66 },
    },
    challenges,
    rounds: [{ id: 4, number: 4, opensAt: now - 20 * MIN, closesAt: now + 40 * MIN, winnerId: null, items: roundItems }],
    myVotes: {},
    spins: [
      { id: 4, user: 'xBogdy', prize: 2, at: now - 40 * MIN, fulfilled: true },
      { id: 3, user: 'dianaplays', prize: 5, at: now - 26 * MIN, fulfilled: true },
      { id: 2, user: 'kxtrin', prize: 0, at: now - 11 * MIN, fulfilled: true },
      { id: 1, user: 'vladutz97', prize: 1, at: now - 3 * MIN, fulfilled: false },
    ],
    suggestions: [
      { id: 2, body: 'Joacă un meci doar cu portarul în atac', user: 'cristi_lol', at: now - 9 * MIN, status: 'pending' },
      { id: 1, body: 'Citește comentariile chatului cu voce de Moș Crăciun', user: 'dianaplays', at: now - 32 * MIN, status: 'pending' },
    ],
    viewer: { state: 'out', name: 'viewer_name', day: today(), watched: 95, spunDay: null, bonus: 0 },
    prizes: defaultPrizes.map((p, i) => ({ short: p[0], full: p[1], win: WIN_LABELS[i], sponsor: i === 1 || i === 3 ? 'Zona IT' : null, isWin: i !== LOSE, weight: 1 })),
    codes: [{ code: 'K7Q-2MV', sponsor: 'Zona IT', shownAt: now - 3 * HOUR, expiresAt: now - 3 * HOUR + 10 * MIN, claims: 212, mine: false }],
    promo: { clicks: 184, copies: 57, doubleHours: 2, donatedInHours: 640 },
    mods: ['icemanlucky', 'Rares1337'],
    streamerConnected: true,
    bingo: {
      closesAt: now + 2 * DAY + 5 * HOUR,
      prize: '[PREMIU]',
      items: bingoItems.map((label, i) => ({ id: i + 1, label, happened: false })),
      pick: null,
      // 340 simulated players, each with a random line of the card.
      others: Array.from({ length: 340 }, (_, k) => ({
        user: k < NAMES.length ? NAMES[k] : `viewer_${k}`,
        items: pick(bingoLines(bingoItems.map((_, i) => i + 1))),
      })),
      draws: [],
    },
  };
}

export class DemoError extends Error {}
const fail = (code: string): never => { throw new DemoError(code); };

export class DemoBackend {
  private raw = '';
  private cached: DemoState | null = null;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;

  private readonly KEY: string;
  private readonly CHANNEL: string;

  /** `variant` picks a separate copy (e.g. 'pitch'); by default it follows ?demo=… in the address. */
  constructor(variant: string = VARIANT) {
    this.KEY = keyFor(variant);
    this.CHANNEL = channelFor(variant);
    try {
      this.channel = new BroadcastChannel(this.CHANNEL);
      this.channel.onmessage = () => this.emit();
    } catch { /* old browser: storage events still sync other tabs */ }
    window.addEventListener('storage', (e) => { if (e.key === this.KEY) this.emit(); });
    this.load();
  }

  // ---- Storage and sync ----------------------------------------------------

  private load(): DemoState {
    let raw: string | null = null;
    try { raw = localStorage.getItem(this.KEY); } catch { /* storage blocked */ }
    if (raw && raw === this.raw && this.cached) return this.cached;
    if (raw) {
      try {
        const s = JSON.parse(raw) as DemoState;
        if (s.v === 6) { this.raw = raw; this.cached = s; return s; }
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
    try { localStorage.setItem(this.KEY, this.raw); } catch { /* storage blocked: this tab only */ }
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
  freezeUntil(until: number) {
    const now = Date.now();
    const from = Math.max(this.state.timer.pausedUntil ?? now, now);
    if (until <= from) fail('freeze_in_past');
    this.freeze((until - from) / MIN);
  }
  unfreeze() {
    this.mutate((s) => {
      const now = Date.now();
      if (!s.timer.pausedUntil || s.timer.pausedUntil <= now) return;
      if (s.timer.endsAt !== null) s.timer.endsAt -= s.timer.pausedUntil - now;
      s.timer.pausedUntil = now;
    });
  }

  // ---- Bingo (same rules as the database) ------------------------------------
  saveBingo(items: number[]) {
    this.mutate((s) => {
      if (s.viewer.state === 'out') fail('not_logged_in');
      if (s.bingo.closesAt !== null && Date.now() >= s.bingo.closesAt) fail('bingo_closed');
      const ids = [...new Set(items.map(Number))].sort((a, b) => a - b);
      if (!bingoLines(s.bingo.items.map((it) => it.id)).some((l) => l.join() === ids.join())) fail('not_a_line');
      s.bingo.pick = ids;
    });
  }
  setNote(text: string, minutes: number) {
    this.mutate((s) => { s.note = text.trim() ? { text: text.trim().slice(0, 140), until: Date.now() + Math.max(1, Math.min(1440, minutes)) * 60_000 } : null; });
  }
  setCommunityGoals(list: { title: string; hours: number }[]) {
    this.mutate((s) => { s.communityGoals = list.filter((g) => g.title.trim() && g.hours > 0).map((g) => ({ title: g.title.trim(), hours: g.hours })).sort((a, b) => a.hours - b.hours); });
  }
  nameRule(name: string, rule: 'hide' | 'allow' | null) {
    const k = name.trim().toLowerCase();
    if (!k) throw new Error('empty_name');
    this.mutate((s) => {
      s.nameRules = (s.nameRules ?? []).filter((r) => r.name !== k);
      if (rule) s.nameRules.unshift({ name: k, rule, at: Date.now() });
    });
  }
  bingoTick(id: number, happened: boolean) { this.mutate((s) => { const it = s.bingo.items.find((x) => x.id === id); if (it) it.happened = happened; }); }
  bingoSettings(closesAt: number | null, prize: string, prizeSponsor: string | null = null) {
    this.mutate((s) => { s.bingo.closesAt = closesAt; if (prize.trim()) s.bingo.prize = prize.trim(); s.bingo.prizeSponsor = prizeSponsor?.trim() || null; });
  }
  setBingoItems(list: { id?: number | string; label: string }[]) {
    this.mutate((s) => {
      if (!Array.isArray(list) || list.length !== 25) fail('need_25');
      if (list.some((x) => !String(x.label ?? '').trim() || String(x.label).length > 80)) fail('bad_items');
      const picked = s.bingo.pick !== null || s.bingo.others.length > 0;
      if (picked && list.map((x) => Number(x.id)).join() !== s.bingo.items.map((it) => it.id).join()) fail('card_locked');
      let next = Math.max(0, ...s.bingo.items.map((x) => x.id));
      s.bingo.items = list.map((x) => {
        const old = s.bingo.items.find((it) => it.id === Number(x.id));
        return old ? { ...old, label: String(x.label).trim() } : { id: ++next, label: String(x.label).trim(), happened: false };
      });
    });
  }
  private bingoWinners(s: DemoState) {
    const done = (ids: number[]) => ids.every((id) => s.bingo.items.find((it) => it.id === id)?.happened);
    const list = s.bingo.others.filter((o) => done(o.items)).map((o) => o.user);
    if (s.bingo.pick && done(s.bingo.pick)) list.unshift(s.viewer.name);
    return list;
  }
  bingoDraw(): string {
    return this.mutate((s) => {
      const pool = this.bingoWinners(s).filter((u) => !s.bingo.draws.includes(u));
      if (!pool.length) fail('no_bingo_winners');
      const won = pick(pool);
      s.bingo.draws.unshift(won);
      return won;
    });
  }

  doubleHour(from: number, minutes: number, sponsor: string | null = null) {
    this.mutate((s) => { s.timer.doubleFrom = from; s.timer.doubleUntil = from + minutes * MIN; s.timer.doubleSponsor = sponsor?.trim() || null; });
  }

  // ---- Secret codes (same rules as the database) ------------------------------
  currentCode() { const now = Date.now(); return this.load().codes.find((c) => c.shownAt <= now && c.expiresAt > now) ?? null; }
  codeShow(sponsor: string | null, minutes = 10) {
    return this.mutate((s) => {
      const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const r = () => A[Math.floor(Math.random() * A.length)];
      const now = Date.now();
      s.codes.forEach((c) => { if (c.expiresAt > now) c.expiresAt = now; });
      const c = { code: `${r()}${r()}${r()}-${r()}${r()}${r()}`, sponsor: sponsor?.trim() || null, shownAt: now, expiresAt: now + minutes * MIN, claims: 0, mine: false };
      s.codes.unshift(c);
      s.codes = s.codes.slice(0, 20);
      return { code: c.code, sponsor: c.sponsor, expires_at: new Date(c.expiresAt).toISOString() };
    });
  }
  codeEnd() { this.mutate((s) => { const now = Date.now(); s.codes.forEach((c) => { if (c.expiresAt > now) c.expiresAt = now; }); }); }
  claimCode(code: string): string | null {
    return this.mutate((s) => {
      if (s.viewer.state === 'out') fail('not_logged_in');
      const norm = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const now = Date.now();
      const c = s.codes.find((x) => x.code.replace('-', '') === norm && x.shownAt <= now && x.expiresAt > now);
      if (!c) fail('bad_code');
      if (c!.mine) fail('already_claimed');
      c!.mine = true; c!.claims += 1; s.viewer.bonus += 1;
      return c!.sponsor;
    });
  }
  setPrizes(list: { short_label: string; full_label: string; win_label?: string; sponsor?: string; is_win?: boolean; weight?: number | string }[]) {
    this.mutate((s) => {
      if (!Array.isArray(list) || list.length !== 8) fail('need_8');
      if (list.some((p) => !String(p.short_label ?? '').trim() || String(p.short_label).length > 16 || !String(p.full_label ?? '').trim())) fail('bad_prizes');
      s.prizes = list.map((p) => ({
        short: String(p.short_label).trim(), full: String(p.full_label).trim(),
        win: String(p.win_label ?? '').trim() || String(p.full_label).trim(),
        sponsor: String(p.sponsor ?? '').trim() || null, isWin: p.is_win !== false, weight: Math.max(0, Number(p.weight ?? 1) || 0),
      }));
    });
  }
  sponsorReport() {
    const s = this.load();
    const names = new Set<string>([
      ...s.prizes.map((p) => p.sponsor), ...s.goals.map((g) => g.sponsor ?? null), s.timer.doubleSponsor, s.bingo.prizeSponsor ?? null, ...s.codes.map((c) => c.sponsor),
    ].filter((x): x is string => !!x));
    return {
      peak_chatters: 4120, watch_hours: 38500, raised: s.stats.raised,
      sponsors: [...names].sort().map((name) => {
        // The main partner (on the Ora dublă) gets the main-partner sample numbers.
        const main = name === (s.timer.doubleSponsor ?? 'Zona IT');
        return {
          sponsor: name, clicks: main ? s.promo.clicks : 23, code_copies: main ? s.promo.copies : 0,
          codes_shown: s.codes.filter((c) => c.sponsor === name).length,
          code_claims: s.codes.filter((c) => c.sponsor === name).reduce((a, c) => a + c.claims, 0),
          double_hours: main ? s.promo.doubleHours : 0, donated_in_hours: main ? s.promo.donatedInHours : 0, peak_in_hours: main ? 3870 : null,
          wins: s.spins.filter((x) => s.prizes[x.prize]?.sponsor === name && s.prizes[x.prize]?.isWin).length,
          milestones: s.goals.filter((g) => g.sponsor === name).length,
          milestones_unlocked: s.goals.filter((g) => g.sponsor === name && s.stats.raised >= g.threshold).length,
        };
      }),
    };
  }
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
      const watched = s.viewer.day === today() ? s.viewer.watched : 0;
      const dailyOk = s.viewer.state === 'sub' && watched >= WHEEL_MINUTES && s.viewer.spunDay !== today();
      if (!dailyOk && s.viewer.bonus <= 0) {
        if (s.viewer.state !== 'sub') fail('not_subscriber');
        if (watched < WHEEL_MINUTES) fail('not_enough_watch');
        fail('already_spun');
      }
      // Weighted, like the database.
      const total = s.prizes.reduce((a, p) => a + p.weight, 0) || 1;
      let pick = Math.random() * total, prize = 0;
      for (let i = 0; i < s.prizes.length; i++) { if (pick < s.prizes[i].weight) { prize = i; break; } pick -= s.prizes[i].weight; }
      if (dailyOk) s.viewer.spunDay = today(); else s.viewer.bonus -= 1;
      s.spins.push({ id: ++s.seq, user: s.viewer.name, prize, at: Date.now(), fulfilled: false });
      return { prize, spinsLeft: s.viewer.bonus };
    });
  }

  // ---- For the sponsor presentation ------------------------------------------
  /** A random viewer wins a prize (a sponsored one when there is). */
  fakeWin() {
    this.mutate((s) => {
      const wins = s.prizes.map((p, i) => ({ p, i })).filter((x) => x.p.isWin);
      const sponsored = wins.filter((x) => x.p.sponsor);
      const w = pick(sponsored.length ? sponsored : wins);
      s.spins.push({ id: ++s.seq, user: pick(NAMES), prize: w.i, at: Date.now(), fulfilled: false });
    });
  }
  /** n viewers claim the code on screen. */
  simulateClaims(n: number) {
    this.mutate((s) => { const now = Date.now(); const c = s.codes.find((x) => x.shownAt <= now && x.expiresAt > now); if (c) c.claims += n; });
  }
  /** Put a brand on wheel slices, the next milestone and the bingo prize. */
  brandEverything(brand: string) {
    this.mutate((s) => {
      s.prizes.forEach((p, i) => { p.sponsor = i === 1 || i === 3 ? brand : p.sponsor === brand ? null : p.sponsor; });
      const next = s.goals.find((g) => g.threshold > s.stats.raised);
      s.goals.forEach((g) => { if (g === next) g.sponsor = brand; else if (g.sponsor && g.sponsor !== brand) g.sponsor = null; });
      s.bingo.prizeSponsor = brand;
      s.codes.forEach((c) => { c.sponsor = brand; });
      if (s.bingo.prize.startsWith('[')) s.bingo.prize = 'căști de gaming';
    });
  }

  /** Milestone Maraton list from the moderator page (title + € amount). */
  setGoals(list: { title: string; threshold: number | string }[]) {
    const goals = (Array.isArray(list) ? list : []).map((g) => ({ title: String(g.title ?? '').trim(), threshold: Number(g.threshold), sponsor: String((g as { sponsor?: string }).sponsor ?? '').trim() || null }));
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
        const bonus = s.viewer.state === 'out' ? 0 : s.viewer.bonus;
        return { spins: (ok ? 1 : 0) + (s.timer.status === 'live' ? bonus : 0), watchedToday: watched, spunToday, bonusSpins: bonus };
      })(),
      bingoSaved: s.viewer.state === 'out' ? null : s.bingo.pick,
      myVote: r && s.myVotes[r.id] !== undefined ? String(s.myVotes[r.id]) : null,
      // Sample contribution and loyalty for the demo viewer.
      mine: { seconds: 5400, subs: 1, gifts: 5, bits: 0, donated: 20 },
      loyalty: { hours: 23, streak: 4, best: 6, days: 9, badges: ['og', 'h10'] },
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

  /** Today's totals, Fidelii, the community goal and "Acum pe stream", like the live parts. */
  private community(s: DemoState, now: number) {
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const todayEv = s.events.filter((e) => e.at >= midnight.getTime());
    const people = new Set(todayEv.map((e) => (e.user_login || e.user_name || '').toLowerCase()).filter(Boolean));
    // A busy day so far (sample), plus what happens in the demo.
    return {
      today: {
        seconds: 4 * 3600 + 12 * 60 + todayEv.reduce((a, e) => a + e.seconds_added, 0),
        people: 230 + people.size,
        subs: 57 + todayEv.reduce((a, e) => a + (e.kind === 'gift' ? e.quantity : e.kind === 'sub' || e.kind === 'resub' ? 1 : 0), 0),
        donated: 340 + todayEv.reduce((a, e) => a + (e.kind === 'donation' ? e.quantity : 0), 0),
        bits: 12_400 + todayEv.reduce((a, e) => a + (e.kind === 'bits' ? e.quantity : 0), 0),
        events: 96 + todayEv.length,
      },
      loyal: [
        { name: 'teo_mid', hours: 86, streak: 9, badges: ['og', 'night', 'h50', 'streak7'] },
        { name: 'dianaplays', hours: 79, streak: 9, badges: ['og', 'h50', 'streak7'] },
        { name: 'kxtrin', hours: 74, streak: 6, badges: ['night', 'h50'] },
        { name: 'cristi_lol', hours: 71, streak: 8, badges: ['og', 'h50', 'streak7'] },
        { name: 'Rares1337', hours: 66, streak: 3, badges: ['h50'] },
      ],
      together: { hours: 1_840, goals: s.communityGoals ?? [
        { title: 'Chatul alege jocul pentru o oră', hours: 250 }, { title: 'Karaoke cu chatul', hours: 750 },
        { title: 'Stream IRL în oraș', hours: 1500 }, { title: 'Turneu cu comunitatea', hours: 3000 },
      ] },
      now: { title: 'Ranked cu chatul până la Diamond', game: 'League of Legends', viewers: 512, note: s.note && s.note.until > now ? s.note.text : null },
    };
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
      prizes: s.prizes.map((p, i) => [p.short, p.full, prizeColors[i] ?? '#F2F5FA', p.sponsor] as Prize),
      losePrize: s.prizes.findIndex((p) => !p.isWin),
      recentWins: [...s.spins].filter((x) => s.prizes[x.prize]?.isWin).sort((a, b) => b.at - a.at).slice(0, 4)
        .map((x) => ({ user: x.user, prize: s.prizes[x.prize]?.win ?? '', ago: ago(x.at, now), sponsor: s.prizes[x.prize]?.sponsor ?? null })),
      doubleSponsor: s.timer.doubleSponsor,
      ...this.community(s, now),
      bingo: {
        closesAt: s.bingo.closesAt, prize: s.bingo.prize, prizeSponsor: s.bingo.prizeSponsor ?? null,
        players: s.bingo.others.length + (s.bingo.pick ? 1 : 0),
        items: s.bingo.items.map((it) => ({ ...it })),
      },
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
      prizes: s.spins.filter((x) => !x.fulfilled && s.prizes[x.prize]?.isWin).map((x) => ({ id: x.id, user_login: x.user, created_at: iso(x.at)!, prizes: { win_label: s.prizes[x.prize]?.win ?? '', is_win: true } })),
      wheel: s.prizes.map((p) => ({ short_label: p.short, full_label: p.full, win_label: p.win, sponsor: p.sponsor, is_win: p.isWin, weight: p.weight })),
      codes: s.codes.map((c) => ({ code: c.code, sponsor: c.sponsor, shown_at: iso(c.shownAt), expires_at: iso(c.expiresAt), claims: c.claims })),
      overlayKey: 'demo',
      report: this.sponsorReport(),
      mods: s.mods.map((login) => ({ login, display_name: login === 'icemanlucky' ? 'Icemanlucky' : null })),
      bingo: {
        closes_at: iso(s.bingo.closesAt), prize: s.bingo.prize, prize_sponsor: s.bingo.prizeSponsor ?? null,
        items: s.bingo.items.map((it) => ({ id: it.id, label: it.label, happened_at: it.happened ? 'yes' : null })),
        status: {
          players: s.bingo.others.length + (s.bingo.pick ? 1 : 0),
          winners: this.bingoWinners(s).map((login) => ({ login, saved_at: null })),
          draws: s.bingo.draws.map((login) => ({ login, drawn_at: null })),
        },
      },
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
      case 'mod_double_hour': return this.doubleHour(ms(a.p_from) ?? Date.now(), Number(a.p_minutes) || 60, a.p_sponsor ?? null);
      case 'mod_set_prizes': return this.setPrizes(a.p_prizes);
      case 'mod_code_show': return this.codeShow(a.p_sponsor ?? null, Number(a.p_minutes) || 10);
      case 'mod_code_end': return this.codeEnd();
      case 'mod_end_timer': return this.endTimer();
      case 'mod_open_round': return this.openRound(a.p_challenges, Number(a.p_minutes) || 60);
      case 'mod_close_round': return this.closeRound(Number(a.p_round));
      case 'mod_set_challenge': return this.setChallenge(Number(a.p_id), a.p_status, a.p_scheduled_for, a.p_clip);
      case 'mod_review_suggestion': return this.reviewSuggestion(Number(a.p_id), !!a.p_approve);
      case 'mod_fulfil_spin': return this.fulfilSpin(Number(a.p_id));
      case 'mod_set_moderator': return this.setModerator(String(a.p_login), !!a.p_on);
      case 'mod_set_note': return this.setNote(String(a.p_note ?? ''), Number(a.p_minutes) || 60);
      case 'mod_set_community_goals': return this.setCommunityGoals(a.p_goals ?? []);
      case 'mod_name_rule': return this.nameRule(String(a.p_name ?? ''), a.p_rule ?? null);
      case 'mod_names': return { filtered: [], rules: (this.load().nameRules ?? []).map((r) => ({ name: r.name, rule: r.rule, at: new Date(r.at).toISOString() })) };
      case 'mod_set_goals': return this.setGoals(a.p_goals);
      case 'mod_freeze_until': return this.freezeUntil(ms(a.p_until) ?? 0);
      case 'mod_unfreeze': return this.unfreeze();
      case 'mod_bingo_set_items': return this.setBingoItems(a.p_items);
      case 'mod_bingo_tick': return this.bingoTick(Number(a.p_id), !!a.p_happened);
      case 'mod_bingo_settings': return this.bingoSettings(ms(a.p_closes_at), String(a.p_prize ?? ''), a.p_prize_sponsor ?? null);
      case 'mod_bingo_draw': return this.bingoDraw();
      default: return fail(`unknown_${fn}`);
    }
  }
}
