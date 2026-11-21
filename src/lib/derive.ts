// Port of the design's renderVals(): turns UI state + site data into the
// values the page shows. Pure, so the build (first paint) and the browser
// (every update) produce exactly the same output.

import { bingo as bingoText, boardTabs as boardTabDefs, boardUnits, placeholderTicker } from '../data/content';
import { site } from '../data/site';
import type { BoardTab, SiteData } from '../data/types';
import { count, dateRo, dayRo, fmtInt, pad, timeRo } from './format';

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
  /** Spins available, snowflakes toward the next spin (0–2), minutes to the next snowflake. */
  spins: number;
  flakes: number;
  minutesToNextFlake: number;
  menu: boolean;
  tab: BoardTab;
  voteTab: VoteTab;
  myVote: string | null;
  toast: 'goal' | 'vote' | 'info' | null;
  info: { eyebrow: string; text: string };
  wheelDeg: number;
  spinning: boolean;
  result: number | null;
  marked: boolean[];
  suggestion: string;
  suggestDone: boolean;
  copied: boolean;
}

export function initialState(): State {
  return {
    demo: false,
    showSnow: true,
    now: 0,
    viewer: 'out',
    viewerName: '',
    spins: 0,
    flakes: 0,
    minutesToNextFlake: 60,
    menu: false,
    tab: 'gifts',
    voteTab: 'open',
    myVote: null,
    toast: null,
    info: { eyebrow: '', text: '' },
    wheelDeg: 0,
    spinning: false,
    result: null,
    marked: Array(16).fill(false),
    suggestion: '',
    suggestDone: false,
    copied: false,
  };
}

const bool = (b: boolean): 'true' | 'false' => (b ? 'true' : 'false');

/** Bingo lines: 4 rows, 4 columns, 2 diagonals. */
const BINGO_LINES: number[][] = (() => {
  const lines: number[][] = [];
  for (let k = 0; k < 4; k++) {
    lines.push([0, 1, 2, 3].map((j) => k * 4 + j));
    lines.push([0, 1, 2, 3].map((j) => j * 4 + k));
  }
  lines.push([0, 5, 10, 15], [3, 6, 9, 12]);
  return lines;
})();

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
  const doubleText = doubleNow
    ? `acum, până la ${timeRo(d.doubleUntil!)}. Tot timpul adăugat valorează dublu.`
    : doubleSoon ? `${dayRo(d.doubleFrom!, s.now)} la ${timeRo(d.doubleFrom!)}. Tot timpul adăugat valorează dublu.` : '';

  const startText = d.startsAt !== null ? dateRo(d.startsAt) : '[DATA DE START]';
  const endDateText = d.scheduledEnd !== null ? dateRo(d.scheduledEnd) : site.endDate;

  const isOut = s.viewer === 'out';
  const isNonsub = s.viewer === 'nonsub';
  const isSub = s.viewer === 'sub';

  // Goals
  const subs = d.subs;
  const marks = d.goals.map((g) => g.threshold);
  let foundCurrent = false;
  let nextIdx = marks.length - 1;
  const goals = d.goals.map((g, i) => {
    const t = g.threshold;
    const done = subs >= t;
    const current = !done && !foundCurrent;
    if (current) { foundCurrent = true; nextIdx = i; }
    const prev = i === 0 ? 0 : marks[i - 1];
    const pct = Math.max(0, Math.min(100, Math.round(((subs - prev) / (t - prev)) * 100))) + '%';
    return {
      no: pad(i + 1), threshold: fmtInt(t), title: g.title,
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
  const progress = nextMark > prevMark ? Math.max(0, Math.min(100, ((subs - prevMark) / (nextMark - prevMark)) * 100)) : 0;

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
  const flakes = [0, 1, 2].map((i) => ({ color: i < s.flakes ? 'var(--ice)' : '#2A3445' }));
  const spins = s.spins;
  const flakesLabel = s.flakes + ' din 3 fulgi pentru următoarea rotire';
  const prizes = d.prizes.map((p, i) => ({ short: p[0], color: p[2], rot: 'rotate(' + (i * 45 + 22.5 - 90) + 'deg)' }));

  // Toast
  let toastOn = false, toastEyebrow = '', toastText = '', toastColor = '#FFFFFF', toastBorder = '#FFFFFF';
  if (s.toast === 'goal' && live && lastUnlocked) {
    toastOn = true; toastEyebrow = 'Obiectiv deblocat';
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

  // Bingo
  const marked = s.marked;
  const bingo = bingoText.map((text, i) => {
    const on = marked[i];
    return {
      i, text, on, pressed: bool(on),
      bg: on ? 'var(--ice)' : '#0B1018',
      color: on ? '#04101A' : '#C9D2DF',
      border: on ? 'var(--ice)' : '#1A2230',
    };
  });
  const isBingo = BINGO_LINES.some((l) => l.every((x) => marked[x]));
  const markedCount = marked.filter(Boolean).length;

  const sug = s.suggestion;

  return {
    showSnow: s.showSnow,
    dd, hh, mm, ss, navClock: `${dd}:${hh}:${mm}:${ss}`, tickerTwice,
    isLive: live, pops: live ? d.pops : [],
    statusText: live ? 'LIVE' : upcoming ? 'ÎNCEPE CURÂND' : 'ÎNCHEIAT',
    liveBg: live ? '#D5162B' : '#2A3445',
    timerLabel: live ? 'Timp rămas' : upcoming ? 'Începe în' : 'Subathonul s-a încheiat',
    endDateText,
    hasDouble: doubleNow || doubleSoon, doubleText,
    subsText: fmtInt(subs),
    nextGoalText: fmtInt(nextMark),
    nextGoalTitle: d.goals[nextIdx]?.title ?? '',
    raisedText: d.raised,
    progressPct: progress.toFixed(1) + '%',
    progressLabel: fmtInt(subs) + ' / ' + fmtInt(nextMark) + ' subs',
    goals, unlockedCount, board, boardTabs, boardLabelledBy: 'tab-board-' + tab,
    boardEmpty: board.length === 0,

    isOut, isNonsub, isSub, isIn: !isOut,
    viewerName: s.viewerName,
    viewerInitial: (s.viewerName.charAt(0) || 'V').toUpperCase(),
    chipLabel: `Conectat ca ${s.viewerName}. Deconectează-te`,
    badgeText: isSub ? 'ABONAT' : 'URMĂRITOR',
    badgeBg: isSub ? 'var(--ice)' : '#1A2230',
    badgeColor: isSub ? '#04101A' : '#AEB8C7',

    hasRound: round !== null, roundLabel, roundLeft,
    challenges, voteHint, voteTabs,
    upNext: d.upNext, completed: d.completed,
    tabOpen: vt === 'open', tabNext: vt === 'next', tabDone: vt === 'done',

    prizes, wheelTransform: `rotate(${s.wheelDeg}deg)`, spinning, flakes,
    flakesLabel,
    flakesNote: `${flakesLabel}. Următorul fulg în ${count(s.minutesToNextFlake, 'minut', 'minute')}.`,
    spinsText: spins === 1 ? 'Ai 1 rotire' : 'Ai ' + spins + ' rotiri',
    spinLabel: isOut ? 'Conectează-te ca să învârți' : spinning ? 'Se învârte…' : spins > 0 ? 'Învârte roata' : 'Nu mai ai rotiri. Mai stai puțin!',
    spinClass: isOut ? 'btn-twitch' : spins > 0 || spinning ? 'btn-red' : 'btn-ghost',
    hasResult,
    resultTitle: hasResult && res !== null ? (isLose ? 'Data viitoare!' : 'Ai câștigat: ' + (d.prizes[res]?.[1] ?? '')) : '',
    resultNote: isLose ? 'Fulgii tăi se strâng în continuare. Mai încearcă.' : 'Un moderator îți dă premiul pe stream în câteva minute.',
    recentWins: d.recentWins,

    // The open mobile menu sits under the toast, so the toast waits.
    toastOn: toastOn && !s.menu, toastEyebrow, toastText, toastColor, toastBorder,

    bingo, isBingo, markedCount,

    suggestForm: isSub && !s.suggestDone,
    suggestSent: isSub && s.suggestDone,
    suggestLocked: !isSub,
    suggestLockText: isOut ? 'Conectează-te și abonează-te ca să propui provocări' : 'Abonează-te ca să propui provocări',
    suggestLen: sug.length,

    codeLabel: s.copied ? 'Copiat ✓' : 'Copiază',
    codeStatus: s.copied ? 'Codul a fost copiat' : '',

    menuOpen: s.menu,
    menuClosed: !s.menu,
    menuExpanded: bool(s.menu),

    // Demo panel (?demo)
    demo: s.demo,
    demoOut: bool(isOut), demoNonsub: bool(isNonsub), demoSub: bool(isSub),
    demoLive: bool(live), demoUpcoming: bool(!live),
    demoSnow: bool(s.showSnow),
    demoSnowLabel: s.showSnow ? 'Pornită' : 'Oprită',
  };
}

export type Vals = ReturnType<typeof derive>;
