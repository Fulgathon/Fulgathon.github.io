// Port of the design's renderVals(): turns state + data into the values the
// page shows. Pure, so the build (initial HTML) and the browser (updates)
// produce exactly the same output.

import type { BoardTab, SampleData } from '../data/sample';

export type Viewer = 'out' | 'nonsub' | 'sub';
export type Stream = 'live' | 'upcoming';
export type VoteTab = 'open' | 'next' | 'done';

export interface State {
  viewer: Viewer;
  stream: Stream;
  showSnow: boolean;
  demo: boolean;
  /** Whole seconds since the page loaded; drives every countdown. */
  elapsed: number;
  menu: boolean;
  tab: BoardTab;
  voteTab: VoteTab;
  myVote: string | null;
  toast: 'goal' | 'vote' | null;
  spins: number;
  wheelDeg: number;
  spinning: boolean;
  result: number | null;
  marked: boolean[];
  suggestion: string;
  suggestDone: boolean;
  copied: boolean;
}

export function initialState(data: SampleData): State {
  return {
    viewer: 'out',
    stream: 'live',
    showSnow: true,
    demo: false,
    elapsed: 0,
    menu: false,
    tab: 'gifts',
    voteTab: 'open',
    myVote: null,
    toast: 'goal',
    spins: data.spins,
    wheelDeg: 0,
    spinning: false,
    result: null,
    marked: data.bingoMarked.slice(),
    suggestion: '',
    suggestDone: false,
    copied: false,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (n: number) => n.toLocaleString('ro-RO');
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

export function derive(s: State, data: SampleData) {
  const live = s.stream === 'live';
  const remaining = Math.max(0, data.remainingSeconds - s.elapsed);
  const r = live ? remaining : Math.max(0, data.startsInSeconds - s.elapsed);
  const dd = pad(Math.floor(r / 86400));
  const hh = pad(Math.floor((r % 86400) / 3600));
  const mm = pad(Math.floor((r % 3600) / 60));
  const ss = pad(r % 60);
  const rl = (remaining + data.voteRoundOffset) % 3600;
  const roundLeft = pad(Math.floor(rl / 60)) + ':' + pad(rl % 60);

  const isOut = s.viewer === 'out';
  const isNonsub = s.viewer === 'nonsub';
  const isSub = s.viewer === 'sub';

  // Goals
  const subs = live ? data.subsLive : 0;
  const marks = data.goalMarks;
  let foundCurrent = false;
  let nextIdx = marks.length - 1;
  const goals = marks.map((t, i) => {
    const done = subs >= t;
    const current = !done && !foundCurrent;
    if (current) { foundCurrent = true; nextIdx = i; }
    const prev = i === 0 ? 0 : marks[i - 1];
    const pct = Math.max(0, Math.min(100, Math.round(((subs - prev) / (t - prev)) * 100))) + '%';
    return {
      no: pad(i + 1), threshold: fmt(t), title: data.goalTitles[i],
      done, current, locked: !done && !current, pct,
      numColor: done ? 'var(--ice)' : current ? '#FFFFFF' : '#2A3445',
      titleColor: done ? '#AEB8C7' : current ? '#F2F5FA' : '#8C97A8',
      deco: done ? 'line-through' : 'none',
    };
  });
  const unlockedCount = goals.filter((g) => g.done).length;
  const lastUnlocked = unlockedCount > 0 ? goals[unlockedCount - 1] : null;
  const nextMark = marks[nextIdx];
  const prevMark = nextIdx === 0 ? 0 : marks[nextIdx - 1];
  const progress = Math.max(0, Math.min(100, ((subs - prevMark) / (nextMark - prevMark)) * 100));

  // Ticker
  const tick = live ? data.tickerLive : data.tickerUpcoming;
  const tickerTwice = tick.concat(tick, tick, tick);

  // Vote
  const myVote = isSub ? s.myVote : null;
  const withMine = data.challenges.map((c) => ({ ...c, votes: c.votes + (myVote === c.id ? 1 : 0) }));
  const total = withMine.reduce((a, c) => a + c.votes, 0);
  const maxVotes = Math.max(...withMine.map((c) => c.votes));
  const challenges = withMine.map((c, i) => {
    const mine = myVote === c.id;
    const leading = c.votes === maxVotes;
    return {
      id: c.id, n: i + 1, title: c.title, desc: c.desc, votesText: fmt(c.votes),
      pct: Math.round((c.votes / total) * 100) + '%', leading,
      rowBg: mine ? 'rgba(92,203,255,0.07)' : 'transparent',
      numColor: mine ? 'var(--ice)' : leading ? '#FFFFFF' : '#2A3445',
      bar: mine ? 'var(--ice)' : leading ? '#FFFFFF' : '#4A5568',
      canVote: isSub, locked: !isSub, pressed: bool(mine),
      btnLabel: mine ? 'Votul tău ✓' : myVote ? 'Mută votul aici' : 'Votează',
      btnBg: mine ? 'var(--ice)' : 'transparent',
      btnColor: mine ? '#04101A' : '#F2F5FA',
      btnBorder: mine ? 'var(--ice)' : '#F2F5FA',
    };
  });
  const myTitle = myVote ? data.challenges.find((c) => c.id === myVote)?.title ?? '' : '';
  const voteHint = myVote ? 'Ai votat. Poți muta votul până se închide runda.' : 'Ai 1 vot în runda asta.';
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
  const isLose = res === data.losePrize;
  const flakeCount = data.flakes;
  const flakes = [0, 1, 2].map((i) => ({ color: i < flakeCount ? 'var(--ice)' : '#2A3445' }));
  const spins = s.spins;

  // Toast
  let toastOn = false, toastEyebrow = '', toastText = '', toastColor = '#FFFFFF', toastBorder = '#FFFFFF';
  if (s.toast === 'goal' && live && lastUnlocked) {
    toastOn = true; toastEyebrow = 'Obiectiv deblocat';
    toastText = 'Nr. ' + lastUnlocked.no + ' · ' + lastUnlocked.title;
  } else if (s.toast === 'vote' && myVote) {
    toastOn = true; toastEyebrow = 'Vot înregistrat'; toastText = myTitle;
    toastColor = 'var(--ice)'; toastBorder = 'var(--ice)';
  }

  // Leaderboard
  const tab = s.tab;
  const board = data.boards[tab].map((row, i) => ({
    rank: i + 1, user: row[0], value: live ? row[1] : '0', unit: data.boardUnits[tab],
    rankColor: i === 0 ? '#FFFFFF' : i < 3 ? 'var(--ice)' : '#4A5568',
  }));
  const boardTabs = data.boardTabs.map(([id, label]) => ({
    id, label, sel: tab === id,
    line: tab === id ? 'var(--ice)' : 'transparent',
    color: tab === id ? '#F2F5FA' : '#7D8899',
  }));

  // Bingo
  const marked = s.marked;
  const bingo = data.bingo.map((text, i) => {
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
    dd, hh, mm, ss, navClock: `${dd}:${hh}:${mm}:${ss}`, roundLeft, tickerTwice,
    isLive: live,
    statusText: live ? 'ÎN DIRECT' : 'ÎNCEPE CURÂND',
    liveBg: live ? '#D5162B' : '#2A3445',
    timerLabel: live ? 'Timp rămas' : 'Începe în',
    subsText: fmt(subs),
    nextGoalText: fmt(nextMark),
    nextGoalTitle: data.goalTitles[nextIdx],
    raisedText: live ? data.raisedLive : data.raisedUpcoming,
    progressPct: progress.toFixed(1) + '%',
    progressLabel: fmt(subs) + ' / ' + fmt(nextMark) + ' suburi',
    goals, unlockedCount, board, boardTabs, boardLabelledBy: 'tab-board-' + tab,

    isOut, isNonsub, isSub, isIn: !isOut,
    badgeText: isSub ? 'ABONAT' : 'URMĂRITOR',
    badgeBg: isSub ? 'var(--ice)' : '#1A2230',
    badgeColor: isSub ? '#04101A' : '#AEB8C7',

    challenges, voteHint, voteTabs,
    tabOpen: vt === 'open', tabNext: vt === 'next', tabDone: vt === 'done',

    wheelTransform: `rotate(${s.wheelDeg}deg)`, spinning, flakes,
    flakesLabel: flakeCount + ' din 3 fulgi pentru următoarea rotire',
    spinsText: spins === 1 ? 'Ai 1 rotire' : 'Ai ' + spins + ' rotiri',
    spinLabel: isOut ? 'Conectează-te ca să învârți' : spinning ? 'Se învârte…' : spins > 0 ? 'Învârte roata' : 'Nu mai ai rotiri. Mai stai puțin!',
    spinClass: isOut ? 'btn-twitch' : spins > 0 || spinning ? 'btn-red' : 'btn-ghost',
    hasResult,
    resultTitle: hasResult && res !== null ? (isLose ? 'Data viitoare!' : 'Ai câștigat: ' + data.prizes[res][1]) : '',
    resultNote: isLose ? 'Fulgii tăi se strâng în continuare. Mai încearcă.' : 'Un moderator îți dă premiul pe stream în câteva minute.',

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
