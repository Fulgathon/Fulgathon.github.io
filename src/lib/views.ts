// HTML for the regions that re-render when state changes (lists whose items
// change). Used at build time for the initial HTML and in the browser for
// updates. Markup and inline styles are ported from design/Main.dc.html.
//
// Every value from data goes through esc(): in phase 2 usernames and titles
// come from Twitch and the backend.

import type { Vals } from './derive';

export function esc(v: unknown): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const COND = "'Barlow Condensed', sans-serif";
const LOCK =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" aria-hidden="true"><rect x="5" y="11" width="14" height="10"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>';
const CHECK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="square" aria-hidden="true" style="position: absolute; top: 8px; right: 8px"><path d="M4 12l5 5L20 6"></path></svg>';

function ticker(v: Vals): string {
  return v.tickerTwice
    .map(
      (t) => `<span style="display: inline-flex; align-items: center; gap: 8px; padding: 0 20px; white-space: nowrap; color: #AEB8C7">
<strong style="font-family: ${COND}; font-size: 16px; font-weight: 800; color: ${t.color}">${esc(t.time)}</strong>
<span style="color: #F2F5FA; font-weight: 600">${esc(t.user)}</span>
<span>${esc(t.what)}</span>
<span style="color: #2A3445; padding-left: 12px">/</span>
</span>`,
    )
    .join('');
}

function tabs(
  list: { id: string; label: string; sel: boolean; line: string; color: string }[],
  group: 'vote' | 'board',
  fontSize: string,
  extra: string,
): string {
  return list
    .map(
      (t) => `<button type="button" role="tab" id="tab-${group}-${t.id}" aria-selected="${t.sel}" aria-controls="panel-${group}${group === 'vote' ? '-' + t.id : ''}" tabindex="${t.sel ? 0 : -1}" data-key="tab-${group}-${t.id}" data-action="${group}Tab" data-arg="${t.id}" style="min-height: 48px; padding: 0 2px; margin-bottom: -1px; background: transparent; border: 0; border-bottom: 3px solid ${t.line}; font-family: ${COND}; font-size: ${fontSize}; font-weight: 800; text-transform: uppercase;${extra} color: ${t.color}">${esc(t.label)}</button>`,
    )
    .join('');
}

/** A quiet one-line message for an empty list. */
const emptyRow = (text: string, tag = 'li') =>
  `<${tag} style="padding: 20px 16px; border-bottom: 1px solid #1A2230; font-size: 16px; color: #8C97A8">${esc(text)}</${tag}>`;

function challenges(v: Vals): string {
  if (!v.challenges.length) return emptyRow('Prima rundă de vot se deschide odată cu subathonul.');
  return v.challenges
    .map(
      (c) => `<li style="display: flex; flex-wrap: wrap; align-items: center; gap: 14px 24px; padding: 20px 16px; border-bottom: 1px solid #1A2230; background: ${c.rowBg}">
<span aria-hidden="true" style="flex: none; width: 36px; font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 34px; line-height: 1; color: ${c.numColor}">${c.n}</span>
<div style="flex: 1 1 300px; min-width: 0">
<p style="margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; font-weight: 700; font-size: 18px; color: #F2F5FA">${esc(c.title)}
${c.leading ? `<span style="padding: 1px 8px; transform: skewX(-12deg); background: var(--ice); color: #04101A; font-family: ${COND}; font-size: 13px; font-weight: 800; letter-spacing: 0.06em">PE PRIMUL LOC</span>` : ''}</p>
<p style="margin: 2px 0 0; font-size: 15px; color: #8C97A8">${esc(c.desc)}</p>
<div style="margin-top: 12px; display: flex; align-items: center; gap: 12px">
<div aria-hidden="true" style="flex: 1 1 auto; height: 8px; background: #1A2230"><div style="width: ${c.pct}; height: 100%; background: ${c.bar}"></div></div>
<span style="flex: none; font-size: 14px; color: #8C97A8">${c.votesText} voturi</span>
</div>
</div>
<div style="flex: 0 0 auto; display: flex; align-items: center; gap: 18px">
<span style="font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 38px; line-height: 1; min-width: 64px; text-align: right">${c.pct}</span>
${
  c.canVote
    ? `<button type="button" data-action="vote" data-arg="${esc(c.id)}" data-key="vote-${esc(c.id)}" aria-pressed="${c.pressed}" aria-label="${esc(c.btnLabel)}: ${esc(c.title)}" style="min-height: 48px; min-width: 150px; padding: 0 16px; font-family: ${COND}; font-weight: 800; font-size: 18px; text-transform: uppercase; background: ${c.btnBg}; color: ${c.btnColor}; border: 2px solid ${c.btnBorder}">${esc(c.btnLabel)}</button>`
    : `<span style="min-height: 48px; min-width: 150px; padding: 0 14px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 2px dashed #2A3445; color: #7D8899; font-family: ${COND}; font-weight: 700; font-size: 17px; text-transform: uppercase">
${LOCK}
${esc(c.lockText)}
</span>`
}
</div>
</li>`,
    )
    .join('');
}

function goals(v: Vals): string {
  return v.goals
    .map(
      (g) => `<div style="display: flex; align-items: center; gap: 18px; padding: 18px 0; border-bottom: 1px solid #1A2230">
<span style="flex: none; width: 46px; font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 34px; line-height: 1; color: ${g.numColor}">${g.no}</span>
<div style="flex: 1 1 auto; min-width: 0">
<p style="margin: 0; font-weight: 700; font-size: 17px; color: ${g.titleColor}; text-decoration: ${g.deco}; text-decoration-color: var(--ice); text-decoration-thickness: 2px">${esc(g.title)}</p>
<p style="margin: 0; font-size: 14px; color: #7D8899">${g.threshold} strânși</p>
${
  g.current
    ? `<div style="margin-top: 8px; display: flex; align-items: center; gap: 10px">
<div aria-hidden="true" style="flex: 1 1 auto; height: 8px; background: #1A2230"><div class="cane" style="width: ${g.pct}; height: 100%"></div></div>
<span style="flex: none; font-size: 13px; font-weight: 700">${g.pct}</span>
</div>`
    : ''
}
</div>
${g.done ? '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="flex: none; color: var(--ice)" stroke-width="3" stroke-linecap="square" aria-label="Deblocat" role="img"><path d="M4 12l5 5L20 6"></path></svg>' : ''}
${g.current ? `<span style="flex: none; padding: 1px 8px; transform: skewX(-12deg); background: var(--ice); color: #04101A; font-family: ${COND}; font-size: 14px; font-weight: 800; letter-spacing: 0.06em">URMEAZĂ</span>` : ''}
${g.locked ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A5568" stroke-width="2.4" stroke-linecap="square" aria-label="Blocat" role="img" style="flex: none"><rect x="5" y="11" width="14" height="10"></rect><path d="M8 11V7a4 4 0 0 1 8 0v4"></path></svg>' : ''}
</div>`,
    )
    .join('');
}

function flakes(v: Vals): string {
  return v.flakes
    .map(
      (f) =>
        `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="color: ${f.color}" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9 4l3 2 3-2M9 20l3-2 3 2"></path></svg>`,
    )
    .join('');
}

function board(v: Vals): string {
  if (v.boardEmpty) return emptyRow('Încă nu e nimeni în clasament.');
  return v.board
    .map(
      (row) => `<li style="display: flex; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid #1A2230">
<span style="flex: none; width: 32px; font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 28px; line-height: 1; color: ${row.rankColor}">${row.rank}</span>
<span style="flex: 1 1 auto; min-width: 0; font-weight: 600; font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">${esc(row.user)}</span>
<span style="flex: none; font-family: ${COND}; font-weight: 800; font-size: 24px">${esc(row.value)}</span>
<span style="flex: none; width: 52px; font-size: 14px; color: #7D8899">${esc(row.unit)}</span>
</li>`,
    )
    .join('');
}

function bingo(v: Vals): string {
  return v.bingo
    .map(
      (b) => `<button type="button" class="cell" aria-pressed="${b.pressed}"${b.disabled ? ' aria-disabled="true"' : ''} data-action="bingo" data-arg="${b.id}" data-key="bingo-${b.id}" style="position: relative; min-height: 76px; padding: 10px; text-align: left; display: flex; align-items: flex-end; font-size: 14px; font-weight: 600; line-height: 1.25; background: ${b.bg}; color: ${b.color}; border: 2px solid ${b.border}${b.disabled && !b.on ? '; cursor: default' : ''}">
${b.hit ? CHECK : ''}
${esc(b.text)}
</button>`,
    )
    .join('');
}

function pops(v: Vals): string {
  return v.pops
    .map((pp) => `<span class="pop" style="left: ${pp.left}; animation-delay: ${pp.delay}; border-color: ${pp.color}"><span style="color: ${pp.color}">${esc(pp.time)}</span> ${esc(pp.user)}</span>`)
    .join('');
}

function upNext(v: Vals): string {
  if (!v.upNext.length) return emptyRow('Încă nu a câștigat nicio provocare.');
  return v.upNext
    .map(
      (u) => `<li style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 20px 16px; border-bottom: 1px solid #1A2230">
<span style="flex: none; width: 36px; font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 34px; line-height: 1; color: var(--ice)">${u.n}</span>
<span style="flex: 1 1 260px; min-width: 0">
<span style="display: block; font-weight: 700; font-size: 18px">${esc(u.title)}</span>
<span style="display: block; font-size: 15px; color: #8C97A8">A câștigat runda ${u.round} cu ${esc(u.pct)} din voturi</span>
</span>
<span style="flex: none; font-family: ${COND}; font-weight: 800; font-size: 22px; text-transform: uppercase">${esc(u.when)}</span>
</li>`,
    )
    .join('');
}

function completed(v: Vals): string {
  if (!v.completed.length) return emptyRow('Încă nu s-a făcut nicio provocare.');
  return v.completed
    .map(
      (d) => `<li style="display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding: 20px 16px; border-bottom: 1px solid #1A2230">
<span style="flex: none; padding: 1px 8px; transform: skewX(-12deg); background: #1A2230; color: #AEB8C7; font-family: ${COND}; font-weight: 800; font-size: 14px; letter-spacing: 0.06em">${esc(d.when)}</span>
<span style="flex: 1 1 240px; min-width: 0; font-weight: 700; font-size: 18px; text-decoration: line-through; text-decoration-color: var(--ice); text-decoration-thickness: 2px">${esc(d.title)}</span>
${d.clip ? `<a href="${esc(d.clip)}" aria-label="Vezi clipul: ${esc(d.title)}" style="flex: none; min-height: 44px; display: inline-flex; align-items: center; gap: 8px; font-family: ${COND}; font-weight: 800; font-size: 18px; text-transform: uppercase; text-decoration: none">Vezi clipul →</a>` : ''}
</li>`,
    )
    .join('');
}

function wheelPrizes(v: Vals): string {
  return v.prizes
    .map(
      (p) => `<div style="position: absolute; left: 50%; top: 50%; width: 50%; height: 0; transform-origin: 0 0; transform: ${p.rot}; display: flex; align-items: center; justify-content: flex-end; padding-right: 8%">
<span style="transform: translateY(-50%); font-family: ${COND}; font-weight: 800; font-style: italic; font-size: 4.6cqi; letter-spacing: 0.02em; text-transform: uppercase; white-space: nowrap; color: ${p.color}">${esc(p.short)}</span>
</div>`,
    )
    .join('');
}

function recentWins(v: Vals): string {
  if (!v.recentWins.length) return emptyRow('Încă nu s-a învârtit roata.');
  return v.recentWins
    .map(
      (w) => `<li style="display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid #1A2230">
<span style="flex: 1 1 auto; min-width: 0"><strong style="color: #F2F5FA">${esc(w.user)}</strong> <span style="color: #8C97A8">a câștigat</span> ${esc(w.prize)}</span>
<span style="flex: none; color: #7D8899">${esc(w.ago)}</span>
</li>`,
    )
    .join('');
}

export const views = {
  ticker,
  voteTabs: (v: Vals) => tabs(v.voteTabs, 'vote', '20px', ' letter-spacing: 0.03em;'),
  challenges,
  goals,
  flakes,
  boardTabs: (v: Vals) => tabs(v.boardTabs, 'board', '18px', ''),
  board,
  bingo,
  pops,
  upNext,
  completed,
  wheelPrizes,
  recentWins,
};

export type RegionName = keyof typeof views;
