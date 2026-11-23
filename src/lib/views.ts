// HTML for the regions that re-render when state changes (lists whose items
// change). Used at build time for the initial HTML and in the browser for
// updates. Markup and inline styles are ported from design/Main.dc.html.
//
// Every value from data goes through esc(): in phase 2 usernames and titles
// come from Twitch and the backend.

import type { Vals } from './derive';
import { safeUrl } from './format';
import { badgeDefs, badgeIcons, PRISM, rankColors, tierColors } from '../data/content';

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
<div aria-hidden="true" style="flex: 1 1 auto; height: 8px; background: #1A2230"><div class="fill" style="width: ${c.pct}; height: 100%; background: ${c.bar}"></div></div>
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
<p style="margin: 0; font-size: 14px; color: #7D8899">${g.threshold} strânși${g.sponsor ? ` · <span style="color: #AEB8C7">prezentat de <strong style="color: #F2F5FA">${esc(g.sponsor)}</strong></span>` : ''}</p>
${
  g.current
    ? `<div style="margin-top: 8px; display: flex; align-items: center; gap: 10px">
<div aria-hidden="true" style="flex: 1 1 auto; height: 8px; background: #1A2230"><div class="cane fill" style="width: ${g.pct}; height: 100%"></div></div>
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

/** 5×5 card with line buttons on the edges: ↘ and ↓×5 on top, → per row, ↗ under the rows. */
function bingo(v: Vals): string {
  const L = v.bingoLines;
  const btn = (n: number) => {
    const l = L[n];
    return l ? `<button type="button" class="bl${l.on ? ' on' : ''}" aria-pressed="${l.pressed}" aria-label="${esc(l.aria)}" data-action="bingoLine" data-arg="${l.n}" data-key="bl-${l.n}"${l.disabled ? ' disabled' : ''}>${l.arrow}</button>` : '<span></span>';
  };
  const tile = (b: Vals['bingo'][number]) => `<div class="bt" style="background: ${b.bg}; color: ${b.color}; border-color: ${b.border}">${b.hit ? CHECK : ''}${esc(b.text)}</div>`;
  let html = btn(10) + [5, 6, 7, 8, 9].map(btn).join('');
  for (let r = 0; r < 5; r++) html += btn(r) + v.bingo.slice(r * 5, r * 5 + 5).map(tile).join('');
  return html + btn(11);
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
${safeUrl(d.clip) ? `<a href="${esc(safeUrl(d.clip))}" aria-label="Vezi clipul: ${esc(d.title)}" style="flex: none; min-height: 44px; display: inline-flex; align-items: center; gap: 8px; font-family: ${COND}; font-weight: 800; font-size: 18px; text-transform: uppercase; text-decoration: none">Vezi clipul →</a>` : ''}
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
<span style="flex: 1 1 auto; min-width: 0"><strong style="color: #F2F5FA">${esc(w.user)}</strong> <span style="color: #8C97A8">a câștigat</span> ${esc(w.prize)}${w.sponsor ? ` <span style="color: #8C97A8">de la</span> <strong style="color: var(--ice)">${esc(w.sponsor)}</strong>` : ''}</span>
<span style="flex: none; color: #7D8899">${esc(w.ago)}</span>
</li>`,
    )
    .join('');
}

// ---- Comunitatea ----------------------------------------------------------

const badge = (label: string) =>
  `<span style="display: inline-block; padding: 1px 8px; border: 1px solid #2A3445; font-family: ${COND}; font-weight: 800; font-size: 13px; letter-spacing: 0.06em; text-transform: uppercase; color: #C9D2DF; white-space: nowrap">${esc(label)}</span>`;

/** One legend column: #1 as a premium card, #2–5 as rows. */




function together(v: Vals): string {
  return v.togetherGoals
    .map((g) => `<li style="display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #1A2230">
<span style="flex: none; width: 64px; font-family: ${COND}; font-weight: 800; font-size: 18px; color: ${g.done ? 'var(--ice)' : g.current ? '#FFFFFF' : '#4A5568'}">${esc(g.hours)}</span>
<span style="flex: 1 1 auto; min-width: 0; font-weight: 600; color: ${g.done ? '#8C97A8' : '#F2F5FA'}; text-decoration: ${g.done ? 'line-through' : 'none'}; text-decoration-color: var(--ice)">${esc(g.title)}</span>
${g.done ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="flex: none; color: var(--ice)" stroke-width="3" stroke-linecap="square" aria-label="Deblocat" role="img"><path d="M4 12l5 5L20 6"></path></svg>' : g.current ? `<span style="flex: none; padding: 1px 8px; transform: skewX(-12deg); background: var(--ice); color: #04101A; font-family: ${COND}; font-size: 13px; font-weight: 800; letter-spacing: 0.06em">URMEAZĂ</span>` : ''}
</li>`)
    .join('');
}

function mine(v: Vals): string {
  return v.mineStats
    .map((m) => `<div style="padding: 4px 18px; border-left: 2px solid #2A3445">
<p style="margin: 0; font-family: ${COND}; font-weight: 900; font-style: italic; font-size: 30px; line-height: 1.05">${esc(m.value)}</p>
<p style="margin: 2px 0 0; font-size: 14px; color: #8C97A8">${esc(m.label)}</p>
</div>`)
    .join('') + (v.mineBadges.length ? `<div style="flex: 1 0 100%; display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 18px 0">${v.mineBadges.map(badge).join('')}</div>` : '');
}


// ---- Layout v2 --------------------------------------------------------------


/** «INTRĂ ACUM»: the newest 4 events, the newest one sliding in. */
function heroRecent(v: Vals): string {
  if (!v.hasHeroRecent) return `<p class="hero-empty">Aici apar, pe loc, subs, gift-urile și donațiile.</p>`;
  return v.heroRecent.map((e) => `<div class="ev${e.fresh ? ' ev-in' : ''}" style="background: ${e.bg}; border-color: ${e.border}; opacity: ${e.op}">
<strong>${esc(e.time)}</strong><span><strong>${esc(e.user)}</strong> <span style="color: #AEB8C7">${esc(e.what)}</span></span></div>`).join('');
}

/** «Ce poți face acum»: one tile per thing the viewer can do now (links to the section, or the login button). */
function nextRow(v: Vals): string {
  return v.nextTiles.map((t) => {
    const inner = `<b>${esc(t.title)}</b><span>${esc(t.text)}</span>`;
    return t.action
      ? `<button type="button" class="nr-tile nr-login" data-action="${esc(t.action)}" data-key="nr-${esc(t.key)}">${inner}</button>`
      : `<a class="nr-tile" href="${esc(t.href)}" data-key="nr-${esc(t.key)}">${inner}</a>`;
  }).join('');
}

function calcOpts(v: Vals): string {
  return v.calcOpts.map((o) => `<button type="button" class="calc${o.on ? ' on' : ''}" role="radio" aria-checked="${o.on}" tabindex="${o.on ? 0 : -1}" data-action="calcPick" data-arg="${o.i}" data-key="calc-${o.i}">${esc(o.label)}</button>`).join('');
}

type BadgeDef = (typeof badgeDefs)[number];
const isPrism = (b: BadgeDef) => b.tier === 'prism';
/** Hexagon emblem; locked ones are grey. */
function hexagon(b: BadgeDef, size: number, earned: boolean): string {
  const [accent, tint] = tierColors[b.tier];
  const stroke = !earned ? '#2A3445' : isPrism(b) ? 'url(#g-prism)' : accent;
  const fill = !earned ? '#0B1018' : isPrism(b) ? 'url(#g-prism-fill)' : tint;
  const icon = !earned ? '#4A5568' : stroke;
  return `<svg width="${size}" height="${size}" viewBox="0 0 56 56" aria-hidden="true" class="hex${earned && isPrism(b) ? ' hex-prism' : ''}"><polygon points="28,2 51,15 51,41 28,54 5,41 5,15" fill="${fill}" stroke="${stroke}" stroke-width="2"></polygon><polygon points="28,8 46,18.5 46,37.5 28,48 10,37.5 10,18.5" fill="none" stroke="${stroke}" stroke-opacity="0.4" stroke-width="1"></polygon><g transform="translate(16 16)"><path d="${badgeIcons[b.icon]}" fill="none" stroke="${icon}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></g></svg>`;
}
/** The tooltip: name, «Cum o obții:», how many have it. */
function tooltip(b: BadgeDef, id: string, extra: string, who: string): string {
  const [accent, , fg] = tierColors[b.tier];
  const name = isPrism(b) ? `<span class="prism-text">${esc(b.label.toUpperCase())}</span>` : esc(b.label.toUpperCase());
  return `<span role="tooltip" id="${id}" class="tip" style="border-color: ${accent}"><span class="tip-name" style="color: ${fg}">${name}${extra ? ` <span class="tip-extra">${esc(extra)}</span>` : ''}</span><span class="tip-how"><strong>Cum o obții:</strong> ${esc(b.how)}</span>${who ? `<span class="tip-who">${esc(who)}</span>` : ''}<span class="tip-arrow" style="border-color: ${accent}"></span></span>`;
}
/** Slanted tag with an icon block, for lists. */
function badgeTag(id: string, key: string, who = ''): string {
  const b = badgeDefs.find((x) => x.id === id);
  if (!b) return '';
  const [accent, tint, fg] = tierColors[b.tier];
  const block = isPrism(b) ? PRISM : accent;
  const label = isPrism(b) ? `<span class="prism-text">${esc(b.label.toUpperCase())}</span>` : esc(b.label.toUpperCase());
  const tid = `tip-${key}`;
  return `<button type="button" class="bdg-tag" aria-describedby="${tid}" data-key="${key}"><span class="tag" style="border-color: ${accent}; background: ${tint}"><span class="tag-icon" style="background: ${block}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#04101A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${badgeIcons[b.icon]}"></path></svg></span><span class="tag-label" style="color: ${fg}">${label}</span></span>${tooltip(b, tid, '', who)}</button>`;
}

/** «Insignele tale»: six hexagons, earned or grey with progress. */
function myBadges(v: Vals): string {
  return v.myBadges.map((b) => {
    const [, , fg] = tierColors[b.tier];
    const tid = `tip-my-${b.id}`;
    const label = b.earned && isPrism(b) ? `<span class="prism-text">${esc(b.label.toUpperCase())}</span>` : esc(b.label.toUpperCase());
    return `<button type="button" class="bdg${b.open ? ' open' : ''}" aria-describedby="${tid}" aria-expanded="${b.open}" data-action="badgeTip" data-arg="${b.id}" data-key="bdg-${b.id}">
${tooltip(b, tid, b.earned ? '' : b.note, b.who)}${hexagon(b, 56, b.earned)}
<span class="bdg-label" style="color: ${b.earned ? fg : '#7D8899'}">${label}</span><span class="bdg-note">${esc(b.note)}</span></button>`;
  }).join('');
}

const rankStyle = (i: number) => {
  const c = rankColors[Math.min(i, rankColors.length - 1)];
  return c === 'prism' ? `background: ${PRISM}; -webkit-background-clip: text; background-clip: text; color: transparent` : `color: ${c}`;
};
const ICONS = {
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z"></path>',
  gift: '<rect x="3" y="9" width="18" height="12"></rect><path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9zM12 9c2-4 6-4 6-1.5S14 9 12 9z"></path>',
  flake: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9 4l3 2 3-2M9 20l3-2 3 2"></path>',
};
const icon = (k: keyof typeof ICONS, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#3FD0FF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;

/** Legende: three equal panels; #1 is the prism card, 2/3/4 gold/silver/bronze, 5 grey. */
function legendPanel(title: string, ic: keyof typeof ICONS, rows: Vals['legendsDon'], unit: string, empty: string): string {
  const head = `<p class="lg-head">${icon(ic)}${esc(title)}</p>`;
  const [first, ...rest] = rows;
  if (!first) return `<div class="panel lg">${head}<div class="lg-empty">${esc(empty)}</div></div>`;
  const tot = (r: Vals['legendsDon'][number]) => `${esc(r.total)}${unit ? ' ' + esc(unit) : ''}`;
  return `<div class="panel lg">${head}
<div class="prism-card"><span class="prism-tag">PRISMĂ · LOCUL 1</span>
<div class="prism-row"><span class="prism-name">${esc(first.name)}</span><span class="prism-total prism-text">${tot(first)}</span></div></div>
<ol start="2" class="lg-rest">${rest.map((r, i) => `<li><span class="rk" style="${rankStyle(i + 1)}">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="tt">${esc(r.total)}${unit === '€' ? ' €' : ''}</span></li>`).join('')}</ol>
<p class="lg-compact">${rest.map((r, i) => `<strong style="${rankStyle(i + 1)}">${r.rank}</strong> ${esc(r.name)}`).join(' · ')}</p>
</div>`;
}
function legends(v: Vals): string {
  return [
    legendPanel('Donatori', 'star', v.legendsDon, '€', 'Locul 1 e liber. Prima donație face o legendă.'),
    legendPanel('Subs dăruite', 'gift', v.legendsGifts, 'subs', 'Locul 1 e liber. Primul gift face o legendă.'),
    legendPanel('Biți', 'flake', v.legendsBits, '', 'Locul 1 e liber. Primii biți fac o legendă.'),
  ].join('');
}

function todayFeed(v: Vals): string {
  if (!v.hasRecent) return emptyRow('Aici apare, pe loc, fiecare sub, gift, donație și bit de azi.');
  return v.recentFeed.map((t, i) => `<li class="${i >= 3 ? 'more-row' : ''}"><strong class="ft">${esc(t.time)}</strong><span class="fw"><strong>${esc(t.user)}</strong> <span style="color: #AEB8C7">${esc(t.what)}</span></span><span class="fa">${esc(t.agoText)}</span></li>`).join('');
}

function loyal(v: Vals): string {
  if (!v.hasLoyal) return emptyRow('Primii fideli apar după prima oră în chat. Se numără singur, cât ești pe stream.');
  return v.loyalRows.map((r, i) => `<li class="${i >= 3 ? 'more-row' : ''}">
<div class="ly-row"><span class="rk" style="${rankStyle(i)}">${r.rank}</span><span class="nm">${esc(r.name)}</span><span class="tt">${esc(r.hours)}</span></div>
${r.streakText || r.badgeIds.length ? `<div class="ly-badges">${r.streakText ? `<span class="streak">${esc(r.streakText)}</span>` : ''}${r.badgeIds.map((b) => badgeTag(b, `ly-${i}-${b}`, r.who[b] ?? '')).join('')}</div>` : ''}
</li>`).join('');
}

/** Milestone track: numbered steps (done ✓ CLIP, unlocked URMEAZĂ LIVE, next URMĂTORUL, rest grey). */
function track(v: Vals): string {
  const st = {
    done: ['var(--ice)', 'var(--ice)', '#04101A', 'none', '#C9D2DF', 'CLIP', 'var(--ice)'],
    unlocked: ['#F2F5FA', '#F2F5FA', '#04101A', 'none', '#F2F5FA', 'URMEAZĂ LIVE', '#F2F5FA'],
    next: ['#0B1018', 'var(--ice)', 'var(--ice)', '0 0 18px rgba(63,208,255,0.5)', 'var(--ice)', 'URMĂTORUL', 'var(--ice)'],
    rest: ['#080B10', '#2A3445', '#7D8899', 'none', '#8C97A8', '', '#8C97A8'],
  } as const;
  return v.track.map((m) => {
    const [bg, border, fg, glow, amt, tag, tagColor] = st[m.state as keyof typeof st];
    const label = `${m.no} · ${m.title}${m.state === 'done' ? ' · făcut' : m.state === 'unlocked' ? ' · deblocat' : m.state === 'next' ? ' · următorul' : ''}`;
    const inner = `<span class="ms-mark" style="background: ${bg}; border-color: ${border}; color: ${fg}; box-shadow: ${glow}">${m.state === 'done' ? '✓' : m.no}</span>
<span class="ms-amt" style="color: ${amt}">${esc(m.amount)}</span><span class="ms-tag" style="color: ${tagColor}">${tag}</span>
<span class="ms-name" role="tooltip">${esc(m.title)}</span>`;
    return m.state === 'done' && m.clip
      ? `<a class="ms" href="${esc(safeUrl(m.clip) ?? '#')}" aria-label="${esc(label)}, vezi clipul">${inner}</a>`
      : `<span class="ms" tabindex="0" aria-label="${esc(label)}">${inner}</span>`;
  }).join('');
}

function segs(v: Vals): string {
  return v.segs.map((g) => `<span style="height: 8px; background: ${g.bg}"></span>`).join('');
}

const PLAY = '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" fill="#3FD0FF"></path></svg>';
function clips(v: Vals): string {
  if (!v.hasClips) return `<p class="clip-empty">Când o provocare se face live, clipul ei apare aici.</p>`;
  return v.clips.map((c) => `<a class="clip" href="${esc(safeUrl(c.clip) ?? '#')}" aria-label="Vezi clipul: ${esc(c.no)} ${esc(c.title)}">
<span class="thumb"><span class="thumb-no">✓ ${esc(c.no)}</span><span class="play">${PLAY}</span></span>
<span class="clip-text"><span class="clip-title"><span class="clip-no">${esc(c.no)}</span>${esc(c.title)}</span><span class="clip-when">${esc([c.when, `deblocat la ${c.amount}`].filter(Boolean).join(' · '))}</span></span>
<span class="clip-cta">Vezi clipul →</span></a>`).join('');
}

/** Phone: the full milestone list behind «Toate cele 12». */
function allGoals(v: Vals): string {
  const tag = { done: 'FĂCUT', unlocked: 'URMEAZĂ LIVE', next: 'URMĂTORUL', rest: '' } as Record<string, string>;
  return v.track.map((m) => `<li><span class="ag-no" style="color: ${m.state === 'rest' ? '#6B7689' : 'var(--ice)'}">${m.no}</span><span class="ag-t">${esc(m.title)}</span><span class="ag-a">${esc(m.amount)}</span>${tag[m.state] ? `<span class="ag-tag">${tag[m.state]}</span>` : ''}</li>`).join('');
}

/** The wheel as SVG: N slices, partner slices in gold, labels along the radius. */
function wheelSvg(v: Vals): string {
  const n = Math.max(1, v.slices.length);
  const seg = 360 / n;
  const R = 200, C = 210;
  const pt = (deg: number) => { const a = (deg * Math.PI) / 180; return `${(C + R * Math.cos(a)).toFixed(1)} ${(C + R * Math.sin(a)).toFixed(1)}`; };
  const size = n > 10 ? 15 : n > 8 ? 17 : 19;
  const paths = v.slices.map((sl, i) => {
    const mid = -90 + i * seg;
    const a0 = mid - seg / 2, a1 = mid + seg / 2;
    const fill = sl.sponsor ? '#16304A' : i % 2 ? '#0B1622' : '#0E1A28';
    return `<path d="M${C} ${C} L${pt(a0)} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${pt(a1)} Z" fill="${fill}" stroke="#23415E" stroke-width="1.5"></path><text transform="translate(${C} ${C}) rotate(${mid.toFixed(2)}) translate(188 5)" text-anchor="end" fill="${sl.sponsor ? '#E6C46A' : '#F2F5FA'}" font-family="Barlow Condensed, sans-serif" font-weight="800" font-style="italic" font-size="${size}">${esc(sl.label)}</text>`;
  }).join('');
  return `<svg viewBox="-10 -10 440 440" aria-hidden="true" style="display: block; width: 100%; height: auto">${paths}<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#3FD0FF" stroke-width="3"></circle><circle cx="${C}" cy="${C}" r="50" fill="#050608" stroke="#3FD0FF" stroke-width="3"></circle></svg>`;
}

function prizeGroups(v: Vals): string {
  return v.prizeGroups.map((p) => `<div class="pg"><p class="pg-head"><span style="color: ${p.color}">${esc(p.name)}</span><span class="pg-n">${p.count}</span></p><p class="pg-items">${esc(p.items)}</p></div>`).join('');
}

/** Vote: one row per option; a subscriber taps the row to vote or move the vote. */
function voteOptions(v: Vals): string {
  if (!v.challenges.length) return emptyRow('Prima rundă de vot se deschide odată cu subathonul.', 'p');
  return v.challenges.map((c) => {
    const body = `<span class="vo-top"><span class="vo-t">${esc(c.title)}${c.pressed === 'true' ? ' <span class="vo-mine">VOTUL TĂU</span>' : ''}</span><span class="vo-p">${c.pct}</span></span><span class="vo-bar" aria-hidden="true"><span style="width: ${c.pct}; background: ${c.pressed === 'true' ? 'var(--ice)' : c.leading ? '#FFFFFF' : '#3FD0FF'}"></span></span>`;
    return c.canVote
      ? `<button type="button" class="vo vo-btn" data-action="vote" data-arg="${esc(c.id)}" data-key="vote-${esc(c.id)}" aria-pressed="${c.pressed}" aria-label="${esc(c.btnLabel)}: ${esc(c.title)}, ${c.pct}">${body}</button>`
      : `<div class="vo">${body}</div>`;
  }).join('');
}

/** Bingo, full width: arrows for rows, columns, diagonals; ✓ S-A ÎNTÂMPLAT on squares that happened. */
function bingo2(v: Vals): string {
  const L = v.bingoLines;
  const btn = (n: number) => {
    const l = L[n];
    return l ? `<button type="button" class="bl${l.on ? ' on' : ''}" aria-pressed="${l.pressed}" aria-label="${esc(l.aria)}" data-action="bingoLine" data-arg="${l.n}" data-key="bl-${l.n}"${l.disabled ? ' disabled' : ''}>${l.arrow}</button>` : '<span></span>';
  };
  const tile = (b: Vals['bingo2'][number]) => `<div class="bt2 ${b.cls}">${b.hit ? `<span class="hit">✓<span class="hit-l"> S-A ÎNTÂMPLAT</span></span>` : ''}${esc(b.text)}</div>`;
  let html = btn(10) + [5, 6, 7, 8, 9].map(btn).join('');
  for (let r = 0; r < 5; r++) html += btn(r) + v.bingo2.slice(r * 5, r * 5 + 5).map(tile).join('');
  return html + btn(11);
}
function myLine(v: Vals): string {
  return v.myLine.map((l) => `<li><span class="${l.hit ? 'ml-hit' : 'ml-miss'}" aria-hidden="true">${l.hit ? '✓' : '·'}</span>${esc(l.text)}${l.hit ? '<span class="sr-only"> (s-a întâmplat)</span>' : ''}</li>`).join('');
}
function lineBar(v: Vals): string {
  return v.myLine.map((l) => `<span style="height: 6px; background: ${l.hit ? 'var(--ice)' : '#1A2230'}"></span>`).join('');
}

const FLAKE16 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A5568" stroke-width="2" stroke-linecap="round" aria-hidden="true" class="ad-flake"><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10M9 4l3 2 3-2M9 20l3-2 3 2"></path></svg>';
const TREE16 = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A5568" stroke-width="2" stroke-linejoin="round" aria-hidden="true" class="ad-flake"><path d="M12 2l5 7h-3l4 6h-4l3 5H7l3-5H6l4-6H7z"></path><path d="M12 20v2"></path></svg>';
/** Advent calendar: past = open with the clip, today = lit, future = closed with what's scheduled. */
function advent(v: Vals): string {
  const from = v.adventFrom;
  return v.advent.map((d, i) => {
    const near = i >= from && i < from + 8 ? '' : ' far';
    if (d.today) return `<div class="ad ad-today${near}" aria-current="date"><span class="ad-azi">AZI · ${esc(d.date)}</span><span class="ad-n" style="color: #FFFFFF">${d.n}</span><span class="ad-t" style="color: #F2F5FA">${esc(d.note || 'Live azi')}</span></div>`;
    if (d.past) {
      const inner = `<span class="ad-d">${esc(d.date)}</span><span class="ad-n" style="color: var(--ice)">${d.n}</span><span class="ad-t" style="color: #C9D2DF">${d.clip ? `${PLAY}${esc(d.note ? d.note + ' · clip' : 'Clipul zilei')}` : esc(d.note || 'Ziua s-a încheiat')}</span>`;
      return safeUrl(d.clip) ? `<a class="ad ad-past${near}" href="${esc(safeUrl(d.clip))}" aria-label="Ziua ${d.n}, ${esc(d.date)}: vezi clipul">${inner}</a>` : `<div class="ad ad-past${near}">${inner}</div>`;
    }
    return `<div class="ad ad-future${near}">${d.holiday ? TREE16 : FLAKE16}<span class="ad-d">${esc(d.date)}</span><span class="ad-n" style="color: #6B7689">${d.n}</span><span class="ad-t" style="color: #AEB8C7">${esc(d.note)}</span></div>`;
  }).join('');
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
  legends,
  todayFeed,
  loyal,
  together,
  mine,
  heroRecent,
  nextRow,
  calcOpts,
  myBadges,
  track,
  segs,
  clips,
  allGoals,
  wheelSvg,
  prizeGroups,
  voteOptions,
  bingo2,
  myLine,
  lineBar,
  advent,
};

export type RegionName = keyof typeof views;
