// OBS overlay, layout v2 (design/layout-v2/Overlay.dc.html): a full 1920×1080
// scene with the living timer (bottom left), the next milestone (bottom right),
// hours watched together (top left), Iceman's bubble (top right) and a quiet
// partner line, plus the moments, one at a time:
//   timer jump / frost / Ora dublă ×2 · VISCOL (gift waves) · milestone unlocked ·
//   new legend (prism for #1, gold/silver/bronze for 2–4) · big badge (50 h / 100 h) ·
//   bingo live · vote live + winner · the wheel when someone spins on the site ·
//   the secret code (calm, needs ?key=…) · ?scene=brb, the pause scene.
//
// Same data as the site (Live + derive). ?calm=1 (or reduced motion): no snow,
// no jumps or sweeps; moments simply appear and go. Sponsors never flash.

import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData, TickerItem } from '../data/types';
import { badgeDefs, badgeIcons, overlayPieces, PRISM } from '../data/content';
import { tickerItem } from '../lib/events';
import { derive, initialState } from '../lib/derive';
import { LineBag, fillLine, groupFor, varsFor } from '../lib/lines';
import { FALLBACK_LINE } from '../data/content';
import { count, fmtInt } from '../lib/format';

const params = new URLSearchParams(location.search);
const calm = params.has('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const brb = params.get('scene') === 'brb';
// ?part=timer: one piece per OBS Browser Source. Only that panel, at the source's top-left
// corner, so Iceman places and sizes each piece per scene (every game has its own layout).
// ?frame=1 outlines the piece and keeps it visible, for placing it in OBS.
const partParam = params.get('part') ?? '';
const piece = overlayPieces.some((p) => p.id === partParam) ? partParam : null;
// 'speech' is the same bubble without the drawn Iceman, to sit beside his head on the camera
// (&tail=right points the tail to the right).
const show = new Set(piece ? [piece === 'speech' ? 'bubble' : piece] : (params.get('show') ?? 'timer,goal,together,bubble,moments,vote,promo,code').split(','));
if (piece) document.body.classList.add('piece', `piece-${piece}`);
if (piece === 'speech' && params.get('tail') === 'right') document.body.classList.add('tail-right');
if (params.has('frame')) document.body.classList.add('frame');
const scale = Math.min(2, Math.max(0.5, Number(params.get('scale')) || 1));
const overlayKey = params.get('key');
const promoMinutes = params.has('promo') ? Math.max(0, Number(params.get('promo')) || 0) : 10;
const codeSecs = Math.min(600, Math.max(10, Number(params.get('codeSecs')) || 60));

document.body.classList.toggle('calm', calm);
document.documentElement.style.setProperty('--scale', String(scale));
const sceneEl = document.getElementById(brb ? 'brb' : 'scene')!;
sceneEl.hidden = false;
document.getElementById('compact')!.hidden = true;
document.querySelectorAll<HTMLElement>('[data-part]').forEach((el) => { if (sceneEl.contains(el)) el.hidden = !show.has(el.dataset.part!); });

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => sceneEl.querySelector<T>(sel)!;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const setText = (el: HTMLElement | null, t: string) => { if (el && el.textContent !== t) el.textContent = t; };
const restart = (el: HTMLElement, cls: string) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let data: SiteData = emptyData();
const announced = new Set<number>();

// ---- Base layout, every second -------------------------------------------------
function draw() {
  const v = derive({ ...initialState(), now: Date.now() }, data);
  if (brb) return drawBrb(v);
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) setText(sceneEl.querySelector(`[data-u="${k}"]`), v[k]);
  setText($('[data-tlabel]'), v.timerLabelUp);
  const timer = $('.ov-timer');
  timer.classList.toggle('frost', v.isFrozen);
  timer.classList.toggle('dbl', v.doubleNow && !v.isFrozen);
  const state = $('[data-tstate]');
  const st = v.isFrozen ? `ÎNGHEȚAT ${v.frozenText.split('.')[0].replace('până pe', 'PÂNĂ PE').toUpperCase()}`
    : v.doubleNow ? `ORA DUBLĂ ×2${v.doubleSponsor ? ` · ${v.doubleSponsor.toUpperCase()}` : ''}` : '';
  state.hidden = !st;
  setText(state, st);
  // Next milestone
  setText($('[data-mtag]'), v.allGoalsDone ? 'TOATE MILESTONE-URILE' : 'URMĂTORUL MILESTONE');
  setText($('[data-mleft]'), v.nextLeft.toUpperCase());
  setText($('[data-mtitle]'), v.hasNextGoal ? v.nextNoTitle : 'Deblocate!');
  setText($('[data-mof]'), v.nextOf);
  $('[data-mbar]').style.width = v.nextBar;
  // Together
  setText($('[data-hours]'), v.togetherHours.replace(' h', ''));
  setText($('[data-hof]'), v.togetherOf ? `/ ${v.togetherOf.replace('din ', '')}` : '');
  setText($('[data-today]'), v.todayBig);
  drawVote(v);
  // Vote: announce the winner once, right after the round closes (it can close without any data change).
  const r = data.round;
  if (r && r.closesAt <= Date.now() && r.closesAt > Date.now() - 30_000 && !announced.has(r.id)) announceWinner(data);
}

// ---- Iceman's bubble + the timer jump, one event at a time ---------------------
const bag = new LineBag();
const bubbleQ: TickerItem[] = [];
let bubbleBusy = false;
async function bubbleLoop() {
  if (bubbleBusy) return;
  bubbleBusy = true;
  while (bubbleQ.length) {
    const t = bubbleQ.shift()!;
    // Timer: +time tag and an ice flash on the digits.
    if (show.has('timer') && t.seconds) {
      setText($('[data-pop]'), t.time);
      restart($('[data-pop]'), 'go');
      if (!calm) sceneEl.querySelectorAll<HTMLElement>('.ov-digit').forEach((d) => restart(d, 'flash'));
    }
    const group = groupFor(t, data.smallDonation);
    if (show.has('bubble') && group) {
      const vars = varsFor(t);
      const { line, fallback } = t.line !== undefined
        ? (t.line ? { line: t.line, fallback: false } : { line: FALLBACK_LINE, fallback: true })
        : bag.pick(group, data.lines[group]);
      setText($('[data-bwho]'), fallback ? `${t.time} · ${t.what}` : `Mersi, ${t.user}!`);
      setText($('[data-btext]'), fillLine(line, vars));
      const b = $('.ov-bubble');
      b.classList.add('show');
      if (!calm) restart(b, 'pop');
    }
    // Long queues speed up so the stream never falls behind.
    await wait(bubbleQ.length >= 10 ? 1600 : bubbleQ.length >= 3 ? 2600 : 5000);
    if (!bubbleQ.length) $('.ov-bubble').classList.remove('show');
  }
  bubbleBusy = false;
}

// ---- Moments queue ---------------------------------------------------------------
interface Moment { html: string; cls: string; ms: number; big?: boolean; run?: (el: HTMLElement) => Promise<void> }
const momentQ: Moment[] = [];
let momentBusy = false;
function moment(m: Moment) {
  if (!show.has('moments')) return;
  momentQ.push(m);
  while (momentQ.length > 20) { const i = momentQ.findIndex((x) => !x.big); momentQ.splice(i < 0 ? 0 : i, 1); }
  void momentLoop();
}
async function momentLoop() {
  if (momentBusy) return;
  momentBusy = true;
  const host = $('.ov-moment');
  while (momentQ.length) {
    const m = momentQ.shift()!;
    host.className = `ov-moment ${m.cls}`;
    host.innerHTML = m.html;
    void host.offsetWidth;
    host.classList.add('show');
    if (m.run) await m.run(host);
    await wait(momentQ.length >= 4 && !m.big ? Math.min(m.ms, 4000) : m.ms);
    host.classList.remove('show');
    await wait(calm ? 50 : 500);
  }
  momentBusy = false;
}

// VISCOL: snow follows the gifts of the last minute; a wave of 20+ gets the banner.
const gifts: { at: number; n: number }[] = [];
let lastStormBanner = 0;
function giftWave(t: TickerItem) {
  const now = Date.now();
  gifts.push({ at: now, n: t.qty ?? 1 });
  const minute = gifts.filter((g) => now - g.at < 60_000).reduce((a, g) => a + g.n, 0);
  if (((t.qty ?? 0) >= 20 || minute >= 20) && now - lastStormBanner > 60_000) {
    lastStormBanner = now;
    moment({ cls: 'm-storm', ms: 8000, big: true,
      html: `<span class="storm-word">VISCOL</span><span class="storm-who"><strong>${esc(t.user)}</strong> ${esc(t.what)} · <b>${esc(t.time)}</b></span>` });
  }
}
function snowAmount() {
  const now = Date.now();
  while (gifts.length && now - gifts[0].at > 60_000) gifts.shift();
  return Math.min(1, gifts.reduce((a, g) => a + g.n, 0) / 30);
}

// Snow canvas (only during gift waves, and on the pause scene; never with ?calm).
const canvas = document.getElementById('ov-snow') as HTMLCanvasElement;
const flakes = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.6, v: 0.0008 + Math.random() * 0.0016, d: Math.random() * 2 - 1 }));
function snow() {
  if (calm || (piece && piece !== 'snow')) return;
  const ctx = canvas.getContext('2d')!;
  const w = (canvas.width = innerWidth), h = (canvas.height = innerHeight);
  const frame = () => {
    const amount = brb ? 0.18 : snowAmount();
    ctx.clearRect(0, 0, w, h);
    const n = Math.round(flakes.length * amount);
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < n; i++) {
      const f = flakes[i];
      f.y += f.v * (1 + amount); f.x += f.d * 0.0004;
      if (f.y > 1) { f.y = -0.02; f.x = Math.random(); }
      ctx.globalAlpha = 0.35 + (f.r / 3.6) * 0.5;
      ctx.beginPath(); ctx.arc(f.x * w, f.y * h, f.r, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---- Events from the feed --------------------------------------------------------
let lastId: number | null = null;
function queueEvents(items: TickerItem[], first: boolean) {
  for (const t of items) {
    if (t.id === undefined || (lastId !== null && t.id <= lastId)) continue;
    if (!first && lastId !== null && t.time !== '—') {
      bubbleQ.push(t);
      if (t.kind === 'gift') giftWave(t);
      else if (t.big) moment({ cls: 'm-big', ms: 8000, big: true, html: `<span class="mk">MOMENT MARE</span><span class="mt"><b>${esc(t.time)}</b> ${esc(t.user)} · ${esc(t.what)}</span>` });
    }
    lastId = Math.max(lastId ?? 0, t.id);
  }
  while (bubbleQ.length > 40) bubbleQ.shift();
  void bubbleLoop();
}

// ---- Changes between two data states (milestone, legends, badges, bingo, vote, wheel) ----
let prev: SiteData | null = null;
const legendNames = { donations: 'donații', gifts: 'subs dăruite', bits: 'biți' } as const;
const tierRank = ['', 'AURIU · LOCUL 2', 'ARGINTIU · LOCUL 3', 'BRONZ · LOCUL 4'];
const tierColor = ['', '#E6C46A', '#C9D1DB', '#C98A5B'];
function compare(d: SiteData) {
  const p = prev;
  prev = d;
  if (!p || brb) return;
  // Milestone unlocked
  const reached = (x: SiteData) => x.goals.filter((g) => x.raisedNum >= g.threshold).length;
  if (reached(d) > reached(p)) {
    const i = reached(d) - 1, g = d.goals[i], next = d.goals[i + 1];
    moment({ cls: 'm-mile', ms: 10_000, big: true,
      html: `<span class="mk">MILESTONE ${String(i + 1).padStart(2, '0')} DEBLOCAT · ${fmtInt(g.threshold)} €${g.sponsor ? ` · ${esc(g.sponsor).toUpperCase()}` : ''}</span><span class="mt">${esc(g.title)}</span>${next ? `<span class="mn">Următorul: ${String(i + 2).padStart(2, '0')} · ${esc(next.title)}, la ${fmtInt(next.threshold)} €</span>` : ''}` });
  }
  // Legends: #1 through the prism; 2–4 in gold, silver, bronze.
  for (const k of Object.keys(legendNames) as (keyof typeof legendNames)[]) {
    const now = d.boards[k].slice(0, 4), was = p.boards[k].slice(0, 4);
    if (!was.length) continue;
    if (now[0] && now[0][0] !== was[0]?.[0]) {
      moment({ cls: 'm-legend', ms: 10_000, big: true,
        html: `<span class="prism-tag">LEGENDĂ NOUĂ · LOCUL 1 LA ${legendNames[k].toUpperCase()}</span><span class="lg-row"><span class="lg-name">${esc(now[0][0])}</span><span class="lg-total prism-text">${esc(now[0][1])}${k === 'donations' ? ' €' : ''}</span></span>${was[0] ? `<span class="mn">Îl întrece pe ${esc(was[0][0])} (${esc(was[0][1])}${k === 'donations' ? ' €' : ''})</span>` : ''}` });
      continue;
    }
    for (let r = 1; r <= 3; r++) {
      const name = now[r]?.[0];
      const before = was.findIndex((x) => x[0] === name);
      if (name && (before === -1 || before > r)) {
        moment({ cls: 'm-tier', ms: 6000,
          html: `<span class="tier-tag" style="background:${tierColor[r]}">${tierRank[r]} · ${legendNames[k].toUpperCase()}</span><span class="mt">${esc(name)}</span>` });
        break;
      }
    }
  }
  // Big badges: 50 h (platinum) and 100 h (prism), from the Fidelii list.
  for (const l of d.loyal) {
    const old = p.loyal.find((x) => x.name === l.name)?.badges ?? [];
    for (const id of ['h100', 'h50']) {
      if (l.badges.includes(id) && !old.includes(id) && p.loyal.some((x) => x.name === l.name)) {
        const b = badgeDefs.find((x) => x.id === id)!;
        const n = d.badgeCounts?.[id];
        moment({ cls: `m-badge ${id === 'h100' ? 'prism' : 'plat'}`, ms: 9000, big: true,
          html: `<svg class="hex" width="150" height="150" viewBox="0 0 56 56" aria-hidden="true"><polygon points="28,2 51,15 51,41 28,54 5,41 5,15" fill="${id === 'h100' ? 'rgba(169,184,255,0.12)' : 'rgba(95,221,191,0.12)'}" stroke="${id === 'h100' ? 'url(#ovPrism)' : '#5FDDBF'}" stroke-width="2"></polygon><g transform="translate(16 16)"><path d="${badgeIcons[b.icon]}" fill="none" stroke="${id === 'h100' ? 'url(#ovPrism)' : '#5FDDBF'}" stroke-width="2" stroke-linecap="round"></path></g></svg>
            <span class="bd-text"><span class="mk">${id === 'h100' ? 'INSIGNĂ LEGENDARĂ · PRISMĂ' : 'INSIGNĂ FOARTE GREA · PLATINĂ'}</span><span class="mt">${esc(l.name)}</span><span class="mn">a ajuns la <strong>${esc(b.label.toLowerCase())}</strong> în chat.${n ? ` O au ${count(n, 'om', 'oameni')}.` : ''}</span></span>` });
        break;
      }
    }
  }
  // Bingo: a moderator ticked an event.
  for (const it of d.bingo.items) {
    if (it.happened && !p.bingo.items.find((x) => x.id === it.id)?.happened) {
      const done = d.bingo.items.filter((x) => x.happened).length;
      moment({ cls: 'm-bingo', ms: 8000,
        html: `<span class="mk">BINGO · S-A ÎNTÂMPLAT</span><span class="mt">${esc(it.label)}</span><span class="mn"><strong>${count(d.bingo.players, 'jucător', 'jucători')}</strong> în joc · ${done} din ${d.bingo.items.length} bifate</span>` });
    }
  }
  // Wheel: someone spun on the site.
  const w = d.recentWins[0], pw = p.recentWins[0];
  if (w && (!pw || w.user !== pw.user || w.prize !== pw.prize || w.ago !== pw.ago) && w.ago.includes('secunde')) wheelMoment(w.user, w.prize, w.sponsor ?? null);
}

// ---- Vote live --------------------------------------------------------------------
function drawVote(v: ReturnType<typeof derive>) {
  const el = $('.ov-vote');
  const open = show.has('vote') && v.hasRound && data.round !== null && data.round.closesAt > Date.now() && v.challenges.length > 0;
  el.classList.toggle('show', open);
  if (!open) return;
  setText(el.querySelector('[data-vround]'), `VOTUL ABONAȚILOR · RUNDA ${data.round!.number}`);
  setText(el.querySelector('[data-vleft]'), v.roundLeft);
  const html = v.challenges.slice(0, 3).map((c) => `<div class="vo"><div class="vo-top"><span>${esc(c.title)}</span><span>${c.pct}</span></div><div class="vo-bar"><span style="width:${c.pct};background:${c.leading ? '#FFFFFF' : 'var(--ice)'}"></span></div></div>`).join('');
  const list = el.querySelector<HTMLElement>('[data-vlist]')!;
  if (list.innerHTML !== html) list.innerHTML = html;
}
function announceWinner(d: SiteData) {
  if (!d.round) return;
  announced.add(d.round.id);
  const total = d.challenges.reduce((a, c) => a + c.votes, 0);
  const win = [...d.challenges].sort((a, b) => b.votes - a.votes)[0];
  if (!win) return;
  moment({ cls: 'm-vote', ms: 10_000, big: true,
    html: `<span class="mk">VOTUL ABONAȚILOR · RUNDA ${d.round.number} · CÂȘTIGĂ</span><span class="mt">${esc(win.title)}</span><span class="mn">${total ? Math.round((win.votes / total) * 100) : 0}% din voturi · se face live</span>` });
}

// ---- The wheel, when someone spins on the site -------------------------------------
function wheelSvg(): string {
  const n = Math.max(1, data.prizes.length), seg = 360 / n, R = 200, C = 210;
  const pt = (deg: number) => { const a = (deg * Math.PI) / 180; return `${(C + R * Math.cos(a)).toFixed(1)} ${(C + R * Math.sin(a)).toFixed(1)}`; };
  return data.prizes.map((p, i) => {
    const mid = -90 + i * seg;
    return `<path d="M${C} ${C} L${pt(mid - seg / 2)} A${R} ${R} 0 0 1 ${pt(mid + seg / 2)} Z" fill="${p[3] ? '#16304A' : i % 2 ? '#0B1622' : '#0E1A28'}" stroke="#23415E" stroke-width="1.5"></path><text transform="translate(${C} ${C}) rotate(${mid.toFixed(2)}) translate(188 6)" text-anchor="end" fill="${p[3] ? '#E6C46A' : '#F2F5FA'}" font-family="Barlow Condensed, sans-serif" font-weight="800" font-style="italic" font-size="20">${esc(p[0].toUpperCase())}</text>`;
  }).join('');
}
function wheelMoment(user: string, prize: string, sponsor: string | null) {
  // Land on the slice of that prize when its name matches; otherwise the result card is the truth.
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const idx = data.prizes.findIndex((p) => norm(prize).includes(norm(p[0])) || norm(p[1]).includes(norm(prize)) || norm(prize).includes(norm(p[1])));
  const seg = 360 / Math.max(1, data.prizes.length);
  const target = 5 * 360 + (idx >= 0 ? 360 - idx * seg : Math.random() * 360);
  moment({ cls: 'm-wheel', ms: 6000, big: true,
    html: `<div class="wh"><div class="wh-rot"><svg viewBox="-10 -10 440 440" aria-hidden="true">${wheelSvg()}<circle cx="210" cy="210" r="200" fill="none" stroke="#3FD0FF" stroke-width="4"></circle><circle cx="210" cy="210" r="56" fill="#050608" stroke="#3FD0FF" stroke-width="4"></circle></svg></div><img class="wh-emote" src="${emoteSrc}" alt=""><span class="wh-pin"></span></div>
      <div class="wh-text"><span class="mk">ROATA LUI LUCKY · PE SITE</span><span class="mt">${esc(user)} învârte…</span><span class="wh-res">Câștigă: <strong>${esc(prize)}</strong>${sponsor ? ` <span class="spon">de la ${esc(sponsor)}</span>` : ''}</span></div>`,
    run: async (el) => {
      const rot = el.querySelector<HTMLElement>('.wh-rot')!;
      if (calm) { rot.style.transform = `rotate(${target % 360}deg)`; el.classList.add('done'); return; }
      await wait(60);
      rot.style.transform = `rotate(${target}deg)`;
      await wait(4300);
      el.classList.add('done');
    } });
}
const emoteSrc = document.getElementById('ov-assets')?.dataset.emote ?? '';

// ---- Secret code (calm panel) ----------------------------------------------------------
let shownCode = '';
let codeTimer: number | undefined;
function showCode(c: { code: string; sponsor: string | null; expires_at: string } | null) {
  const el = $('.ov-code');
  if (!show.has('code')) return;
  if (!c) { if (shownCode && !shownCode.startsWith('TEST')) { el.classList.remove('show'); shownCode = ''; } return; }
  if (c.code === shownCode) return;
  shownCode = c.code;
  const end = Date.parse(c.expires_at);
  el.innerHTML = `<p class="cd-head"><span>COD SECRET · ROTIRE BONUS</span><span data-cleft></span></p><p class="cd-code">${esc(c.code)}</p><p class="cd-sub">Scrie-l pe site, la Roata lui Lucky${c.sponsor ? ` · oferit de <strong>${esc(c.sponsor.toUpperCase())}</strong>` : ''}</p>`;
  el.classList.add('show');
  clearInterval(codeTimer);
  const tick = () => {
    const s = Math.max(0, Math.round((end - Date.now()) / 1000));
    setText(el.querySelector('[data-cleft]'), `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  };
  tick();
  codeTimer = window.setInterval(tick, 1000);
  window.setTimeout(() => { if (shownCode === c.code) { el.classList.remove('show'); clearInterval(codeTimer); } }, Math.max(5_000, Math.min(codeSecs * 1000, end - Date.now())));
}

// ---- Quiet partner line every few minutes -------------------------------------------
const promoName = (params.has('demo') && params.get('brand')) || site.sponsor.logoText;
function promo() {
  if (!show.has('promo') || !promoName) return;
  const el = $('.ov-promo');
  setText(el.querySelector('strong'), promoName.toUpperCase());
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 10_000);
}
if (!brb && promoMinutes > 0) window.setInterval(promo, promoMinutes * 60_000);
if (params.has('promoNow')) window.setTimeout(promo, 1500);

// ---- Pause scene (?scene=brb) --------------------------------------------------------
function drawBrb(v: ReturnType<typeof derive>) {
  setText($('[data-bclock]'), v.navClock);
  const leg = [['Donatori', v.legendsDon[0], ' €'], ['Subs dăruite', v.legendsGifts[0], ' subs'], ['Biți', v.legendsBits[0], ' biți']] as const;
  const legHtml = leg.filter(([, r]) => r).map(([, r, u]) => `${esc(r!.name)} ${esc(r!.total)}${u}`).join('<br>') || 'Locurile 1 sunt libere.';
  const today = v.advent.find((d) => d.today);
  const html = `<div class="brb-p"><p class="mk">LEGENDE</p><p>${legHtml}</p></div>
    <div class="brb-p"><p class="mk">URMĂTORUL MILESTONE</p><p>${esc(v.nextNoTitle || 'Toate deblocate!')}<br><span style="color:var(--ice)">${esc(v.nextLeft)}</span></p></div>
    <div class="brb-p today"><p class="mk">${today ? `AZI · ZIUA ${today.n}` : 'PROGRAM'}</p><p>${esc(today?.note || 'Revenim imediat pe stream.')}</p></div>`;
  const host = $('[data-bpanels]');
  if (host.innerHTML !== html) host.innerHTML = html;
}

// ---- Tests from /mod (Overlay OBS → «Testează») ------------------------------------------
// Sample events named «TEST», only on this overlay: nothing is recorded anywhere.
let testSeq = 0;
const testItem = (kind: 'sub' | 'gift' | 'bits' | 'donation', qty: number, secs: number) =>
  tickerItem({ id: -(++testSeq), kind, tier: '1000', quantity: qty, currency: 'EUR', seconds_added: secs, user_name: 'TEST', user_login: null });
function runTest(kind: string) {
  if (brb) return;
  if (kind === 'event') {
    bubbleQ.push(testItem('sub', 1, 360), testItem('bits', 400, 240), testItem('donation', 10, 3600));
    void bubbleLoop();
  } else if (kind === 'gift') {
    const t = testItem('gift', 20, 7200);
    bubbleQ.push(t);
    giftWave(t);
    void bubbleLoop();
  } else if (kind === 'moments') {
    const next = data.goals.find((g) => data.raisedNum < g.threshold) ?? data.goals[0];
    moment({ cls: 'm-mile', ms: 6000, html: `<span class="mk">TEST · MILESTONE DEBLOCAT</span><span class="mt">${esc(next?.title ?? 'Milestone de test')}</span>` });
    moment({ cls: 'm-big', ms: 6000, html: '<span class="mk">TEST · MOMENT MARE</span><span class="mt"><b>+5:00:00</b> TEST · donație 50 €</span>' });
    moment({ cls: 'm-vote', ms: 6000, html: '<span class="mk">TEST · VOTUL ABONAȚILOR · CÂȘTIGĂ</span><span class="mt">Provocare de test</span><span class="mn">60% din voturi</span>' });
    if (data.prizes.length) wheelMoment('TEST', data.prizes[0][0], null);
  } else if (kind === 'code') {
    showCode({ code: 'TEST-OK', sponsor: null, expires_at: new Date(Date.now() + 20_000).toISOString() });
  } else if (kind === 'promo') {
    promo();
  }
}

// ---- Data -------------------------------------------------------------------------------
function onData(first: boolean) {
  compare(data);
  if (first) prev = data;
  draw();
}

if (params.has('demo')) {
  void import('../demo/backend').then(({ DemoBackend }) => {
    const api = new DemoBackend();
    let first = true;
    let lastTest = api.state.overlayTest?.n ?? 0;
    const sync = () => {
      const t = api.state.overlayTest;
      if (t && t.n > lastTest) { lastTest = t.n; if (Date.now() - t.at < 60_000) runTest(t.kind); }
      data = api.toSiteData();
      const cc = api.currentCode();
      showCode(cc ? { code: cc.code, sponsor: cc.sponsor, expires_at: new Date(cc.expiresAt).toISOString() } : null);
      queueEvents(api.state.events.filter((e) => lastId === null || e.id > lastId).reverse().map(tickerItem), lastId === null);
      onData(first);
      first = false;
    };
    api.subscribe(sync);
    sync();
    window.setInterval(sync, 2000);
    // Show the bubble once on load, so its place on the stream is visible.
    const t = data.ticker[0];
    if (t && !brb && !params.has('promoNow')) window.setTimeout(() => { bubbleQ.push(t); void bubbleLoop(); }, 600);
  });
} else {
  void import('./live').then(({ Live }) => {
    const live = new Live(data, {
      onData(patch, first) {
        data = { ...data, ...patch };
        if (patch.ticker) {
          const newest = [...data.ticker].reverse();
          if (first || lastId === null) queueEvents(newest, true);
          else void live.feedSince(lastId).then((items) => queueEvents(items, false));
        }
        onData(first);
      },
      onMe() {},
      onTest(t) { if (Date.now() - Date.parse(t.at) < 60_000) runTest(t.kind); },
    }, { intervalMs: 3000, pollHidden: true });
    void live.start();
    if (overlayKey) {
      const poll = async () => { const { data: rows } = await live.overlayCode(overlayKey); showCode(rows?.[0] ?? null); };
      void poll();
      window.setInterval(() => void poll(), 8_000);
    }
  });
}

// Test hooks for ?demo (the 30-event burst check): window.__ov.burst(30).
if (params.has('demo')) (window as unknown as { __ov: unknown }).__ov = {
  burst(n = 30) {
    const base = (lastId ?? 0) + 1000;
    const kinds = ['sub', 'gift', 'bits', 'donation'] as const;
    const items = Array.from({ length: n }, (_, i) => tickerItem({ id: base + i, kind: kinds[i % 4], tier: '1000', quantity: kinds[i % 4] === 'gift' ? 5 : kinds[i % 4] === 'bits' ? 400 : kinds[i % 4] === 'donation' ? 5 : 1, currency: 'EUR', seconds_added: 360, user_name: `viewer_${String(i + 1).padStart(2, '0')}`, user_login: null }));
    queueEvents(items, false);
    return { queued: bubbleQ.length };
  },
  state: () => ({ bubbleQueue: bubbleQ.length, moments: momentQ.length, lastId }),
  /** Play every moment once (demo): milestone, legends, badge, bingo, VISCOL, vote winner, wheel, big moment. */
  sample() {
    const fake: SiteData = JSON.parse(JSON.stringify(data));
    const reachedIdx = data.goals.filter((g) => data.raisedNum >= g.threshold).length - 1;
    if (reachedIdx >= 0) fake.raisedNum = data.goals[reachedIdx].threshold - 1;
    if (fake.boards.donations[0]) fake.boards.donations[0] = ['cineva_altcineva', '10'];
    if (fake.boards.bits.length > 2) fake.boards.bits.splice(2, 1);
    if (fake.loyal[0]) fake.loyal[0].badges = fake.loyal[0].badges.filter((b) => b !== 'h50');
    const it = fake.bingo.items.find((x) => x.happened) ?? fake.bingo.items[0];
    if (it) { it.happened = false; const real = data.bingo.items.find((x) => x.id === it.id); if (real) real.happened = true; }
    prev = fake;
    compare(data);
    giftWave(tickerItem({ id: 0, kind: 'gift', tier: '1000', quantity: 20, currency: null, seconds_added: 7200, user_name: 'vladutz97', user_login: null }));
    moment({ cls: 'm-big', ms: 6000, html: '<span class="mk">MOMENT MARE</span><span class="mt"><b>+5:00:00</b> andreiGG · donație 50 €</span>' });
    if (data.round) announceWinner(data);
    const w = data.recentWins[0];
    wheelMoment(w?.user ?? 'kxtrin', w?.prize ?? 'VIP 24 de ore', w?.sponsor ?? 'Zona IT');
    return { moments: momentQ.length };
  },
};

snow();
setInterval(draw, 1000);
draw();
void PRISM;
