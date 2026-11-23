// Port of the design's renderVals(): turns UI state + site data into the
// values the page shows. Pure, so the build (first paint) and the browser
// (every update) produce exactly the same output.

import { ADVENT_DAYS, adventDates, adventTree, badgeDefs, boardTabs as boardTabDefs, boardUnits, calcOptions, placeholderTicker } from '../data/content';
import { site } from '../data/site';
import type { BoardTab, Loyalty, Mine, SiteData } from '../data/types';
import { ago, cleanTitle, count, dateRo, dayRo, duration, fmtInt, pad, timeRo } from './format';

/** Badges from chat presence (private.loyalty in the database). */
export const badgeLabels: Record<string, string> = {
  og: 'Ziua 1 OG', night: 'Tura de noapte', h10: '10 ore', h50: '50 de ore', h100: '100 de ore', streak7: 'Serie de 7 zile',
};

export type Viewer = 'out' | 'nonsub' | 'sub';
export type VoteTab = 'open' | 'next' | 'done';

export interface State {
  /** ?demo: sample data, local-only actions and the state switcher. */
  demo: boolean;
  showSnow: boolean;
  /** Epoch ms, ticks every second. */
  now: number;
  viewer: Viewer;
  viewerName: string;
  /** Wheel: spins available now (0 or 1), minutes watched today, already spun today. */
  spins: number;
  watchedToday: number;
  spunToday: boolean;
  /** Bonus spins from secret codes (already counted in `spins`), and the code being typed. */
  bonusSpins: number;
  codeInput: string;
  menu: boolean;
  tab: BoardTab;
  voteTab: VoteTab;
  myVote: string | null;
  toast: 'goal' | 'vote' | 'info' | null;
  info: { eyebrow: string; text: string };
  wheelDeg: number;
  spinning: boolean;
  result: number | null;
  /** Bingo: the 5 events being chosen, and what's saved on the server (null = nothing yet). */
  bingoPick: number[];
  bingoSaved: number[] | null;
  suggestion: string;
  suggestDone: boolean;
  copied: boolean;
  /** false: the viewer chose to appear as "Anonim" in public. */
  isPublic: boolean;
  /** The logged-in viewer's own contribution and loyalty (null when logged out or unknown). */
  mine: Mine | null;
  loyalty: Loyalty | null;
  /** «Cât adaugi tu?»: the chosen option. */
  calcPick: number;
  /** Iceman's bubble: what he says about the latest event (null = nothing yet). */
  bubble: { who: string; text: string; time: string } | null;
  /** Bumped on every reaction; its parity restarts the hop / flash / pop animations. */
  fx: number;
  /** The badge whose explanation is open (tap on phones). */
  badgeTip: string | null;
  /** "Vezi tot" toggles on phones. */
  more: { feed: boolean; loyal: boolean; goals: boolean; days: boolean; prizes: boolean };
  /** The Twitch player loads only on request. */
  playerOn: boolean;
}

export function initialState(): State {
  return {
    demo: false,
    showSnow: true,
    now: 0,
    viewer: 'out',
    viewerName: '',
    isPublic: true,
    mine: null,
    loyalty: null,
    spins: 0,
    watchedToday: 0,
    spunToday: false,
    bonusSpins: 0,
    codeInput: '',
    menu: false,
    tab: 'donations',
    voteTab: 'open',
    myVote: null,
    toast: null,
    info: { eyebrow: '', text: '' },
    wheelDeg: 0,
    spinning: false,
    result: null,
    bingoPick: [],
    bingoSaved: null,
    suggestion: '',
    suggestDone: false,
    copied: false,
    calcPick: 0,
    bubble: null,
    fx: 0,
    badgeTip: null,
    more: { feed: false, loyal: false, goals: false, days: false, prizes: false },
    playerOn: false,
  };
}

/** "+30 min", "+1 h", "+2 h 30 min" (the calculator and the bubble). */
export function words(sec: number): string {
  const m = Math.round(sec / 60), h = Math.floor(m / 60), r = m % 60;
  return h ? `+${fmtInt(h)} h${r ? ` ${r} min` : ''}` : `+${r} min`;
}

const roParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Days since 1970 of the Romanian calendar date of `ms` (for day numbers that flip at local midnight). */
export function roDay(ms: number): number {
  const [y, m, d] = roParts.format(new Date(ms)).split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}
const shortMonths = ['IAN', 'FEB', 'MAR', 'APR', 'MAI', 'IUN', 'IUL', 'AUG', 'SEP', 'OCT', 'NOI', 'DEC'];
/** Default start (20 Dec 2026, 12:00 Romania) for the Advent calendar before the timer is set. */
const DEFAULT_START = Date.UTC(2026, 11, 20, 10, 0, 0);

const bool = (b: boolean): 'true' | 'false' => (b ? 'true' : 'false');


export function derive(s: State, d: SiteData) {
  const live = d.status === 'live';
  const upcoming = d.status === 'upcoming';

  // Countdown: to the end while live (frozen during "Îngheți timpul"), to the start while upcoming.
  let r: number | null = null;
  if (live && d.endsAt !== null) {
    const ref = d.pausedUntil !== null && d.pausedUntil > s.now ? d.pausedUntil : s.now;
    r = Math.max(0, Math.floor((d.endsAt - ref) / 1000));
  } else if (upcoming && d.startsAt !== null) {
    r = Math.max(0, Math.floor((d.startsAt - s.now) / 1000));
  } else if (d.status === 'ended') {
    r = 0;
  }
  const dd = r === null ? '--' : pad(Math.floor(r / 86400));
  const hh = r === null ? '--' : pad(Math.floor((r % 86400) / 3600));
  const mm = r === null ? '--' : pad(Math.floor((r % 3600) / 60));
  const ss = r === null ? '--' : pad(r % 60);

  // "Ora dublă": running now, or the next scheduled one.
  const doubleNow = d.doubleFrom !== null && d.doubleUntil !== null && s.now >= d.doubleFrom && s.now < d.doubleUntil;
  const doubleSoon = d.doubleFrom !== null && d.doubleFrom > s.now;
  const doubleBy = d.doubleSponsor ? ` Oferită de ${d.doubleSponsor}.` : '';
  const doubleText = doubleNow
    ? `acum, până la ${timeRo(d.doubleUntil!)}. Tot timpul adăugat valorează dublu.${doubleBy}`
    : doubleSoon ? `${dayRo(d.doubleFrom!, s.now)} la ${timeRo(d.doubleFrom!)}. Tot timpul adăugat valorează dublu.${doubleBy}` : '';

  const startText = d.startsAt !== null ? dateRo(d.startsAt) : '[DATA DE START]';
  const endDateText = d.scheduledEnd !== null ? dateRo(d.scheduledEnd) : site.endDate;

  const isOut = s.viewer === 'out';
  const isNonsub = s.viewer === 'nonsub';
  const isSub = s.viewer === 'sub';

  // Milestone Maraton: unlocked by the donation total (€).
  const subs = d.subs;
  const raised = d.raisedNum;
  const marks = d.goals.map((g) => g.threshold);
  let foundCurrent = false;
  let nextIdx = marks.length - 1;
  const goals = d.goals.map((g, i) => {
    const t = g.threshold;
    const done = raised >= t;
    const current = !done && !foundCurrent;
    if (current) { foundCurrent = true; nextIdx = i; }
    const prev = i === 0 ? 0 : marks[i - 1];
    const pct = Math.max(0, Math.min(100, Math.round(((raised - prev) / (t - prev)) * 100))) + '%';
    return {
      no: pad(i + 1), threshold: fmtInt(t) + ' €', title: g.title, sponsor: g.sponsor ?? '',
      done, current, locked: !done && !current, pct,
      numColor: done ? 'var(--ice)' : current ? '#FFFFFF' : '#2A3445',
      titleColor: done ? '#AEB8C7' : current ? '#F2F5FA' : '#8C97A8',
      deco: done ? 'line-through' : 'none',
    };
  });
  const unlockedCount = goals.filter((g) => g.done).length;
  const lastUnlocked = unlockedCount > 0 ? goals[unlockedCount - 1] : null;
  const nextMark = marks[nextIdx] ?? 0;
  const prevMark = nextIdx <= 0 ? 0 : marks[nextIdx - 1];
  const progress = nextMark > prevMark ? Math.max(0, Math.min(100, ((raised - prevMark) / (nextMark - prevMark)) * 100)) : 0;

  // Ticker: real events once there are any.
  const tick = d.ticker.length > 0 ? d.ticker : placeholderTicker(startText);
  const tickerTwice = tick.concat(tick, tick, tick);

  // Vote
  const round = d.round;
  const roundOpen = round !== null && s.now < round.closesAt;
  const rl = round ? Math.max(0, Math.floor((round.closesAt - s.now) / 1000)) : 0;
  const roundLeft = rl >= 3600
    ? `${Math.floor(rl / 3600)}:${pad(Math.floor((rl % 3600) / 60))}:${pad(rl % 60)}`
    : `${pad(Math.floor(rl / 60))}:${pad(rl % 60)}`;
  const roundLabel = !round ? '' : roundOpen ? `Runda ${round.number} se închide în` : `Runda ${round.number} s-a închis`;
  const myVote = isSub ? s.myVote : null;
  // Tallies already include the viewer's own vote (live and demo backend alike).
  const withMine = d.challenges;
  const total = withMine.reduce((a, c) => a + c.votes, 0);
  const maxVotes = Math.max(0, ...withMine.map((c) => c.votes));
  const canVote = isSub && roundOpen;
  const challenges = withMine.map((c, i) => {
    const mine = myVote === c.id;
    const leading = maxVotes > 0 && c.votes === maxVotes;
    return {
      id: c.id, n: i + 1, title: c.title, desc: c.desc, votesText: fmtInt(c.votes),
      pct: (total ? Math.round((c.votes / total) * 100) : 0) + '%', leading,
      rowBg: mine ? 'rgba(92,203,255,0.07)' : 'transparent',
      numColor: mine ? 'var(--ice)' : leading ? '#FFFFFF' : '#2A3445',
      bar: mine ? 'var(--ice)' : leading ? '#FFFFFF' : '#4A5568',
      canVote, locked: !canVote, lockText: isSub ? 'Runda închisă' : 'Doar abonați',
      pressed: bool(mine),
      btnLabel: mine ? 'Votul tău ✓' : myVote ? 'Mută votul aici' : 'Votează',
      btnBg: mine ? 'var(--ice)' : 'transparent',
      btnColor: mine ? '#04101A' : '#F2F5FA',
      btnBorder: mine ? 'var(--ice)' : '#F2F5FA',
    };
  });
  const myTitle = myVote ? d.challenges.find((c) => c.id === myVote)?.title ?? '' : '';
  const voteHint = !roundOpen
    ? 'Așteaptă următoarea rundă de vot.'
    : myVote ? 'Ai votat. Poți muta votul până se închide runda.' : 'Ai 1 vot în runda asta.';
  const vt = s.voteTab;
  const voteTabs = ([['open', 'Vot deschis'], ['next', 'Urmează'], ['done', 'Făcute']] as [VoteTab, string][]).map(([id, label]) => ({
    id, label, sel: vt === id,
    line: vt === id ? 'var(--ice)' : 'transparent',
    color: vt === id ? '#F2F5FA' : '#7D8899',
  }));

  // Wheel
  const spinning = s.spinning;
  const res = s.result;
  const hasResult = res !== null && !spinning && !isOut;
  const isLose = res === d.losePrize;
  // Daily wheel: subscribers, 2 hours watched today (Romania time), 1 spin per day.
  const NEED = 120;
  const watched = Math.min(NEED, Math.max(0, s.watchedToday));
  const flakes = [0, 1, 2, 3].map((i) => ({ color: watched >= (i + 1) * 30 ? 'var(--ice)' : '#2A3445' }));
  const spins = s.spins;
  const flakesLabel = `${watched} din ${NEED} de minute privite azi`;
  const wheelLive = live;
  const flakesNote = !isSub
    ? 'Roata e doar pentru abonați. După ce te abonezi, apasă «M-am abonat, verifică iar».'
    : s.spunToday ? 'Ai învârtit azi. Mâine ai o nouă rotire după 2 ore de privit (ziua începe la 00:00).'
    : !wheelLive ? 'Roata se deschide odată cu maratonul.'
    : watched >= NEED ? 'Ai stat 2 ore azi: rotirea ta te așteaptă.'
    : `Mai ai ${count(NEED - watched, 'minut', 'minute')} de privit azi până la rotire.`;
  const prizes = d.prizes.map((p, i) => ({ short: p[0], color: p[2], rot: 'rotate(' + (i * 45 + 22.5 - 90) + 'deg)' }));

  // Toast
  let toastOn = false, toastEyebrow = '', toastText = '', toastColor = '#FFFFFF', toastBorder = '#FFFFFF';
  if (s.toast === 'goal' && live && lastUnlocked) {
    toastOn = true; toastEyebrow = 'Milestone deblocat';
    toastText = 'Nr. ' + lastUnlocked.no + ' · ' + lastUnlocked.title;
  } else if (s.toast === 'vote' && myVote) {
    toastOn = true; toastEyebrow = 'Vot înregistrat'; toastText = myTitle;
    toastColor = 'var(--ice)'; toastBorder = 'var(--ice)';
  } else if (s.toast === 'info') {
    toastOn = true; toastEyebrow = s.info.eyebrow; toastText = s.info.text;
  }

  // Leaderboard
  const tab = s.tab;
  const board = d.boards[tab].map((row, i) => ({
    rank: i + 1, user: row[0], value: row[1], unit: boardUnits[tab],
    rankColor: i === 0 ? '#FFFFFF' : i < 3 ? 'var(--ice)' : '#4A5568',
  }));
  const boardTabs = boardTabDefs.map(([id, label]) => ({
    id, label, sel: tab === id,
    line: tab === id ? 'var(--ice)' : 'transparent',
    color: tab === id ? '#F2F5FA' : '#7D8899',
  }));

  // ---- Comunitatea ----
  const live0 = d.status === 'live';
  const dayNumber = live0 && d.startsAt !== null && s.now >= d.startsAt ? Math.floor((s.now - d.startsAt) / 86_400_000) + 1 : null;
  // "Acum pe stream": a moderator note wins; otherwise the cleaned Twitch title and game.
  const nowBits = d.now?.note ? [d.now.note] : [cleanTitle(d.now?.title ?? null), d.now?.game ?? ''].filter(Boolean);
  const nowText = [...nowBits, ...(dayNumber ? [`Ziua ${dayNumber}`] : [])].join(' · ');

  // Legends: the top 5 of the running totals, per category.
  const legendRows = (rows: [string, string][], unit: string) => rows.slice(0, 5).map((r, i) => ({ rank: i + 1, name: r[0], total: r[1], unit }));
  const legendsDon = legendRows(d.boards.donations, '€');
  const legendsGifts = legendRows(d.boards.gifts, 'subs');
  const legendsBits = legendRows(d.boards.bits, 'biți');

  const T = d.today;
  const todayBig = T ? `+${duration(T.seconds)}` : '+0 min';
  const todayLine = T
    ? [count(T.people, 'om', 'oameni'), count(T.subs, 'sub', 'subs'), `${fmtInt(T.donated)} €`, ...(T.bits ? [count(T.bits, 'bit', 'biți')] : [])].join(' · ')
    : 'Încă nimic azi. Primul sub al zilei deschide lista.';
  const recentFeed = d.ticker.filter((t) => t.time !== '—').slice(0, 6).map((t) => ({ ...t, agoText: t.at ? ago(t.at, s.now) : '' }));

  const loyalRows = d.loyal.map((l, i) => ({ rank: i + 1, name: l.name, hours: count(l.hours, 'oră', 'ore'), streak: l.streak,
    streakText: l.streak ? `${count(l.streak, 'zi', 'zile')} la rând` : '', badges: l.badges.map((b) => badgeLabels[b] ?? b),
    badgeIds: badgeDefs.filter((b) => l.badges.includes(b.id)).map((b) => b.id),
    who: Object.fromEntries(l.badges.map((b) => [b, d.badgeCounts?.[b] !== undefined ? `O au ${count(d.badgeCounts[b], 'om', 'oameni')} din chat` : ''])) as Record<string, string> }));

  const G = d.together;
  const tHours = G?.hours ?? 0;
  const tGoals = (G?.goals ?? []).map((g) => ({ ...g, done: tHours >= g.hours }));
  const tNext = tGoals.find((g) => !g.done) ?? null;
  const tPrev = [...tGoals].reverse().find((g) => g.done)?.hours ?? 0;
  const togetherPct = tNext ? Math.max(0, Math.min(100, Math.round(((tHours - tPrev) / (tNext.hours - tPrev)) * 100))) + '%' : '100%';

  const M = s.mine, L = s.loyalty;
  const mineStats = M ? [
    { value: `+${duration(M.seconds)}`, label: 'adăugate de tine' },
    ...(M.subs || M.gifts ? [{ value: fmtInt(M.subs + M.gifts), label: M.gifts ? `subs (${fmtInt(M.gifts)} dăruite)` : 'subs' }] : []),
    ...(M.donated ? [{ value: `${fmtInt(M.donated)} €`, label: 'donați' }] : []),
    ...(M.bits ? [{ value: fmtInt(M.bits), label: 'biți' }] : []),
    { value: L ? count(L.hours, 'oră', 'ore') : '0 ore', label: 'în chat' },
    { value: L?.streak ? count(L.streak, 'zi', 'zile') : '0 zile', label: 'la rând' },
  ] : [];

  // Bingo: pick 5 events before the close; moderators tick what happens; all 5 → raffle.
  const B = d.bingo;
  const bingoOpen = B.closesAt === null || s.now < B.closesAt;
  const pick = s.bingoPick;
  const saved = s.bingoSaved;
  const mine = bingoOpen ? pick : (saved ?? []);
  const sameAsSaved = saved !== null && saved.length === pick.length && pick.every((id) => saved.includes(id));
  // The card is 5×5 (row by row); a pick is one line: 5 rows, 5 columns, 2 diagonals.
  const grid = B.items.slice(0, 25);
  const ids = grid.map((it) => it.id);
  const lineDefs: { ids: number[]; arrow: string; name: string }[] = grid.length === 25 ? [
    ...[0, 1, 2, 3, 4].map((r) => ({ ids: ids.slice(r * 5, r * 5 + 5), arrow: '→', name: `rândul ${r + 1}` })),
    ...[0, 1, 2, 3, 4].map((c) => ({ ids: [0, 1, 2, 3, 4].map((j) => ids[c + 5 * j]), arrow: '↓', name: `coloana ${c + 1}` })),
    { ids: [0, 1, 2, 3, 4].map((j) => ids[6 * j]), arrow: '↘', name: 'diagonala de sus-stânga' },
    { ids: [0, 1, 2, 3, 4].map((j) => ids[20 - 4 * j]), arrow: '↗', name: 'diagonala de jos-stânga' },
  ] : [];
  const sameSet = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));
  const bingoLines = lineDefs.map((l, n) => {
    const on = mine.length === 5 && sameSet(l.ids, mine);
    const names = l.ids.map((id) => grid.find((it) => it.id === id)?.label ?? '').join(', ');
    return { n, arrow: l.arrow, on, pressed: bool(on), disabled: !bingoOpen, aria: `Alege ${l.name}: ${names}` };
  });
  const bingo = grid.map((it) => {
    const on = mine.includes(it.id);
    const hit = !bingoOpen && it.happened;
    return {
      id: it.id, text: it.label, on, hit,
      bg: on ? (bingoOpen || hit ? 'var(--ice)' : 'rgba(63,208,255,0.12)') : '#0B1018',
      color: on && (bingoOpen || hit) ? '#04101A' : '#C9D2DF',
      border: on ? 'var(--ice)' : hit ? '#4A5568' : '#1A2230',
    };
  });
  const lineIdx = bingoLines.findIndex((l) => l.on);
  const bingo2 = grid.map((it) => {
    const on = mine.includes(it.id);
    const hit = it.happened;
    return { id: it.id, text: it.label, on, hit, cls: on && hit ? 'mine hit' : on ? 'mine' : hit ? 'hit' : '' };
  });
  const myLine = lineIdx >= 0 ? lineDefs[lineIdx].ids.map((id) => {
    const it = grid.find((x) => x.id === id);
    return { text: it?.label ?? '', hit: !!it?.happened };
  }) : [];
  const lineHits = myLine.filter((l) => l.hit).length;
  const hits = !bingoOpen && saved ? saved.filter((id) => B.items.find((it) => it.id === id)?.happened).length : 0;
  const isBingo = !bingoOpen && saved !== null && hits === 5;
  const closeText = B.closesAt !== null ? `${dateRo(B.closesAt)}, la ${timeRo(B.closesAt)}` : '';
  const prize = (B.prize && !B.prize.startsWith('[') ? B.prize : 'premiul cel mare') + (B.prizeSponsor ? ` de la ${B.prizeSponsor}` : '');
  const bingoStatus = bingoOpen
    ? (closeText ? `Alegerile se închid pe ${closeText}.` : 'Alegerile sunt deschise.')
    : 'Alegerile s-au închis. Moderatorii bifează pe parcurs ce se întâmplă pe stream.';
  const bingoNote = bingoOpen
    ? (isOut ? 'Alege o linie cu săgețile de pe margine și conectează-te cu Twitch ca s-o salvezi.'
      : sameAsSaved ? 'Linia ta e salvată. O poți schimba până la închidere.'
      : saved ? 'Ai schimbat linia. Salvează ca să rămână așa.'
      : 'Alege un rând, o coloană sau o diagonală cu săgețile de pe margine, apoi salvează.')
    : isOut ? 'Conectează-te cu Twitch ca să-ți vezi linia.'
    : !saved ? 'Nu ai ales o linie înainte de închidere. Data viitoare!'
    : isBingo ? `BINGO! Toate cele 5 s-au întâmplat: ești pe lista de tragere la sorți pentru ${prize}.`
    : `${hits} din 5 s-au întâmplat până acum.`;
  const bingoBtn = isOut ? 'Conectează-te ca să salvezi' : pick.length < 5 ? 'Alege o linie' : sameAsSaved ? 'Linie salvată ✓' : 'Salvează linia';
  const bingoBtnClass = isOut ? 'btn-twitch' : pick.length === 5 && !sameAsSaved ? 'btn-primary' : 'btn-ghost';


  // ---- Layout v2: hero stage ----
  const realFeed = d.ticker.filter((t) => t.time !== '—');
  const heroRecent = realFeed.slice(0, 4).map((t, i) => ({
    time: t.time, user: t.user, what: t.what, fresh: i === 0 && s.fx > 0,
    bg: i === 0 ? '#0E1A28' : '#090C11', border: i === 0 ? 'var(--ice)' : '#1C2230', op: [1, 0.85, 0.65, 0.45][i],
  }));
  const chip = realFeed[0] ?? null;
  const fxOn = s.fx > 0;
  const calcI = Math.min(Math.max(0, s.calcPick), calcOptions.length - 1);
  const calcSec = calcOptions[calcI].seconds * (doubleNow ? 2 : 1);
  const rClock = (x: number) => `${Math.floor(x / 86400)}z ${pad(Math.floor((x % 86400) / 3600))}:${pad(Math.floor((x % 3600) / 60))}:${pad(x % 60)}`;
  const calcAtOn = live && r !== null;

  // ---- Badges (the viewer's six, in order of difficulty) ----
  const held = new Set(s.loyalty?.badges ?? []);
  if (held.has('h100')) held.add('h50');
  if (held.has('h50')) held.add('h10');
  const hrs = s.loyalty?.hours ?? 0;
  const progressFor = (id: string) => ({
    og: 'doar în ziua 1', h10: `${fmtInt(Math.min(hrs, 10))} din 10 h`, night: 'o oră între 00 și 06',
    streak7: `${Math.min(s.loyalty?.streak ?? 0, 7)} din 7 zile`, h50: `${fmtInt(Math.min(hrs, 50))} din 50 h`, h100: `${fmtInt(Math.min(hrs, 100))} din 100 h`,
  } as Record<string, string>)[id] ?? '';
  const whoHas = (id: string) => {
    const n = d.badgeCounts?.[id];
    if (n === undefined) return '';
    return n === 0 ? 'Încă n-o are nimeni din chat' : n === 1 ? 'O are 1 om din chat' : `O au ${count(n, 'om', 'oameni')} din chat`;
  };
  // Tier only (owner, 23 Nov): gamers read the tier, no «ușor / greu» needed.
  const tierNames = { bronze: 'bronz', silver: 'argint', gold: 'aur', plat: 'platină', prism: 'legendar' };
  const myBadges = badgeDefs.map((b) => ({ ...b, earned: held.has(b.id),
    note: held.has(b.id) ? 'câștigată' : isOut ? tierNames[b.tier] : progressFor(b.id), who: whoHas(b.id), open: s.badgeTip === b.id }));
  const tip = s.badgeTip ? myBadges.find((b) => b.id === s.badgeTip) ?? null : null;

  // ---- Milestone Maraton: track → next goal → clips ----
  const N = d.goals.length;
  const start0 = d.startsAt;
  const track = d.goals.map((g, i) => {
    const happened = !!g.doneAt;
    const unlocked = raised >= g.threshold;
    const state = happened ? 'done' : unlocked ? 'unlocked' : goals[i]?.current ? 'next' : 'rest';
    return { no: pad(i + 1), title: g.title, amount: fmtInt(g.threshold) + ' €', state, sponsor: g.sponsor ?? '', clip: g.clip ?? null };
  });
  const happenedCount = track.filter((t) => t.state === 'done').length;
  const pending = track.find((t) => t.state === 'unlocked') ?? null;
  const pendingWhen = pending ? d.goals[Number(pending.no) - 1]?.when ?? '' : '';
  const step = N ? 100 / N : 0;
  const fillW = unlockedCount === 0 ? 0 : Math.min((N - 1) * step, (unlockedCount - 1 + (unlockedCount < N ? progress / 100 : 0)) * step);
  const nextGoal = unlockedCount < N ? d.goals[unlockedCount] : null;
  const clips = d.goals.map((g, i) => ({ g, i })).filter(({ g }) => g.doneAt && g.clip).map(({ g, i }) => ({
    no: pad(i + 1), title: g.title, clip: g.clip!, amount: fmtInt(g.threshold) + ' €',
    when: g.doneAt && start0 ? `Ziua ${Math.max(1, roDay(g.doneAt) - roDay(start0) + 1)}` : '',
  }));
  const segs = track.map((t) => ({
    bg: t.state === 'done' ? 'var(--ice)' : t.state === 'unlocked' ? '#F2F5FA'
      : t.state === 'next' ? `linear-gradient(90deg, var(--ice) ${progress.toFixed(0)}%, #1A2230 ${progress.toFixed(0)}%)` : '#1A2230',
  }));

  // ---- Wheel: slices and the prize list by category ----
  const slices = d.prizes.map((p, i) => ({ label: p[0].toUpperCase(), sponsor: !!p[3], lose: i === d.losePrize }));
  const cat = (p: SiteData['prizes'][number], i: number) =>
    p[3] ? 0 : i === d.losePrize ? 3 : /^\+\s*\d+\s*min/i.test(p[0]) ? 1 : 2;
  const catNames = ['Premii de la parteneri', 'Timp pe cronometru', 'Pe stream', 'Mai încearcă'];
  const catColors = ['#E6C46A', '#F2F5FA', '#F2F5FA', '#8C97A8'];
  const prizeGroups = catNames.map((name, k) => {
    const list = d.prizes.map((p, i) => ({ p, i })).filter(({ p, i }) => cat(p, i) === k);
    return { name, color: catColors[k], count: list.length,
      items: k === 3 ? 'mâine ai o rotire nouă' : list.map(({ p }) => p[3] ? `${p[1]} (${p[3]})` : p[1]).join(', ') };
  }).filter((g) => g.count > 0);

  // ---- Advent calendar: the 22 days ----
  const startAt = d.startsAt ?? DEFAULT_START;
  const todayN = roDay(s.now) - roDay(startAt) + 1;
  const advent = Array.from({ length: ADVENT_DAYS }, (_, k) => {
    const n = k + 1;
    const at = (d.calendarStart ?? startAt) + k * 86_400_000;
    const parts = roParts.format(new Date(at)).split('-').map(Number);
    const set = d.advent.find((a) => a.day === n);
    const md = `${pad(parts[1])}-${pad(parts[2])}`;
    const fixed = n === 1 ? 'Startul' : n === ADVENT_DAYS ? 'Finalul programat' : adventDates[md] ?? '';
    const note = [set?.note || fixed, set?.sponsor ?? ''].filter(Boolean).join(' · ');
    return { n: pad(n), date: `${parts[2]} ${shortMonths[parts[1] - 1]}`, note, clip: set?.clip ?? null,
      past: n < todayN, today: n === todayN, future: n > todayN, holiday: adventTree.includes(md) };
  });
  const dayFrom = Math.min(Math.max(0, todayN - 4), ADVENT_DAYS - 8);

  const sug = s.suggestion;

  return {
    showSnow: s.showSnow,
    dd, hh, mm, ss, navClock: `${dd}:${hh}:${mm}:${ss}`, tickerTwice,
    isLive: live, pops: live ? d.pops : [],
    statusText: live ? 'LIVE' : upcoming ? 'ÎNCEPE CURÂND' : 'ÎNCHEIAT',
    liveBg: live ? '#D5162B' : '#2A3445',
    timerLabel: live ? 'Timp rămas' : upcoming ? 'Începe în' : 'Subathonul s-a încheiat',
    timerLabelUp: live ? 'TIMP RĂMAS' : upcoming ? 'ÎNCEPE ÎN' : 'ÎNCHEIAT',
    endDateText,
    hasDouble: doubleNow || doubleSoon, doubleText, doubleNow, doubleSponsor: d.doubleSponsor ?? '',
    isFrozen: live && d.pausedUntil !== null && d.pausedUntil > s.now,
    frozenText: live && d.pausedUntil !== null && d.pausedUntil > s.now
      ? `până pe ${dateRo(d.pausedUntil)}, la ${timeRo(d.pausedUntil)}. Subs și donațiile adaugă timp în continuare.` : '',
    subsText: fmtInt(subs),
    nextGoalText: fmtInt(nextMark) + ' €',
    nextGoalTitle: d.goals[nextIdx]?.title ?? '',
    raisedText: d.raised,
    progressPct: progress.toFixed(1) + '%',
    progressLabel: fmtInt(Math.floor(raised)) + ' / ' + fmtInt(nextMark) + ' €',
    progressAria: `Spre următorul milestone: ${fmtInt(Math.floor(raised))} din ${fmtInt(nextMark)} €`,
    goals, unlockedCount, totalGoals: goals.length, board, boardTabs, boardLabelledBy: 'tab-board-' + tab,
    boardEmpty: board.length === 0,

    isOut, isNonsub, isSub, isIn: !isOut,
    viewerName: s.viewerName,
    viewerInitial: (s.viewerName.charAt(0) || 'V').toUpperCase(),
    chipLabel: `Conectat ca ${s.viewerName}. Deconectează-te`,
    badgeText: isSub ? 'ABONAT' : 'URMĂRITOR',
    badgeBg: isSub ? 'var(--ice)' : '#1A2230',
    badgeColor: isSub ? '#04101A' : '#AEB8C7',

    hasRound: round !== null, roundLabel, roundLeft,
    voteSub: round ? (roundOpen ? `Runda ${round.number} · câștigătoarea se face live` : `Runda ${round.number} s-a închis · urmează una nouă`) : 'Prima rundă se deschide odată cu maratonul.',
    challenges, voteHint, voteTabs,
    upNext: d.upNext, completed: d.completed,
    tabOpen: vt === 'open', tabNext: vt === 'next', tabDone: vt === 'done',

    prizes, wheelTransform: `rotate(${s.wheelDeg}deg)`, spinning, flakes,
    flakesLabel,
    flakesNote,
    spinsText: spins > 1 ? `Ai ${spins} rotiri` : spins === 1 ? (s.bonusSpins > 0 ? 'Ai 1 rotire bonus' : 'Ai 1 rotire azi')
      : !isSub ? 'Doar pentru abonați' : s.spunToday ? 'Ai învârtit azi' : `Azi: ${watched} / ${NEED} min`,
    spinLabel: isOut ? 'Conectează-te ca să învârți' : spinning ? 'Se învârte…' : spins > 0 ? 'Învârte roata'
      : !isSub ? 'Doar pentru abonați' : s.spunToday ? 'Revino mâine' : 'Mai stai puțin!',
    bonusText: s.bonusSpins > 0 ? `Ai ${s.bonusSpins === 1 ? '1 rotire bonus' : s.bonusSpins + ' rotiri bonus'} din coduri secrete.` : '',
    hasBonus: s.bonusSpins > 0,
    codeLen: s.codeInput.replace(/[^A-Za-z0-9]/g, '').length,
    spinClass: isOut ? 'btn-twitch' : spins > 0 || spinning ? 'btn-red' : 'btn-ghost',
    hasResult,
    resultTitle: hasResult && res !== null ? (isLose ? 'Data viitoare!' : 'Ai câștigat: ' + (d.prizes[res]?.[1] ?? '')) : '',
    resultNote: isLose ? 'Mâine ai o nouă rotire. Mai încearcă!' : 'Un moderator îți dă premiul pe stream în câteva minute.',
    recentWins: d.recentWins,

    // The open mobile menu sits under the toast, so the toast waits.
    toastOn: toastOn && !s.menu, toastEyebrow, toastText, toastColor, toastBorder,

    bingo, isBingo, bingoOpen, bingoClosed: !bingoOpen, bingoStatus, bingoNote,
    bingoLines,
    bingoCount: bingoOpen ? (pick.length === 5 ? 'Linie aleasă' : 'Alege o linie') : `${hits} / 5 întâmplate`,
    bingoPlayers: B.players === 1 ? '1 jucător' : `${fmtInt(B.players)} jucători`,
    bingoBtn, bingoBtnClass, bingoPrize: prize,
    bingo2, myLine, hasLine: myLine.length > 0, noLine: myLine.length === 0,
    lineName: lineIdx >= 0 ? `Linia ta · ${lineDefs[lineIdx].name}` : 'Linia ta',
    lineHits: `${lineHits} din 5`,
    bingoPrizeName: B.prize && !B.prize.startsWith('[') ? B.prize.charAt(0).toUpperCase() + B.prize.slice(1) : 'Se anunță în curând',
    bingoPrizeBy: B.prizeSponsor ? `· de la ${B.prizeSponsor}` : '',
    bingoClose: closeText || 'se anunță',
    bingoCloseLabel: bingoOpen ? 'Poți schimba linia până pe' : 'Alegerile s-au închis pe',
    bingoPlayersLong: B.players === 1 ? '1 jucător' : count(B.players, 'jucător', 'jucători'),

    suggestForm: isSub && !s.suggestDone,
    suggestSent: isSub && s.suggestDone,
    suggestLocked: !isSub,
    suggestLockText: isOut ? 'Conectează-te și abonează-te ca să propui provocări' : 'Abonează-te ca să propui provocări',
    suggestLen: sug.length,


    // Comunitatea
    hasNow: nowText !== '', nowText, nowLabel: d.now?.note ? 'Acum' : 'Acum pe stream',
    legendsDon, legendsGifts, legendsBits,
    hasLegends: legendsDon.length + legendsGifts.length + legendsBits.length > 0,
    todayBig, todayLine, recentFeed, hasRecent: recentFeed.length > 0,
    loyalRows, hasLoyal: loyalRows.length > 0,
    togetherHours: fmtInt(tHours) + ' h', togetherPct,
    togetherNext: tNext ? `Următorul: ${tNext.title} la ${fmtInt(tNext.hours)} h` : tGoals.length ? 'Toate obiectivele comunitare sunt deblocate!' : '',
    togetherGoals: tGoals.map((g) => ({ title: g.title, hours: fmtInt(g.hours) + ' h', done: g.done, current: g === tNext })),
    mineStats, mineBadges: (L?.badges ?? []).map((b) => badgeLabels[b] ?? b),
    mineNote: !M ? '' : M.seconds > 0 ? 'Mulțumim! Fiecare minut adăugat ține maratonul în viață.' : 'Și timpul petrecut în chat contează: seria de zile și insignele vin doar din prezență.',

    codeLabel: s.copied ? 'Copiat ✓' : 'Copiază',
    codeStatus: s.copied ? 'Codul a fost copiat' : '',

    menuOpen: s.menu,
    menuClosed: !s.menu,
    menuExpanded: bool(s.menu),


    // ---- Layout v2 ----
    navShort: `${dd}:${hh}:${mm}`,
    heroRecent, hasHeroRecent: heroRecent.length > 0, noHeroRecent: heroRecent.length === 0,
    chipOn: chip !== null, chipTime: chip?.time ?? '', chipUser: chip?.user ?? '', chipWhat: chip?.what ?? '',
    bubbleOn: s.bubble !== null, bubbleWho: s.bubble?.who ?? '', bubbleText: s.bubble?.text ?? '',
    fxA: fxOn && s.fx % 2 === 1, fxB: fxOn && s.fx % 2 === 0, popText: s.bubble?.time ?? '',
    calcOpts: calcOptions.map((o, i) => ({ i, label: o.label, on: i === calcI })),
    calcAdd: words(calcSec), calcFun: calcOptions[calcI].fun, calcAt: calcAtOn ? rClock(r! + calcSec) : '', calcAtOn,
    calcDouble: doubleNow,
    myBadges, myBadgesCount: `${myBadges.filter((b) => b.earned).length} din ${myBadges.length}`,
    tipOn: tip !== null, tipLabel: tip ? `${tip.label.toUpperCase()}${tip.earned ? ' · câștigată' : ` · ${tip.note}`}` : '',
    tipHow: tip?.how ?? '', tipWho: tip?.who ?? '',
    mineHead: s.mine ? `+${duration(s.mine.seconds)}` : '',
    mineLine: s.mine ? [
      ...(s.mine.subs + s.mine.gifts ? [count(s.mine.subs + s.mine.gifts, 'sub', 'subs')] : []),
      ...(s.mine.donated ? [`${fmtInt(s.mine.donated)} €`] : []),
      ...(s.mine.bits ? [count(s.mine.bits, 'bit', 'biți')] : []),
      `${count(s.loyalty?.hours ?? 0, 'oră', 'ore')} în chat`,
      `${count(s.loyalty?.streak ?? 0, 'zi', 'zile')} la rând`,
    ].join(' · ') : '',
    togetherOf: tNext ? `din ${fmtInt(tNext.hours)} h` : '',
    togetherBar: tNext ? Math.max(0, Math.min(100, Math.round((tHours / tNext.hours) * 100))) + '%' : '100%',
    togetherAt: tNext ? `La ${fmtInt(tNext.hours)} h: ${tNext.title.charAt(0).toLowerCase()}${tNext.title.slice(1)}` : tGoals.length ? 'Toate obiectivele comunitare sunt deblocate!' : '',
    more: s.more,
    moreFeed: s.more.feed, moreLoyal: s.more.loyal, moreGoals: s.more.goals, moreDays: s.more.days, morePrizes: s.more.prizes,
    moreFeedLabel: s.more.feed ? 'Arată mai puțin' : 'Vezi tot', moreLoyalLabel: s.more.loyal ? 'Arată mai puțin' : 'Vezi tot',
    moreGoalsLabel: s.more.goals ? 'Ascunde lista' : `Toate cele ${N}`, moreDaysLabel: s.more.days ? 'Arată mai puțin' : `Toate cele ${ADVENT_DAYS} de zile`,
    morePrizesLabel: s.more.prizes ? 'Ascunde premiile' : 'Vezi toate premiile',
    moreFeedPressed: bool(s.more.feed), moreLoyalPressed: bool(s.more.loyal), moreGoalsPressed: bool(s.more.goals),
    moreDaysPressed: bool(s.more.days), morePrizesPressed: bool(s.more.prizes),
    trackCols: `repeat(${Math.max(1, N)}, minmax(0, 1fr))`,
    track, trackFill: fillW.toFixed(2) + '%', trackLeft: (step / 2).toFixed(2) + '%', segs,
    goalsHead: `Donațiile deblochează provocări. ${happenedCount} din ${N} făcute până acum.`,
    goalsPhone: `${happenedCount} din ${N} făcute${pending ? ` · ${pending.no} urmează live` : ''}`,
    goalsLast: N ? fmtInt(d.goals[N - 1].threshold) + ' €' : '',
    hasNextGoal: nextGoal !== null, allGoalsDone: N > 0 && nextGoal === null,
    nextTag: nextGoal ? `URMĂTORUL · ${pad(unlockedCount + 1)}` : '', nextNoTitle: nextGoal ? `${pad(unlockedCount + 1)} · ${nextGoal.title}` : '',
    nextTitle: nextGoal?.title ?? '', nextAmount: nextGoal ? fmtInt(nextGoal.threshold) + ' €' : '',
    nextBar: progress.toFixed(1) + '%',
    nextOf: nextGoal ? `${fmtInt(Math.floor(raised))} € din ${fmtInt(nextGoal.threshold)} €` : '',
    nextLeft: nextGoal ? `mai sunt ${fmtInt(Math.max(0, Math.ceil(nextGoal.threshold - raised)))} €` : '',
    nextLeftCap: nextGoal ? `Mai sunt ${fmtInt(Math.max(0, Math.ceil(nextGoal.threshold - raised)))} €` : '',
    nextSponsor: nextGoal?.sponsor ? `Prezentat de ${nextGoal.sponsor}` : '',
    hasPending: pending !== null, pendingTitle: pending ? `${pending.no} · ${pending.title}` : '',
    pendingRest: pendingWhen ? ` e deblocat și se face live ${pendingWhen}.` : ' e deblocat și urmează live.',
    pendingShort: pending ? ` · ${pending.no} e deblocat și urmează live` : '',
    clips, hasClips: clips.length > 0, noClips: clips.length === 0,
    slices, prizeGroups, prizeTotal: d.prizes.length,
    advent, adventFrom: dayFrom,
    playerOn: s.playerOn, playerOff: !s.playerOn,

    // Demo panel (?demo)
    demo: s.demo,
    demoOut: bool(isOut), demoNonsub: bool(isNonsub), demoSub: bool(isSub),
    demoLive: bool(live), demoUpcoming: bool(!live),
    demoSnow: bool(s.showSnow),
    demoSnowLabel: s.showSnow ? 'Pornită' : 'Oprită',
  };
}

export type Vals = ReturnType<typeof derive>;
