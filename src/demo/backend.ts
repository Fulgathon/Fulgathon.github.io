// Demo backend: the same rules as the real Supabase backend (time rates,
// Ora dublă, freeze, goals, vote rounds, votes, snowflakes, spins,
// suggestions, moderators), simulated in the browser for presentations.
//
// State lives in localStorage and every change is broadcast, so the site
// (?demo), the moderator page (/mod/?demo), the overlay (/overlay/?demo) and
// the presentation page (/prezentare/) all show the same subathon at once,
// in separate tabs or side by side. Nothing here touches the real database.

import challengesJson from '../../data/challenges.json';
import { defaultGoals, defaultPrizes, popSlots, prizeColors } from '../data/content';
import { bingoLines } from '../lib/bingo';
import type { AdventDay, LineGroup, BoardTab, Goal, Prize, SiteData } from '../data/types';
import { amount, tickerItem } from '../lib/events';
import { ago, fmtInt } from '../lib/format';
import { site } from '../data/site';
import { demoSponsors } from '../data/demoSponsors';

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
interface DemoRaffle {
  id: number; prize: string; sponsor: string | null; rule: 'all' | 'subs' | 'hours'; minHours: number | null; by: string; at: number;
  draws: { id: number; name: string; at: number; by: string; given: number | null; total: number }[];
}
interface DemoSuggestion { id: number; body: string; user: string; at: number; status: 'pending' | 'approved' | 'rejected' }

export interface DemoState {
  /** Iceman's bubble lines per group and the small/large donation threshold (layout v2). */
  lines?: Partial<Record<LineGroup, string[]>>;
  smallDonation?: number;
  /** Twitch-chat echo switch (demo: nothing is sent). */
  chatEcho?: boolean;
  /** Advent calendar notes, clips and sponsors set on /mod. */
  advent?: AdventDay[];
  /** Moderator note for "Acum pe stream" and the community goal list (demo only). */
  note?: { text: string; until: number } | null;
  communityGoals?: { title: string; hours: number }[];
  /** Moderator name rules (hide / allow), like private.name_rules. */
  nameRules?: { name: string; rule: 'hide' | 'allow'; at: number }[];
  /** The last «Testează» pressed on /mod → Overlay OBS (the overlay plays it once). */
  overlayTest?: { kind: string; at: number; n: number };
  /** /mod → Sponsori (same fields as public.sponsors). */
  sponsors?: DemoSponsor[];
  /** «Repetiție»: the practice clock (same rules as mod_rehearsal). */
  rehearsal?: import('../data/types').Rehearsal | null;
  /** «Donează și alegi»: the price list and the requests (same rules as public.donation_tasks / _queue). */
  tasksMenu?: { price: number; title: string }[];
  taskQueue?: { id: number; price: number; title: string; name: string; at: number; done: boolean }[];
  /** «Camera de control» background photo (a small data URL in the demo). */
  sceneBg?: string | null;
  /** /mod autopilot settings, the plan, Discord alerts and the shared checklist (demo: nothing runs or is sent). */
  autopilot?: {
    autoStart: boolean; startHours: number; voteOn: boolean; voteAt: string; voteMinutes: number; hasWebhook: boolean;
    plan: { id: number; kind: string; at: number; minutes: number | null; until: number | null; sponsor: string | null; by: string }[];
    checklist: Record<string, { by: string; at: number }>;
  };
  v: 8;
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
    /** undefined = a demo saved before opening existed: open. */
    opensAt?: number | null; closesAt: number | null; prize: string; prizeSponsor?: string | null;
    items: { id: number; label: string; happened: boolean; rule?: Record<string, unknown> | null }[];
    pick: number[] | null;
    others: { user: string; items: number[] }[];
    draws: string[];
    /** The latest draw as the overlay plays it. */
    drawShow?: { id: number; name: string; at: number; shownAt: number; entrants: string[]; total: number; kind?: 'bingo' | 'tombola'; prize?: string; sponsor?: string | null } | null;
    /** Bingo winners whose prize was handed out (PREMII → De dat). */
    given?: string[];
  };
  /** Tombole (same rules as public.raffles / raffle_draws). */
  raffles?: DemoRaffle[];
}

/** Same as the seeded `rates` table: seconds for every `per` units. */
const RATES = { tier1: [360, 1], tier2: [720, 1], tier3: [1080, 1], gift: [360, 1], bits: [240, 400], donation: [360, 1] } as const;
const WHEEL_MINUTES = 120;
const today = () => new Date().toLocaleDateString('sv-SE');
/** A raffle rule as private.raffle_rule_ok() checks it. */
function raffleRule(rule: unknown, hours: unknown): { rule: 'all' | 'subs' | 'hours'; minHours: number | null } {
  if (rule !== 'all' && rule !== 'subs' && rule !== 'hours') fail('bad_raffle');
  const h = rule === 'hours' ? Number(hours) : null;
  if (rule === 'hours' && (!h || h <= 0 || h > 2000)) fail('bad_raffle_hours');
  return { rule: rule as 'all' | 'subs' | 'hours', minHours: h };
}
/** Bingo phase, as private.bingo_phase() in the database. */
const bingoOpensAt = (s: DemoState) => (s.bingo.opensAt === undefined ? 0 : s.bingo.opensAt);
function bingoPhase(s: DemoState): 'soon' | 'open' | 'closed' {
  const o = bingoOpensAt(s);
  if (o === null || Date.now() < o) return 'soon';
  return s.bingo.closesAt !== null && Date.now() >= s.bingo.closesAt ? 'closed' : 'open';
}
const bingoFinal = (s: DemoState) => s.bingo.items.some((it) => it.happened) || s.bingo.draws.length > 0;

// Example card for the demo only (the real card is written on /mod; nothing in code defines it).
const demoBingoItems = [
  'Rage quit', 'Râde un minut fără oprire', 'Cântă fără să-i ceară nimeni', 'Raid cu peste 50 de oameni',
  'Cineva dăruiește 10+ subs', 'Cineva donează 100+ €', 'Moare în primul minut', 'Vorbește cu microfonul pe mute',
  'Mănâncă pe stream', 'Pică netul sau OBS-ul', 'Se ia curentul', 'Zice „ultimul joc” și mai joacă 3',
  'Chatul spamează același emote', 'A treia cafea a zilei', 'Începe Ora dublă', 'Apare cineva neanunțat pe cameră',
  'Adoarme pe cameră', 'Plânge de râs', 'Cântă o colindă', 'Un moderator dă timeout din greșeală',
  'Uită că e live', 'Schimbă jocul de 3 ori într-o oră', 'Mulțumește în 3 limbi', 'Câștigă din prima', 'Pierde din prima',
];
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

/** The design's sample subathon, mid-way through, as a starting point. `rich`: the sponsor showcase (/demo). */
/** The clock reached zero and isn't frozen (B-08). */
const atZero = (s: DemoState) => s.timer.endsAt !== null && s.timer.endsAt <= Date.now() && !(s.timer.pausedUntil && s.timer.pausedUntil > Date.now());

function seed(now: number, rich = false): DemoState {
  const base = seedBase(now);
  return rich ? enrich(base, now) : base;
}

function seedBase(now: number): DemoState {
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
    v: 8,
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
      doubleSponsor: 'Polar Byte',
    },
    stats: { subs: 1284, bits: 48_500, raised: 1_180 },
    // The first four happened live (with clips), the fifth is unlocked and planned.
    goals: defaultGoals.map((g, i) => ({ ...g, sponsor: i === 5 ? 'Sponsor Principal' : i === 7 || i === 9 ? 'Nordhaus PC' : null,
      doneAt: i < 4 ? now - (2 - i * 0.5) * DAY : null, clip: i < 4 ? '#' : null, when: i === 4 ? 'vineri seara' : null })),
    lines: {},
    smallDonation: 10,
    advent: [
      { day: 1, note: 'Startul', clip: '#', sponsor: null }, { day: 2, note: 'Ora dublă', clip: '#', sponsor: 'Polar Byte' },
      { day: 3, note: 'Provocarea votată', clip: null, sponsor: null }, { day: 4, note: 'Segment partener', clip: null, sponsor: 'Fulg Coffee' },
      { day: 5, note: 'Ajunul · colinde live', clip: null, sponsor: null }, { day: 12, note: 'Revelion live', clip: null, sponsor: null },
    ],
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
    prizes: defaultPrizes.map((p, i) => ({ short: p[0], full: p[1], win: WIN_LABELS[i], sponsor: i === 1 ? 'Sponsor Principal' : i === 3 || i === 5 ? 'Glacio' : null, isWin: i !== LOSE, weight: 1 })),
    codes: [{ code: 'K7Q-2MV', sponsor: 'Sponsor Principal', shownAt: now - 3 * HOUR, expiresAt: now - 3 * HOUR + 10 * MIN, claims: 212, mine: false }],
    promo: { clicks: 184, copies: 57, doubleHours: 2, donatedInHours: 640 },
    mods: ['icemanlucky', 'Rares1337'],
    streamerConnected: true,
    bingo: {
      opensAt: now - DAY,
      closesAt: now + 2 * DAY + 5 * HOUR,
      prize: 'un espressor',
      prizeSponsor: 'Fulg Coffee',
      // Nothing is ticked while picks are open (ticks start after the close).
      items: demoBingoItems.map((label, i) => ({ id: i + 1, label, happened: false })),
      pick: null,
      // 340 simulated players, each with a random line of the card.
      others: Array.from({ length: 340 }, (_, k) => ({
        user: k < NAMES.length ? NAMES[k] : `viewer_${k}`,
        items: pick(bingoLines(demoBingoItems.map((_, i) => i + 1))),
      })),
      draws: [],
    },
  };
}

/**
 * The sponsor showcase (/demo, ?demo=showcase): the same subathon, further in
 * (day 9) and busier, so every section looks the way it will once thousands of
 * viewers take part. Sample data only; nothing in Iceman's voice (his lines stay
 * empty, so the bubble shows the neutral «Mersi, {nume}!»).
 */
function enrich(s: DemoState, now: number): DemoState {
  const t = s.timer;
  t.startsAt = now - 8 * DAY - 3 * HOUR;
  t.endsAt = now + 13 * DAY + 6 * HOUR + 41 * MIN;
  t.scheduledEnd = now + 13 * DAY;
  s.stats = { subs: 2_946, bits: 186_400, raised: 2_640 };
  // 8 milestones unlocked: the first six done on stream (with clips), two planned.
  s.goals = s.goals.map((g, i) => ({ ...g, doneAt: i < 6 ? now - (7 - i) * DAY : null, clip: i < 6 ? '#' : null,
    when: i === 6 ? 'diseară, 22:00' : i === 7 ? 'mâine seară' : null }));
  s.advent = [
    { day: 1, note: 'Startul', clip: '#', sponsor: null }, { day: 2, note: 'Ora dublă', clip: '#', sponsor: 'Sponsor Principal' },
    { day: 3, note: 'Provocarea votată', clip: '#', sponsor: null }, { day: 4, note: 'Segment partener', clip: '#', sponsor: 'Fulg Coffee' },
    { day: 5, note: 'Ajunul · colinde live', clip: '#', sponsor: null }, { day: 6, note: 'Crăciun cu chatul', clip: '#', sponsor: null },
    { day: 7, note: 'Turneu cu comunitatea', clip: '#', sponsor: 'Sponsor Principal' }, { day: 8, note: 'Karaoke cu colinde', clip: '#', sponsor: null },
    { day: 9, note: 'Ora dublă diseară', clip: null, sponsor: 'Polar Byte' }, { day: 12, note: 'Revelion live', clip: null, sponsor: null },
  ];
  // The last half hour of the feed: a mix of everything that adds time.
  const mix: [number, string, string, string | null, number, string | null][] = [
    [1, 'donation', 'andreiGG', null, 25, 'EUR'], [2, 'gift', 'vladutz97', '1000', 10, null], [3, 'sub', 'kxtrin', '1000', 1, null],
    [4, 'bits', 'teo_mid', null, 1000, null], [6, 'sub', 'Rares1337', '3000', 1, null], [7, 'resub', 'mihai_tzr', '1000', 1, null],
    [9, 'donation', 'dianaplays', null, 10, 'EUR'], [11, 'gift', 'cristi_lol', '1000', 5, null], [13, 'sub', 'alexx_ro', 'prime', 1, null],
    [15, 'bits', 'xBogdy', null, 500, null], [18, 'donation', 'sebi_jgl', null, 5, 'EUR'], [20, 'sub', 'darius_ro', '2000', 1, null],
    [23, 'gift', 'radu_nexus', '1000', 20, null], [26, 'resub', 'teodora_x', '1000', 1, null],
  ];
  s.events = mix.map(([mins, kind, user, tier, quantity, currency], k) => {
    const key = kind === 'sub' || kind === 'resub' ? (tier === '2000' ? 'tier2' : tier === '3000' ? 'tier3' : 'tier1') : kind;
    const [secs, per] = RATES[key as keyof typeof RATES];
    return { id: 100 + mix.length - k, kind, tier, quantity, currency, seconds_added: Math.floor((quantity / per) * secs),
      doubled: false, user_login: user, user_name: user, at: now - mins * MIN };
  });
  s.seq = 2000;
  s.boardBase = {
    donations: { andreiGG: 480, dianaplays: 355, cristi_lol: 260, xBogdy: 175, kxtrin: 120 },
    gifts: { vladutz97: 214, Rares1337: 168, andreiGG: 120, cristi_lol: 96, kxtrin: 74 },
    bits: { teo_mid: 98_100, dianaplays: 61_200, Rares1337: 42_000, mihai_tzr: 25_400, xBogdy: 19_800 },
    hours: { teo_mid: 168, dianaplays: 159, kxtrin: 151, cristi_lol: 146, Rares1337: 139 },
  };
  // A vote round that stays open for the whole presentation, with the viewer's vote in it.
  const round = s.rounds[0];
  round.number = 9;
  round.closesAt = now + 3 * HOUR;
  round.items.forEach((x) => { x.votes *= 3; });
  round.items[1].votes += 1;
  s.myVotes = { [round.id]: round.items[1].challengeId };
  // The visitor is a subscriber who watched long enough today: the wheel can spin.
  s.viewer = { state: 'sub', name: 'stefan_ro', day: today(), watched: 150, spunDay: null, bonus: 1 };
  // Their bingo line: row 4.
  s.bingo.pick = [16, 17, 18, 19, 20];
  s.bingo.others = s.bingo.others.concat(Array.from({ length: 1_460 }, (_, k) => ({
    user: `viewer_${400 + k}`, items: pick(bingoLines(s.bingo.items.map((it) => it.id))),
  })));
  return s;
}

export class DemoError extends Error {}
const fail = (code: string): never => { throw new DemoError(code); };

/** A row of public.sponsors as /mod sees it (demo). */
export interface DemoSponsor {
  id: number; tier: 'main' | 'partner' | 'supporter'; position: number; name: string; logo_url: string | null; role: string | null;
  description: string | null; url: string | null; cta: string | null; utm: boolean; code: string | null; code_note: string | null;
  offer_until: string | null; overlay_line: string | null; talking_points: string | null; socials: Record<string, string>;
  show_site: boolean; show_overlay: boolean; visible_from: string | null; visible_until: string | null;
  contact_name: string | null; contact_email: string | null; contact_phone: string | null; notes: string | null;
  updated_at: string; updated_by: string;
}

export class DemoBackend {
  private raw = '';
  private cached: DemoState | null = null;
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;

  private readonly KEY: string;
  private readonly CHANNEL: string;
  /** The sponsor showcase (/demo): busier seed, see enrich(). */
  readonly rich: boolean;
  /** `?demo&as=mod`: signed in as a plain moderator, not Iceman (start, end and auto start refused). */
  readonly asMod = typeof location !== 'undefined' && new URLSearchParams(location.search).get('as') === 'mod';

  /** `variant` picks a separate copy (e.g. 'pitch'); by default it follows ?demo=… in the address. */
  constructor(variant: string = VARIANT) {
    this.KEY = keyFor(variant);
    this.rich = variant === 'showcase';
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
        if (s.v === 8) { this.raw = raw; this.cached = s; return s; }
      } catch { /* corrupt: reseed */ }
    }
    // No saved demo (or storage blocked): start from the seed, keep it in memory.
    if (!this.cached) {
      this.cached = seed(Date.now(), this.rich);
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
  reset() { this.mutate((s) => { Object.assign(s, seed(Date.now(), this.rich)); }); }

  // ---- Twitch events (what EventSub does on the real site) -------------------

  recordEvent(kind: 'sub' | 'resub' | 'gift' | 'bits' | 'donation', user: string | null, tier: string | null, quantity = 1, currency: string | null = null) {
    return this.mutate((s) => {
      const key = kind === 'sub' || kind === 'resub' ? (tier === '2000' ? 'tier2' : tier === '3000' ? 'tier3' : 'tier1') : kind;
      const [secs, per] = RATES[key as keyof typeof RATES];
      let seconds = Math.floor((quantity / per) * secs);
      const t = s.timer;
      const now = Date.now();
      let doubled = false;
      // Euros only (B-09): a donation in another currency never reaches the clock or Strâns.
      if (kind === 'donation' && (currency ?? 'EUR').toUpperCase() !== 'EUR') fail('not_eur');
      if (t.status !== 'live' || t.endsAt === null) seconds = 0;
      // Zero is final (B-08): nothing more is added, and the marathon ends now.
      else if (t.endsAt <= now && !(t.pausedUntil && t.pausedUntil > now)) { seconds = 0; t.status = 'ended'; }
      else if (seconds > 0 && t.doubleFrom !== null && t.doubleUntil !== null && now >= t.doubleFrom && now < t.doubleUntil) { seconds *= 2; doubled = true; }
      if (seconds) t.endsAt = (t.endsAt ?? now) + seconds * 1000;
      s.stats.subs += kind === 'sub' || kind === 'resub' ? 1 : kind === 'gift' ? quantity : 0;
      s.stats.bits += kind === 'bits' ? quantity : 0;
      s.stats.raised += kind === 'donation' ? quantity : 0;
      const e: DemoEvent = { id: ++s.seq, kind, tier, quantity, currency, seconds_added: seconds, doubled, user_login: user, user_name: user ?? 'Anonim', at: now };
      s.events = [e, ...s.events].slice(0, 60);
      // «Donează și alegi»: a donation of exactly a listed amount, while live, becomes a request.
      const task = kind === 'donation' && t.status === 'live' ? demoTasksMenu(s).find((m) => m.price === quantity) : undefined;
      if (task) s.taskQueue = [...(s.taskQueue ?? []), { id: e.id, price: task.price, title: task.title, name: user ?? 'Anonim', at: now, done: false }];
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
  /** «Prelungește»: the planned end moves later and the clock gets the same time (mod_extend). */
  extend(newEnd: number | null) {
    this.mutate((s) => {
      if (s.timer.status !== 'live' || s.timer.endsAt === null) fail('timer_not_live');
      if (atZero(s)) fail('timer_ended');
      const base = Math.max(s.timer.scheduledEnd ?? 0, Date.now());
      if (newEnd === null || newEnd < base + 60_000) fail('extend_not_later');
      if (newEnd! > Date.now() + 366 * DAY) fail('extend_too_far');
      s.timer.endsAt! += newEnd! - base;
      s.timer.scheduledEnd = newEnd;
    });
  }
  addTime(minutes: number) {
    this.mutate((s) => {
      if (s.timer.status !== 'live' || s.timer.endsAt === null) fail('timer_not_live');
      if (atZero(s)) fail('timer_ended');
      const seconds = Math.round(minutes * 60);
      s.timer.endsAt! += seconds * 1000;
      s.events = [{ id: ++s.seq, kind: 'manual', tier: null, quantity: 1, currency: null, seconds_added: Math.max(0, seconds), doubled: false, user_login: null, user_name: 'ICEMARATON', at: Date.now() }, ...s.events].slice(0, 60);
    });
  }
  freeze(minutes: number) {
    this.mutate((s) => {
      if (s.timer.status !== 'live' || s.timer.endsAt === null) fail('timer_not_live');
      if (atZero(s)) fail('timer_ended');
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
      const ph = bingoPhase(s);
      if (ph === 'soon') fail('bingo_not_open');
      if (ph === 'closed') fail('bingo_closed');
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
  bingoTick(id: number, happened: boolean) {
    this.mutate((s) => {
      if (bingoPhase(s) !== 'closed') fail('bingo_open');
      const it = s.bingo.items.find((x) => x.id === id); if (it) it.happened = happened;
    });
  }
  bingoSettings(opensAt: number | null, closesAt: number | null, prize: string, prizeSponsor: string | null = null) {
    this.mutate((s) => {
      if ((opensAt !== bingoOpensAt(s) || closesAt !== s.bingo.closesAt) && bingoFinal(s)) fail('bingo_ticked');
      if (closesAt !== null && (opensAt === null || closesAt <= opensAt)) fail('bingo_bad_dates');
      s.bingo.opensAt = opensAt; s.bingo.closesAt = closesAt;
      if (prize.trim()) s.bingo.prize = prize.trim(); s.bingo.prizeSponsor = prizeSponsor?.trim() || null; });
  }
  bingoOpenNow() {
    this.mutate((s) => {
      if (bingoPhase(s) === 'open') return;
      if (bingoFinal(s)) fail('bingo_ticked');
      s.bingo.opensAt = Date.now();
      if (s.bingo.closesAt !== null && s.bingo.closesAt <= Date.now()) s.bingo.closesAt = null;
    });
  }
  /** Presentation page only: clear ticks and draws, then open again. */
  bingoReopenDemo() {
    this.mutate((s) => {
      s.bingo.items.forEach((it) => { it.happened = false; });
      s.bingo.draws = [];
      s.bingo.drawShow = null;
      s.bingo.opensAt = Date.now() - 1000;
      s.bingo.closesAt = Date.now() + 2 * DAY;
    });
  }
  bingoReplay() {
    this.mutate((s) => { const d = s.bingo.drawShow; if (!d) return fail('no_bingo_draw'); d.shownAt = Date.now(); });
  }
  bingoCloseNow() {
    this.mutate((s) => { if (bingoPhase(s) !== 'open') fail('bingo_not_open'); s.bingo.closesAt = Date.now(); });
  }
  setBingoItems(list: { id?: number | string; label: string }[]) {
    this.mutate((s) => {
      if (!Array.isArray(list) || ![9, 16, 25].includes(list.length)) fail('bad_card_size');
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
      if (bingoPhase(s) !== 'closed') fail('bingo_open');
      const won = pick(pool);
      const all = this.bingoWinners(s);
      const others = all.filter((u) => u !== won).sort(() => Math.random() - 0.5).slice(0, 299);
      s.bingo.draws.unshift(won);
      s.bingo.drawShow = { id: Date.now(), name: won, at: Date.now(), shownAt: Date.now(), entrants: [...others, won].sort(() => Math.random() - 0.5), total: all.length, kind: 'bingo' };
      return won;
    });
  }

  // ---- Tombole and «Premii de dat» (same rules as migration 20261216100000) ----------
  /** Who is on a raffle's list: the simulated players (viewer_…) and the demo viewer when logged in. */
  private rafflePool(s: DemoState, rule: { rule: string; minHours: number | null }): string[] {
    const people = [...new Set([...(s.viewer.state !== 'out' ? [s.viewer.name] : []), ...s.bingo.others.map((o) => o.user)])];
    // Stable sample facts per name: every 3rd is a subscriber, hours watched 0–39.
    const h = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const isSub = (n: string) => (n === s.viewer.name ? s.viewer.state === 'sub' : h(n) % 3 === 0);
    const hours = (n: string) => (n === s.viewer.name ? 23 : h(n) % 40);
    return people.filter((n) => rule.rule === 'all' || (rule.rule === 'subs' && isSub(n)) || (rule.rule === 'hours' && hours(n) >= (rule.minHours ?? 1)));
  }
  private raffleReel(s: DemoState, r: DemoRaffle, won: string): string[] {
    const others = this.rafflePool(s, r).filter((n) => n !== won).sort(() => Math.random() - 0.5).slice(0, 299);
    return [...others, won].sort(() => Math.random() - 0.5);
  }
  rafflesFor(s: DemoState) {
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    return [...(s.raffles ?? [])].sort((a, b) => b.id - a.id).map((r) => ({
      id: r.id, prize: r.prize, sponsor: r.sponsor, rule: r.rule, min_hours: r.minHours, created_by: r.by, created_at: iso(r.at),
      pool: this.rafflePool(s, r).filter((n) => !r.draws.some((d) => d.name === n)).length,
      draws: r.draws.map((d) => ({ id: d.id, login: d.name, drawn_at: iso(d.at), drawn_by: d.by, given_at: iso(d.given), total: d.total })),
    }));
  }
  raffleSave(id: number | null, prize: string, sponsor: string | null, ruleIn: unknown, hoursIn: unknown) {
    return this.mutate((s) => {
      if (!prize.trim() || prize.trim().length > 120) fail('bad_raffle_prize');
      const r = raffleRule(ruleIn, hoursIn);
      const list = (s.raffles ??= []);
      if (id === null) {
        const nid = Math.max(0, ...list.map((x) => x.id)) + 1;
        list.push({ id: nid, prize: prize.trim(), sponsor: sponsor?.trim() || null, rule: r.rule, minHours: r.minHours, by: this.asMod ? 'modi' : 'icemanlucky', at: Date.now(), draws: [] });
        return nid;
      }
      const cur = list.find((x) => x.id === id);
      if (!cur) return fail('no_raffle');
      if ((cur.rule !== r.rule || cur.minHours !== r.minHours) && cur.draws.length) fail('raffle_drawn');
      Object.assign(cur, { prize: prize.trim(), sponsor: sponsor?.trim() || null, rule: r.rule, minHours: r.minHours });
      return id;
    });
  }
  raffleDraw(id: number): string {
    return this.mutate((s) => {
      const r = (s.raffles ?? []).find((x) => x.id === id);
      if (!r) return fail('no_raffle');
      const all = this.rafflePool(s, r);
      const left = all.filter((n) => !r.draws.some((d) => d.name === n));
      if (!left.length) return fail('raffle_empty');
      const won = pick(left);
      const did = Math.max(0, ...(s.raffles ?? []).flatMap((x) => x.draws.map((d) => d.id))) + 1;
      r.draws.push({ id: did, name: won, at: Date.now(), by: this.asMod ? 'modi' : 'icemanlucky', given: null, total: all.length });
      s.bingo.drawShow = { id: did, name: won, at: Date.now(), shownAt: Date.now(), entrants: this.raffleReel(s, r, won), total: all.length, kind: 'tombola', prize: r.prize, sponsor: r.sponsor };
      return won;
    });
  }
  prizesDue(s: DemoState) {
    const iso = (ms: number) => new Date(ms).toISOString();
    const due: { kind: string; id: number; login: string; prize: string; sponsor: string | null; at: string }[] = [
      ...s.spins.filter((x) => !x.fulfilled && s.prizes[x.prize]?.isWin).map((x) => ({ kind: 'roata', id: x.id, login: x.user, prize: s.prizes[x.prize]?.win ?? '', sponsor: s.prizes[x.prize]?.sponsor ?? null, at: iso(x.at) })),
      ...s.bingo.draws.map((login, i) => ({ login, i })).filter((d) => !(s.bingo.given ?? []).includes(d.login))
        .map((d) => ({ kind: 'bingo', id: d.i, login: d.login, prize: s.bingo.prize, sponsor: s.bingo.prizeSponsor ?? null, at: iso(Date.now()) })),
      ...(s.raffles ?? []).flatMap((r) => r.draws.filter((d) => !d.given).map((d) => ({ kind: 'tombola', id: d.id, login: d.name, prize: r.prize, sponsor: r.sponsor, at: iso(d.at) }))),
    ];
    const given = [
      ...s.spins.filter((x) => x.fulfilled && s.prizes[x.prize]?.isWin).map((x) => ({ kind: 'roata', login: x.user, prize: s.prizes[x.prize]?.win ?? '', given_at: iso(x.at) })),
      ...(s.bingo.given ?? []).map((login) => ({ kind: 'bingo', login, prize: s.bingo.prize, given_at: iso(Date.now()) })),
      ...(s.raffles ?? []).flatMap((r) => r.draws.filter((d) => d.given).map((d) => ({ kind: 'tombola', login: d.name, prize: r.prize, given_at: iso(d.given!), by: d.by }))),
    ].sort((a, b) => b.given_at.localeCompare(a.given_at)).slice(0, 15);
    return { due: due.sort((a, b) => a.at.localeCompare(b.at)), given };
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
        // The main partner (the one with the secret codes) gets the main-partner sample numbers.
        const main = name === (s.codes[0]?.sponsor ?? 'Sponsor Principal');
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
      // Iceman's own account always stays a moderator (B-30).
      if (!on && l === site.channel.toLowerCase()) fail('protected_broadcaster');
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
      // Same clean-up as the database: no links, nothing already proposed.
      const key = (t: string) => t.toLowerCase().replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[^a-z0-9]/g, '');
      if (/(https?:|www\.|\.(com|ro|net)\b)/i.test(body)) fail('blocked_text');
      if (key(body).length >= 3 && s.suggestions.some((x) => x.status !== 'rejected' && key(x.body) === key(body))) fail('duplicate');
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
    const before = this.load().goals;
    const goals = (Array.isArray(list) ? list : []).map((g) => {
      const x = g as { title?: string; threshold?: number | string; sponsor?: string; done?: boolean; clip?: string; when?: string };
      const title = String(x.title ?? '').trim(), threshold = Number(x.threshold);
      const old = before.find((o) => o.title === title && o.threshold === threshold);
      const clip = 'clip' in x ? String(x.clip ?? '').trim() || null : old?.clip ?? null;
      if (clip && !/^https:\/\//.test(clip) && clip !== '#') fail('bad_goals');
      return {
        title, threshold, sponsor: String(x.sponsor ?? '').trim() || null,
        doneAt: 'done' in x ? (x.done ? old?.doneAt ?? Date.now() : null) : old?.doneAt ?? null,
        clip, when: 'when' in x ? String(x.when ?? '').trim().slice(0, 60) || null : old?.when ?? null,
      };
    });
    if (goals.length > 40 || goals.some((g) => !g.title || g.title.length > 140 || !Number.isInteger(g.threshold) || g.threshold <= 0)) fail('bad_goals');
    if (new Set(goals.map((g) => g.threshold)).size !== goals.length) fail('duplicate_amount');
    this.mutate((s) => { s.goals = goals.sort((a, b) => a.threshold - b.threshold); });
  }

  /** «Replicile lui Iceman» from /mod (same checks as mod_set_lines). */
  setLines(lines: Record<string, string[]>, smallDonation?: number | null) {
    const groups = ['sub', 'sub23', 'gift', 'donSmall', 'donBig', 'bits'];
    if (!lines || typeof lines !== 'object') fail('bad_lines');
    const out: Partial<Record<LineGroup, string[]>> = {};
    for (const [k, list] of Object.entries(lines)) {
      if (!groups.includes(k) || !Array.isArray(list) || list.length > 40) fail('bad_lines');
      const clean = list.map((l) => String(l).trim()).filter(Boolean);
      if (clean.some((l) => l.length > 70)) fail('line_too_long');
      out[k as LineGroup] = clean;
    }
    if (smallDonation != null && !(smallDonation > 0 && smallDonation <= 10000)) fail('bad_threshold');
    this.mutate((s) => { s.lines = out; if (smallDonation != null) s.smallDonation = smallDonation; });
  }

  /** Advent calendar days from /mod (same checks as mod_set_advent). */
  setAdvent(days: { day: number | string; note?: string; clip?: string; sponsor?: string }[]) {
    if (!Array.isArray(days) || days.length > 40) fail('bad_days');
    const out = days.map((d) => ({ day: Number(d.day), note: String(d.note ?? '').trim(), clip: String(d.clip ?? '').trim() || null, sponsor: String(d.sponsor ?? '').trim() || null }));
    if (out.some((d) => !Number.isInteger(d.day) || d.day < 1 || d.day > 40 || d.note.length > 60 || (d.sponsor ?? '').length > 60 || (d.clip && !/^https:\/\//.test(d.clip) && d.clip !== '#'))) fail('bad_days');
    this.mutate((s) => { s.advent = out.filter((d) => d.note || d.clip || d.sponsor).sort((a, b) => a.day - b.day); });
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
      bingoWon: s.viewer.state !== 'out' && s.bingo.draws.includes(s.viewer.name),
      raffleWon: s.viewer.state === 'out' ? null : (() => {
        const won = (s.raffles ?? []).flatMap((r) => r.draws.filter((d) => d.name === s.viewer.name && Date.now() - d.at < 7 * DAY).map((d) => ({ id: d.id, prize: r.prize, sponsor: r.sponsor, at: d.at })));
        return won.sort((a, b) => b.id - a.id)[0] ?? null;
      })(),
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
        { name: 'andreiGG', hours: 58, streak: 5, badges: ['og', 'h50'] },
        { name: 'vladutz97', hours: 52, streak: 7, badges: ['h50', 'streak7'] },
        { name: 'mihai_tsr', hours: 47, streak: 2, badges: ['night', 'h10'] },
        { name: 'stefan_ro', hours: 41, streak: 4, badges: ['h10'] },
        { name: 'ioana.gg', hours: 36, streak: 1, badges: ['og', 'h10'] },
      ],
      together: { hours: 1_840, goals: s.communityGoals ?? [
        { title: 'Chatul alege jocul pentru o oră', hours: 250 }, { title: 'Karaoke cu chatul', hours: 750 },
        { title: 'Stream IRL în oraș', hours: 1500 }, { title: 'Turneu cu comunitatea', hours: 3000 },
      ] },
      now: { ...(this.rich ? { title: 'Weekend League cu chatul', game: 'EA Sports FC 27', viewers: 534 } : { title: 'Ranked cu chatul până la Diamond', game: 'League of Legends', viewers: 512 }),
        note: s.note && s.note.until > now ? s.note.text : null },
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
      recentWins: [
        ...s.spins.filter((x) => s.prizes[x.prize]?.isWin).map((x) => ({ user: x.user, prize: s.prizes[x.prize]?.win ?? '', at: x.at, sponsor: s.prizes[x.prize]?.sponsor ?? null })),
        ...(s.raffles ?? []).flatMap((r) => r.draws.map((d) => ({ user: d.name, prize: r.prize, at: d.at, sponsor: r.sponsor }))),
      ].sort((a, b) => b.at - a.at).slice(0, 4).map((x) => ({ user: x.user, prize: x.prize, ago: ago(x.at, now), sponsor: x.sponsor })),
      doubleSponsor: s.timer.doubleSponsor,
      ...this.community(s, now),
      lines: s.lines ?? {},
      smallDonation: s.smallDonation ?? 10,
      rehearsal: s.rehearsal ?? null,
      scene: { bg: s.sceneBg ?? null },
      tasks: { menu: demoTasksMenu(s), queue: (s.taskQueue ?? []).filter((q) => !q.done).slice(0, 40).map(({ done: _d, ...q }) => q), pending: (s.taskQueue ?? []).filter((q) => !q.done).length },
      sponsors: this.publicSponsors(s),
      advent: s.advent ?? [],
      // The showcase runs on today's clock but labels the calendar with the real dates (20 Dec, 12:00 RO).
      calendarStart: this.rich ? Date.parse('2026-12-20T10:00:00Z') : null,
      // Sample counts (the real ones come from the badges part).
      badgeCounts: { og: 1240, h10: 2150, night: 386, streak7: 509, h50: 214, h100: 37 },
      bingo: {
        opensAt: bingoOpensAt(s), closesAt: s.bingo.closesAt, prize: s.bingo.prize, prizeSponsor: s.bingo.prizeSponsor ?? null,
        winners: [...s.bingo.draws].reverse().map((name, i) => ({ id: i + 1, name, at: Date.now() })),
        draw: s.bingo.drawShow ? { ...s.bingo.drawShow, entrants: [...s.bingo.drawShow.entrants] } : null,
        players: s.bingo.others.length + (s.bingo.pick ? 1 : 0),
        items: s.bingo.items.map((it) => ({ ...it })),
      },
      boards: { donations: board('donations', 'donation'), gifts: board('gifts', 'gift'), bits: board('bits', 'bits'), hours: board('hours') },
    };
  }

  /** What the moderator page shows, in the same shape it reads from the database. */
  // ---- Sponsors (/mod → Sponsori), same rules as mod_sponsor_save -------------------------
  private sponsorsOf(s: DemoState): DemoSponsor[] {
    if (!s.sponsors) {
      let id = 0;
      const mk = (tier: DemoSponsor['tier'], name: string, extra: Partial<DemoSponsor> = {}): DemoSponsor => ({
        id: ++id, tier, position: id, name, logo_url: null, role: null, description: null, url: null, cta: null, utm: true, code: null, code_note: null,
        offer_until: null, overlay_line: null, talking_points: null, socials: {}, show_site: true, show_overlay: true, visible_from: null, visible_until: null,
        contact_name: null, contact_email: null, contact_phone: null, notes: null, updated_at: new Date().toISOString(), updated_by: 'icemanlucky', ...extra,
      });
      s.sponsors = [
        mk('main', site.sponsor.name, { code: site.sponsor.code, cta: 'Vezi oferta' }),
        ...demoSponsors.partners.map((p) => mk('partner', p.name, { role: p.role, logo_url: p.logo })),
        ...demoSponsors.supporters.map((p) => mk('supporter', p.name, { logo_url: p.logo })),
      ];
    }
    return s.sponsors;
  }
  private static order = (t: string) => (t === 'main' ? 0 : t === 'partner' ? 1 : 2);
  private sortedSponsors(s: DemoState) {
    return [...this.sponsorsOf(s)].sort((a, b) => DemoBackend.order(a.tier) - DemoBackend.order(b.tier) || a.position - b.position || a.id - b.id);
  }
  private sponsorSave(p: Record<string, any>) {
    let saved = 0;
    this.mutate((s) => {
      const list = this.sponsorsOf(s);
      const clip = (v: unknown, n: number) => { const t = String(v ?? '').trim().slice(0, n); return t || null; };
      // Like the real backend, plus data: images (demo uploads stay in the browser).
      const url = (v: unknown) => { const u = clip(v, 500_000); if (!u) return null; if (!/^https?:\/\/\S+$/i.test(u) && !u.startsWith('/') && !u.startsWith('data:image/')) fail('bad_url'); return u; };
      const tier = (p.tier ?? 'partner') as DemoSponsor['tier'];
      if (!['main', 'partner', 'supporter'].includes(tier)) fail('bad_tier');
      if (!clip(p.name, 60)) fail('sponsor_name');
      const id = p.id ? Number(p.id) : null;
      if (tier === 'main' && list.some((x) => x.tier === 'main' && x.id !== id)) fail('main_exists');
      let row = id ? list.find((x) => x.id === id) : undefined;
      if (id && !row) fail('sponsor_gone');
      if (!row) {
        row = { ...list[0], id: Math.max(0, ...list.map((x) => x.id)) + 1, position: Math.max(0, ...list.filter((x) => x.tier === tier).map((x) => x.position)) + 1 } as DemoSponsor;
        list.push(row);
      }
      const socials: Record<string, string> = {};
      for (const k of ['website', 'instagram', 'tiktok', 'youtube', 'facebook', 'discord']) { const u = url(p.socials?.[k]); if (u) socials[k] = u; }
      const when = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
      Object.assign(row, {
        tier, name: clip(p.name, 60), logo_url: url(p.logo), role: clip(p.role, 40), description: clip(p.description, 280), url: url(p.url),
        cta: clip(p.cta, 30), utm: p.utm !== false, code: clip(p.code, 30)?.toUpperCase() ?? null, code_note: clip(p.codeNote, 80),
        offer_until: when(p.offerUntil), overlay_line: clip(p.overlayLine, 90), talking_points: clip(p.talkingPoints, 600), socials,
        show_site: p.site !== false, show_overlay: p.overlay !== false, visible_from: when(p.from), visible_until: when(p.until),
        contact_name: clip(p.contactName, 80), contact_email: clip(p.contactEmail, 120), contact_phone: clip(p.contactPhone, 40), notes: clip(p.notes, 1000),
        updated_at: new Date().toISOString(), updated_by: 'icemanlucky',
      });
      saved = row.id;
    });
    return saved;
  }
  private sponsorMove(id: number, dir: number) {
    this.mutate((s) => {
      const list = this.sortedSponsors(s);
      const me = list.find((x) => x.id === id);
      if (!me) fail('sponsor_gone');
      const same = list.filter((x) => x.tier === me!.tier);
      same.forEach((x, i) => { x.position = i; });
      const i = same.indexOf(me!), j = i + (dir < 0 ? -1 : 1);
      if (j < 0 || j >= same.length) return;
      [same[i].position, same[j].position] = [same[j].position, same[i].position];
      s.sponsors = this.sponsorsOf(s).map((x) => same.find((y) => y.id === x.id) ?? x);
    });
  }
  /** Public fields, as the sponsors part sends them. */
  publicSponsors(s: DemoState): import('../data/types').Sponsor[] {
    const link = (u: string | null, utm: boolean) => (!u || !utm || /[?&]utm_source=/i.test(u) || u.startsWith('/') ? u : `${u}${u.includes('?') ? '&' : '?'}utm_source=icemanlucky.ro&utm_medium=subathon&utm_campaign=icemaraton`);
    const t = (v: string | null) => (v ? Date.parse(v) : null);
    return this.sortedSponsors(s).map((x) => ({
      id: x.id, tier: x.tier, name: x.name, logo: x.logo_url, role: x.role, description: x.description, url: link(x.url, x.utm), cta: x.cta,
      code: x.code, codeNote: x.code_note, offerUntil: t(x.offer_until), overlayLine: x.overlay_line, socials: x.socials,
      site: x.show_site, overlay: x.show_overlay, from: t(x.visible_from), until: t(x.visible_until),
    }));
  }

  private autopilotOf(s: DemoState) {
    s.autopilot ??= { autoStart: false, startHours: 24, voteOn: false, voteAt: '20:00', voteMinutes: 60, hasWebhook: false, plan: [], checklist: {} };
    return s.autopilot;
  }

  /** Same shape as mod_autopilot() on the real site. */
  autopilot() {
    const ap = this.autopilotOf(this.load());
    return {
      autoStart: ap.autoStart, startHours: ap.startHours, voteOn: ap.voteOn, voteAt: ap.voteAt, voteMinutes: ap.voteMinutes, lastVoteDay: null,
      hasWebhook: ap.hasWebhook, updatedAt: null, updatedBy: null,
      plan: ap.plan.filter((x) => x.at > Date.now() - 2 * 86_400_000).map((x) => ({ id: x.id, kind: x.kind, at: new Date(x.at).toISOString(), minutes: x.minutes,
        until: x.until ? new Date(x.until).toISOString() : null, sponsor: x.sponsor, by: x.by, done: x.at <= Date.now() ? new Date(x.at).toISOString() : null, result: x.at <= Date.now() ? 'done' : null })),
      checklist: Object.fromEntries(Object.entries(ap.checklist).map(([k, v]) => [k, { by: v.by, at: new Date(v.at).toISOString() }])),
    };
  }

  modState() {
    const s = this.load();
    const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);
    const r = [...s.rounds].sort((a, b) => b.number - a.number)[0];
    const title = (id: number) => s.challenges.find((c) => c.id === id)?.title ?? '';
    const toCh = (c: DemoChallenge) => ({ id: c.id, title: c.title, level: c.level, category: c.category, status: c.status, scheduled_for: c.scheduledFor });
    return {
      me: { login: this.asMod ? 'modi' : 'icemanlucky', is_moderator: true },
      status: { broadcaster_login: 'icemanlucky', broadcaster_connected: s.streamerConnected, connect_url: '#connect-demo' },
      timer: {
        status: s.timer.status, stream_online: s.timer.streamOnline,
        starts_at: iso(s.timer.startsAt), ends_at: iso(s.timer.endsAt), paused_until: iso(s.timer.pausedUntil),
        scheduled_end: iso(s.timer.scheduledEnd), double_from: iso(s.timer.doubleFrom), double_until: iso(s.timer.doubleUntil),
      } as Record<string, any>,
      stats: { subs: s.stats.subs, bits: s.stats.bits, raised: s.stats.raised } as Record<string, any>,
      goals: s.goals.map((g) => ({ title: g.title, threshold: g.threshold, sponsor: g.sponsor ?? null, unlocked_at: s.stats.raised >= g.threshold ? 'yes' : null,
        done_at: g.doneAt ? new Date(g.doneAt).toISOString() : null, clip_url: g.clip ?? null, scheduled_for: g.when ?? null })),
      lines: s.lines ?? {},
      smallDonation: s.smallDonation ?? 10,
      advent: s.advent ?? [],
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
      due: this.prizesDue(s),
      raffles: this.rafflesFor(s),
      bingo: {
        opens_at: iso(bingoOpensAt(s)), closes_at: iso(s.bingo.closesAt), prize: s.bingo.prize, prize_sponsor: s.bingo.prizeSponsor ?? null,
        items: s.bingo.items.map((it) => ({ id: it.id, label: it.label, happened_at: it.happened ? 'yes' : null, auto_rule: it.rule ?? null })),
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
      case 'mod_start_timer': if (this.asMod) fail('only_broadcaster'); return this.startTimer(Number(a.p_hours), ms(a.p_scheduled_end));
      case 'mod_extend': if (this.asMod) fail('only_broadcaster'); return this.extend(ms(a.p_new_end));
      case 'mod_add_time': return this.addTime(Number(a.p_minutes));
      case 'mod_freeze': return this.freeze(Number(a.p_minutes));
      case 'mod_double_hour': return this.doubleHour(ms(a.p_from) ?? Date.now(), Number(a.p_minutes) || 60, a.p_sponsor ?? null);
      case 'mod_set_prizes': return this.setPrizes(a.p_prizes);
      case 'mod_code_show': return this.codeShow(a.p_sponsor ?? null, Number(a.p_minutes) || 10);
      case 'mod_code_end': return this.codeEnd();
      case 'mod_end_timer': if (this.asMod) fail('only_broadcaster'); return this.endTimer();
      case 'mod_open_round': return this.openRound(a.p_challenges, Number(a.p_minutes) || 60);
      case 'mod_close_round': return this.closeRound(Number(a.p_round));
      case 'mod_set_challenge': return this.setChallenge(Number(a.p_id), a.p_status, a.p_scheduled_for, a.p_clip);
      case 'mod_review_suggestion': return this.reviewSuggestion(Number(a.p_id), !!a.p_approve);
      case 'mod_fulfil_spin': return this.fulfilSpin(Number(a.p_id));
      case 'mod_set_moderator': return this.setModerator(String(a.p_login), !!a.p_on);
      case 'mod_skipped_done': return null;
      case 'mod_set_note': return this.setNote(String(a.p_note ?? ''), Number(a.p_minutes) || 60);
      case 'mod_set_community_goals': return this.setCommunityGoals(a.p_goals ?? []);
      case 'mod_name_rule': return this.nameRule(String(a.p_name ?? ''), a.p_rule ?? null);
      case 'mod_names': return { filtered: [], rules: (this.load().nameRules ?? []).map((r) => ({ name: r.name, rule: r.rule, at: new Date(r.at).toISOString() })) };
      case 'mod_set_goals': return this.setGoals(a.p_goals);
      case 'mod_set_chat_echo': return this.mutate((s) => { s.chatEcho = !!a.p_on; });
      case 'mod_chat_status': return { on: !!this.load().chatEcho, canWrite: true, connected: true, lastAt: null };
      case 'mod_set_lines': return this.setLines(a.p_lines, a.p_small_donation ?? null);
      case 'mod_set_advent': return this.setAdvent(a.p_days ?? []);
      case 'mod_freeze_until': return this.freezeUntil(ms(a.p_until) ?? 0);
      case 'mod_unfreeze': return this.unfreeze();
      case 'mod_bingo_set_items': return this.setBingoItems(a.p_items);
      case 'mod_bingo_tick': return this.bingoTick(Number(a.p_id), !!a.p_happened);
      case 'mod_bingo_settings': return this.bingoSettings(ms(a.p_opens_at), ms(a.p_closes_at), String(a.p_prize ?? ''), a.p_prize_sponsor ?? null);
      case 'mod_bingo_open': return this.bingoOpenNow();
      case 'mod_bingo_close': return this.bingoCloseNow();
      case 'mod_bingo_replay': return this.bingoReplay();
      case 'mod_bingo_draw': return this.bingoDraw();
      case 'mod_raffles': return this.rafflesFor(this.load());
      case 'mod_raffle_count': return this.rafflePool(this.load(), raffleRule(a.p_rule, a.p_min_hours)).length;
      case 'mod_raffle_save': return this.raffleSave(a.p_id == null ? null : Number(a.p_id), String(a.p_prize ?? ''), a.p_sponsor ?? null, a.p_rule, a.p_min_hours);
      case 'mod_raffle_delete': return this.mutate((s) => {
        const r = (s.raffles ?? []).find((x) => x.id === Number(a.p_id));
        if (r?.draws.length) fail('raffle_drawn');
        s.raffles = (s.raffles ?? []).filter((x) => x.id !== Number(a.p_id));
      });
      case 'mod_raffle_draw': return this.raffleDraw(Number(a.p_id));
      case 'mod_raffle_replay': return this.mutate((s) => {
        const r = (s.raffles ?? []).find((x) => x.draws.some((d) => d.id === Number(a.p_draw)));
        const d = r?.draws.find((x) => x.id === Number(a.p_draw));
        if (!r || !d) return fail('no_raffle_draw');
        s.bingo.drawShow = { id: d.id, name: d.name, at: d.at, shownAt: Date.now(), entrants: this.raffleReel(s, r, d.name), total: d.total, kind: 'tombola', prize: r.prize, sponsor: r.sponsor };
      });
      case 'mod_prizes_due': return this.prizesDue(this.load());
      case 'mod_prize_given': return this.mutate((s) => {
        const id = Number(a.p_id);
        if (a.p_kind === 'roata') { const sp = s.spins.find((x) => x.id === id); if (sp) sp.fulfilled = true; }
        else if (a.p_kind === 'bingo') { const login = s.bingo.draws[id]; if (login) s.bingo.given = [...new Set([...(s.bingo.given ?? []), login])]; }
        else if (a.p_kind === 'tombola') { for (const r of s.raffles ?? []) for (const d of r.draws) if (d.id === id && !d.given) d.given = Date.now(); }
        else fail('bad_prize_kind');
      });
      case 'mod_autopilot': return this.autopilot();
      case 'mod_round_edit': return this.mutate((s) => {
        const r = s.rounds.find((x) => x.id === Number(a.p_round));
        if (!r || r.closesAt <= Date.now() || r.winnerId !== null) fail('round_closed');
        const R = r!;
        const old = Number(a.p_challenge), nid = Number(a.p_new), act = String(a.p_action);
        const ch = (id: number) => s.challenges.find((c) => c.id === id);
        if ((act === 'remove' || act === 'replace') && !R.items.some((x) => x.challengeId === old)) fail('not_in_round');
        if ((act === 'add' || act === 'replace') && !(ch(nid)?.status === 'pool' && ch(nid)?.votable)) fail('challenge_unavailable');
        const drop = (id: number) => {
          R.items = R.items.filter((x) => x.challengeId !== id);
          if (s.myVotes[R.id] === id) delete s.myVotes[R.id];   // their vote goes; they can vote again
          const c = ch(id); if (c && c.status === 'in_round') c.status = 'pool';
        };
        if (act === 'remove') { if (R.items.length <= 2) fail('need_two_challenges'); drop(old); }
        else if (act === 'add') { if (R.items.length >= 8) fail('round_full'); R.items.push({ challengeId: nid, votes: 0 }); ch(nid)!.status = 'in_round'; }
        else if (act === 'replace') { const i = R.items.findIndex((x) => x.challengeId === old); drop(old); R.items.splice(i, 0, { challengeId: nid, votes: 0 }); ch(nid)!.status = 'in_round'; }
        else fail('bad_action');
      });
      case 'mod_challenge_add': {
        const title = String(a.p_title ?? '').trim().slice(0, 140);
        if (!title) fail('challenge_title');
        if (!['ușor', 'mediu', 'greu'].includes(String(a.p_level))) fail('bad_level');
        let id = 0;
        this.mutate((s) => {
          if (s.challenges.some((c) => c.title.trim().toLowerCase() === title.toLowerCase() && ['pool', 'in_round', 'scheduled'].includes(c.status))) fail('challenge_exists');
          id = Math.max(0, ...s.challenges.map((c) => c.id)) + 1;
          s.challenges.push({ id, title, how: title, level: String(a.p_level), category: 'moderatori', votable: true, status: 'pool', scheduledFor: null, clip: null });
        });
        return id;
      }
      case 'mod_sponsors': return this.sortedSponsors(this.load());
      case 'mod_sponsor_save': return this.sponsorSave(a.p ?? {});
      case 'mod_sponsor_delete': return this.mutate((s) => { s.sponsors = this.sponsorsOf(s).filter((x) => x.id !== Number(a.p_id)); });
      case 'mod_sponsor_move': return this.sponsorMove(Number(a.p_id), Number(a.p_dir));
      // «Mod test» needs the real database; the demo is all sample data already.
      case 'mod_test': return fail('demo_test');
      case 'mod_test_sponsors': return fail('demo_test');
      case 'mod_scene_set': return this.mutate((s) => { s.sceneBg = (a.p_background as string | null) || null; });
      case 'mod_tasks_set': return this.mutate((s) => {
        const items = (a.p_items as { price: number | string; title: string }[]).map((x) => ({ price: Number(String(x.price).replace(',', '.')), title: String(x.title ?? '').trim() }));
        if (items.length > 8 || items.some((x) => !(x.price > 0 && x.price <= 10000) || !x.title || x.title.length > 60)) fail('bad_tasks');
        if (new Set(items.map((x) => x.price)).size !== items.length) fail('duplicate_price');
        s.tasksMenu = items;
      });
      case 'mod_task_done': return this.mutate((s) => {
        const q = (s.taskQueue ?? []).find((x) => x.id === Number(a.p_id));
        if (!q) fail('no_task');
        q!.done = a.p_done !== false;
      });
      case 'mod_rehearsal': return this.mutate((s) => {
        const now = Date.now();
        const act = String(a.p_action);
        const m = Math.max(1, Math.min(Number(a.p_minutes) || 10, 240));
        if (act === 'start') {
          // The demo clock is always live, so the demo allows a rehearsal anyway (the real backend refuses).
          s.rehearsal = { until: now + 2 * HOUR, endsAt: now + 24 * HOUR, pausedUntil: null, doubleFrom: null, doubleUntil: null, last: null };
          return;
        }
        if (act === 'stop') { s.rehearsal = null; return; }
        const r = s.rehearsal;
        if (!r || r.until <= now) fail('rehearsal_off');
        const R = r!;
        const gain = (kind: 'donation' | 'gift', amount: number, secs: number) => {
          const dbl = !!R.doubleUntil && R.doubleUntil > now;
          const sec = secs * (dbl ? 2 : 1);
          R.endsAt += sec * 1000;
          R.last = { n: (R.last?.n ?? 0) + 1, kind, user: 'TEST', amount, seconds: sec, doubled: dbl };
        };
        if (act === 'donation') gain('donation', 10, 10 * RATES.donation[0]);
        else if (act === 'gift') gain('gift', 20, 20 * RATES.gift[0]);
        else if (act === 'freeze') { R.endsAt += m * MIN; R.pausedUntil = Math.max(R.pausedUntil ?? now, now) + m * MIN; }
        else if (act === 'unfreeze') { if (R.pausedUntil && R.pausedUntil > now) { R.endsAt -= R.pausedUntil - now; R.pausedUntil = null; } }
        else if (act === 'double') { R.doubleFrom = now; R.doubleUntil = now + m * MIN; }
        else if (act === 'nodouble') { R.doubleFrom = null; R.doubleUntil = null; }
        else fail('bad_rehearsal');
      });
      case 'mod_overlay_test': return this.mutate((s) => {
        if (!['event', 'gift', 'moments', 'code', 'promo'].includes(String(a.p_kind))) fail('bad_test');
        s.overlayTest = { kind: String(a.p_kind), at: Date.now(), n: (s.overlayTest?.n ?? 0) + 1 };
      });
      case 'mod_autopilot_set': return this.mutate((s) => {
        const ap = this.autopilotOf(s);
        const p = a.p ?? {};
        if (this.asMod && 'autoStart' in p && !!p.autoStart !== !!ap.autoStart) fail('only_broadcaster');
        if ('discordWebhook' in p) {
          const hook = String(p.discordWebhook ?? '').trim();
          if (hook && !/^https:\/\/(discord\.com|discordapp\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(hook)) fail('bad_webhook');
          ap.hasWebhook = !!hook;
        }
        if (p.voteAt !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.voteAt))) fail('bad_autopilot');
        if (p.voteMinutes !== undefined && !(Number(p.voteMinutes) >= 10 && Number(p.voteMinutes) <= 720)) fail('bad_autopilot');
        for (const k of ['autoStart', 'voteOn'] as const) if (p[k] !== undefined) ap[k] = !!p[k];
        if (p.voteAt !== undefined) ap.voteAt = String(p.voteAt);
        if (p.voteMinutes !== undefined) ap.voteMinutes = Number(p.voteMinutes);
        if (p.startHours !== undefined) ap.startHours = Number(p.startHours) || 24;
      });
      case 'mod_alert_test': if (!this.autopilotOf(this.load()).hasWebhook) fail('no_webhook'); return true;
      case 'mod_plan_add': return this.mutate((s) => {
        const at = ms(a.p_at) ?? 0;
        if (at < Date.now() - 60_000) fail('plan_in_past');
        if (a.p_kind === 'freeze' && !((ms(a.p_until) ?? 0) > at)) fail('bad_until');
        if (a.p_kind !== 'freeze' && !(Number(a.p_minutes) >= 1 && Number(a.p_minutes) <= (a.p_kind === 'code' ? 60 : 720))) fail('bad_minutes');
        const ap = this.autopilotOf(s);
        ap.plan.push({ id: ++s.seq, kind: a.p_kind, at, minutes: a.p_kind === 'freeze' ? null : Number(a.p_minutes),
          until: a.p_kind === 'freeze' ? ms(a.p_until) : null, sponsor: (a.p_sponsor ?? '').trim() || null, by: 'icemanlucky' });
        ap.plan.sort((x, y) => x.at - y.at);
      });
      case 'mod_plan_del': return this.mutate((s) => { const ap = this.autopilotOf(s); ap.plan = ap.plan.filter((x) => x.id !== Number(a.p_id)); });
      case 'mod_checklist_set': return this.mutate((s) => {
        const ap = this.autopilotOf(s);
        if (a.p_done) ap.checklist[String(a.p_key)] = { by: 'icemanlucky', at: Date.now() };
        else delete ap.checklist[String(a.p_key)];
      });
      case 'mod_bingo_rule': return this.mutate((s) => {
        const r = a.p_rule;
        if (r && (Object.keys(r).length > 1 && !(Number(Object.values(r)[1]) > 0))) fail('bad_rule');
        const it = s.bingo.items.find((x) => x.id === Number(a.p_id));
        if (it) it.rule = r ?? null;
      });
      case 'mod_review_all': {
        const ids = this.load().suggestions.filter((x) => x.status === 'pending').map((x) => x.id);
        ids.forEach((id) => this.reviewSuggestion(id, !!a.p_approve));
        return ids.length;
      }
      default: return fail(`unknown_${fn}`);
    }
  }
}

/** The owner's first list (24 Nov 2026); /mod can change it. */
function demoTasksMenu(s: DemoState) {
  return s.tasksMenu ?? [{ price: 5, title: 'Alege linia' }, { price: 10, title: 'Alege un campion' }, { price: 25, title: 'Alege 3 campioni' }, { price: 50, title: 'Joacă cu o mână' }];
}
