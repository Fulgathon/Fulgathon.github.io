// OBS overlay, layout v2 (design/layout-v2/Overlay.dc.html): a full 1920×1080
// scene with the living timer (bottom left), the next milestone (bottom right),
// Iceman's bubble (top right; «Ore împreună» was deleted, owner 24 Nov) and a quiet
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
import { visibleSponsors } from '../lib/sponsorViews';
import { tickerItem } from '../lib/events';
import { derive, initialState } from '../lib/derive';
import { LineBag, fillLine, groupFor, varsFor } from '../lib/lines';
import { FALLBACK_LINE } from '../data/content';
import { count, fmtInt } from '../lib/format';
import { rafflePanel } from './overlay-raffle';
import { overlaySound } from './overlay-sound';

const params = new URLSearchParams(location.search);
const calm = params.has('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const brb = params.get('scene') === 'brb';
// ?part=timer: one piece per OBS Browser Source. Only that panel, at the source's top-left
// corner, so Iceman places and sizes each piece per scene (every game has its own layout).
// ?frame=1 outlines the piece and keeps it visible, for placing it in OBS.
// 'speech' is the old name of the bubble piece; links already in OBS keep working.
const partParam = params.get('part') === 'speech' ? 'bubble' : params.get('part') ?? '';
const piece = overlayPieces.some((p) => p.id === partParam) ? partParam : null;
const show = new Set(piece ? [piece] : (params.get('show') ?? 'timer,goal,bubble,moments,vote,promo,code,draw').split(','));
if (piece) document.body.classList.add('piece', `piece-${piece}`);
// Owner, 24 Nov: «Balonul lui Iceman» is only the speech bubble (it sits over his real camera),
// never the drawn Iceman. &tail=right points the tail to the right.
if (piece === 'bubble') document.body.classList.add('piece-speech');
if (piece === 'bubble' && params.get('tail') === 'right') document.body.classList.add('tail-right');
if (params.has('frame')) document.body.classList.add('frame');
const scale = Math.min(2, Math.max(0.5, Number(params.get('scale')) || 1));
const overlayKey = params.get('key');
const promoMinutes = params.has('promo') ? Math.max(0, Number(params.get('promo')) || 0) : 10;
const codeSecs = Math.min(600, Math.max(10, Number(params.get('codeSecs')) || 60));

document.body.classList.toggle('calm', calm);
// Every overlay fits its Browser Source (owner, 24 Nov: all overlays at 2K). The scene and the pause
// scene are laid out on a 1920×1080 grid, a piece on its own size (overlayPieces); a 2560×1440 source
// (2K) draws everything ×4/3, a 1920×1080 one as before. &scale= still multiplies on top.
const pieceSize = overlayPieces.find((p) => p.id === piece);
let fitK = 1;
function fitScale() {
  const [w, h] = pieceSize ? [pieceSize.w, pieceSize.h] : [1920, 1080];
  fitK = Math.min(4, Math.max(0.25, Math.min(innerWidth / w, innerHeight / h) || 1));
  document.documentElement.style.setProperty('--scale', String(fitK * scale));
}
fitScale();
addEventListener('resize', fitScale);
const sceneEl = document.getElementById(brb ? 'brb' : 'scene')!;
sceneEl.hidden = false;
document.getElementById('compact')!.hidden = true;
document.querySelectorAll<HTMLElement>('[data-part]').forEach((el) => { if (sceneEl.contains(el)) el.hidden = !show.has(el.dataset.part!); });

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => sceneEl.querySelector<T>(sel)!;
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const setText = (el: HTMLElement | null, t: string) => { if (el && el.textContent !== t) el.textContent = t; };
// Ticking numbers (countdowns, the pause clock): every digit in a same-width box, so the text never jiggles.
const setMono = (el: Element | null, text: string) => {
  if (!el || (el as HTMLElement).dataset.mono === text) return;
  (el as HTMLElement).dataset.mono = text;
  el.innerHTML = esc(text).replace(/\d/g, (d) => `<span class="dg">${d}</span>`);
};
const restart = (el: HTMLElement, cls: string) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let data: SiteData = emptyData();
// Sample names for the demo draw (?demo&part=draw).
const DEMO_DRAW = ['kxtrin', 'vladutz97', 'andreiGG', 'Rares1337', 'stefan_ro', 'ioana_plays', 'mihai_tm', 'Cristi.R', 'alexdinbuzau', 'snowyRO', 'deliaa', 'tudor_04'];
const announced = new Set<number>();

// ---- Base layout, every second -------------------------------------------------
function draw() {
  // The clock's view: demo samples or the practice clock on top of the real data (never stored
  // back, so the change detector only ever compares real data).
  const view = rehearsalData(forcedData(data));
  const v = derive({ ...initialState(), now: Date.now() }, view);
  if (brb) return drawBrb(v);
  drawTimer(v, view);
  // Next milestone
  setText($('[data-mtag]'), v.allGoalsDone ? 'TOATE MILESTONE-URILE' : 'URMĂTORUL MILESTONE');
  setText($('[data-mleft]'), v.nextLeft.toUpperCase());
  setText($('[data-mtitle]'), v.hasNextGoal ? v.nextNoTitle : 'Deblocate!');
  setText($('[data-mof]'), v.nextOf);
  $('[data-mbar]').style.width = v.nextBar;
  // Together
  drawVote(v);
  // Vote: announce the winner once, right after the round closes (it can close without any data change).
  const r = data.round;
  if (r && r.closesAt <= Date.now() && r.closesAt > Date.now() - 30_000 && !announced.has(r.id)) announceWinner(data);
}

// ---- Cronometrul: state, tag, the bottom line ------------------------------------
const TZ = 'Europe/Bucharest';
const hmBuc = (ms: number) => new Date(ms).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const dayBuc = (ms: number) => new Date(ms).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', timeZone: TZ }).replace('.', '');
let lastSec = -1;
// Demo only: &state=live|frozen|double|upcoming|ended shows that look with sample times (previews, OBS tests).
const forced = params.has('demo') ? params.get('state') : null;
const FORCED_STATES = ['live', 'frozen', 'double', 'upcoming', 'ended'];
// Fixed sample times for those previews, so a frozen clock really stands still.
const T0 = Date.now();
const SAMPLE = { freezeEnd: T0 + 2 * 86_400_000, doubleEnd: T0 + 42 * 60_000, start: T0 + 26 * 3_600_000 };
const pad2 = (n: number) => String(n).padStart(2, '0');

// Odometer: a changed digit rolls out downwards while the new one drops in.
// `big` (time added): a longer roll, staggered left to right from `delay` on.
let slotIndex = 0;
function setGroup(el: HTMLElement, val: string, roll: boolean, big = false) {
  const slots = el.querySelectorAll<HTMLElement>('.sl');
  if (slots.length !== val.length) { el.innerHTML = [...val].map((c) => `<span class="sl"><b>${c}</b></span>`).join(''); return; }
  [...val].forEach((c, i) => {
    const sl = slots[i];
    const n = slotIndex++;
    sl.querySelectorAll('b.out').forEach((x) => x.remove());
    const cur = sl.lastElementChild as HTMLElement;
    if (cur.textContent === c) return;
    if (!roll || calm) { cur.textContent = c; cur.className = ''; cur.style.removeProperty('--d'); return; }
    // Each second: swap in place with a soft brighten (no roll), so the clock never draws the eye.
    if (!big) { cur.textContent = c; cur.className = ''; restart(cur, 'tick'); return; }
    const nb = document.createElement('b');
    const d = '0s'; void n;
    nb.textContent = c; nb.className = big ? 'in big' : 'in'; nb.style.setProperty('--d', d);
    cur.className = big ? 'out big' : 'out'; cur.style.setProperty('--d', d);
    sl.append(nb);
    setTimeout(() => { cur.remove(); if (nb.classList.contains('in')) { nb.className = ''; nb.style.removeProperty('--d'); } }, big ? 1200 : 400);
  });
}
function showClock(total: number, roll: boolean, big = false) {
  const t = Math.max(0, Math.round(total));
  const parts = { dd: pad2(Math.floor(t / 86400)), hh: pad2(Math.floor((t % 86400) / 3600)), mm: pad2(Math.floor((t % 3600) / 60)), ss: pad2(t % 60) };
  slotIndex = 0;
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) setGroup(sceneEl.querySelector<HTMLElement>(`[data-u="${k}"]`)!, parts[k], roll, big);
}
// Time added (subs, donations, a moderator), as one clear moment: the clock dims, «TIMP ADĂUGAT
// +1:15:00» grows in and holds, then the changed digits roll to the new time together. More time
// arriving meanwhile adds up in the same moment instead of starting a new one.
let shown = -1;
let shownAt = 0;
let gain: { delta: number; last: number; at: number } | null = null;
// The clock also ran down while we waited for the update: put those seconds back so the
// moment says +2:00:00, not +1:59:59 (a frozen clock doesn't run down).
const ranDown = (since: number, state: string) => (state === 'frozen' ? 0 : Math.round((Date.now() - since) / 1000));
const fmtGain = (sec: number) => {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return `+${h ? `${h}:${pad2(m)}:${pad2(x)}` : `${m}:${pad2(x)}`}`;
};
function drawClock(target: number, state: string) {
  // Until the first real data arrives, no «time added»: the first value is just the clock.
  if (data.loaded === false && !rehearsing(data)) { showClock(target, false); shown = -1; return; }

  if (gain) {
    const more = target - gain.last + ranDown(gain.at, state);
    if (more > 5) { gain.delta += more; setText($('[data-gainv]'), fmtGain(gain.delta)); }
    gain.last = target; gain.at = Date.now();
    return;
  }
  const canGain = state === 'live' || state === 'frozen' || state === 'double';
  const added = shown >= 0 ? target - shown + ranDown(shownAt, state) : 0;
  if (shown >= 0 && canGain && !calm && added > 5) {
    const el = $('.ov-timer');
    gain = { delta: added, last: target, at: Date.now() };
    setText($('[data-gainl]'), state === 'double' ? 'TIMP ADĂUGAT · ×2' : 'TIMP ADĂUGAT');
    setText($('[data-gainv]'), fmtGain(gain.delta));
    el.classList.add('gaining');
    restart($('[data-gain]'), 'go');
    setTimeout(() => {
      el.classList.remove('gaining');
      restart(el, 'gain');
      const now = gain!.last;
      gain = null;
      showClock(now, true, true);
      shown = now; shownAt = Date.now();
    }, 1450);
    return;
  }
  showClock(target, shown >= 0);
  shown = target; shownAt = Date.now();
}

// The band's rotating line: what matters in this state, then where to go.
const GOODS = 'VOT · ROATĂ · BINGO';
let tickState = '';
let tickI = 0;
let tickLines: () => string[] = () => [GOODS];
function showTick(text: string) {
  const box = $('[data-tick]');
  const cur = box.querySelector('span:not(.out)');
  if (cur?.textContent === text) return;
  box.querySelectorAll('span.out').forEach((x) => x.remove());
  if (cur) { cur.className = 'out'; setTimeout(() => cur.remove(), 420); }
  const sp = document.createElement('span');
  sp.textContent = text; sp.className = calm || !cur ? '' : 'in';
  box.append(sp);
}
setInterval(() => { const l = tickLines(); if (l.length > 1) { tickI = (tickI + 1) % l.length; showTick(l[tickI]); } }, 8000);

let prevState = '';
// «Repetiție» from /mod: while the real marathon isn't live, the overlay runs the practice clock
// (tag «TEST»), so Iceman can see every piece react in OBS without going live.
const rehearsing = (d: SiteData) => !!d.rehearsal && d.rehearsal.until > Date.now() && (d.status !== 'live' || params.has('demo'));
function rehearsalData(d: SiteData): SiteData {
  if (!rehearsing(d)) return d;
  const r = d.rehearsal!;
  return { ...d, loaded: true, status: 'live', endsAt: r.endsAt, pausedUntil: r.pausedUntil, doubleFrom: r.doubleFrom, doubleUntil: r.doubleUntil, doubleSponsor: r.doubleUntil ? d.doubleSponsor ?? null : null };
}
let lastRehearsalN = -1;
function rehearsalEvents(d: SiteData) {
  const last = d.rehearsal?.last;
  if (!rehearsing(d) || !last) { if (!d.rehearsal) lastRehearsalN = -1; return; }
  if (lastRehearsalN === -1) { lastRehearsalN = last.n; return; }
  if (last.n <= lastRehearsalN) return;
  lastRehearsalN = last.n;
  const t = tickerItem({ id: -(100000 + last.n), kind: last.kind, tier: '1000', quantity: last.amount, currency: 'EUR', seconds_added: last.seconds, user_name: last.user, user_login: null });
  bubbleQ.push(t);
  if (last.kind === 'gift') giftWave(t);
  void bubbleLoop();
}

/** Demo &state=…: the sample times, applied before derive() so every frame agrees. */
function forcedData(d: SiteData): SiteData {
  if (!forced || !FORCED_STATES.includes(forced)) return d;
  return { ...d, pausedUntil: forced === 'frozen' ? SAMPLE.freezeEnd : null,
    doubleFrom: forced === 'double' ? T0 : null, doubleUntil: forced === 'double' ? SAMPLE.doubleEnd : null,
    doubleSponsor: forced === 'double' ? (d.doubleSponsor || site.sponsor.logoText) : null,
    startsAt: forced === 'upcoming' ? SAMPLE.start : d.startsAt };
}
function drawTimer(v: ReturnType<typeof derive>, view: SiteData) {
  const timer = $('.ov-timer');
  let state = v.isFrozen ? 'frozen' : v.isLive && v.doubleNow ? 'double' : v.isLive ? 'live' : v.isEnded ? 'ended' : 'upcoming';
  if (forced && FORCED_STATES.includes(forced)) {
    state = forced;
    const now = Date.now();
    v = { ...v, statusText: state === 'upcoming' ? 'ÎNCEPE CURÂND' : 'ÎNCHEIAT', ...(state === 'ended' ? { dd: '00', hh: '00', mm: '00', ss: '00' } : {}) };
    void now;
  }
  if (timer.dataset.state !== state) {
    timer.dataset.state = state;
    if (prevState && !calm) {
      timer.classList.remove('enter-frozen', 'enter-double');
      if (state === 'frozen' || state === 'double') { void timer.offsetWidth; timer.classList.add(`enter-${state}`); setTimeout(() => timer.classList.remove(`enter-${state}`), 2000); }
      restart($('[data-ttag]'), 'slam');
    }
    prevState = state;
  }
  // A practice clock or «Mod test» on /mod: the yellow TEST tag.
  const test = (rehearsing(view) || !!view.testMode) && !forced;
  setText($('[data-ttext]'), state === 'frozen' ? (test ? 'ÎNGHEȚAT · TEST' : 'ÎNGHEȚAT') : state === 'double' ? (test ? '×2 · TEST' : '×2 ORA DUBLĂ') : state === 'live' ? (test ? 'TEST' : 'LIVE') : state === 'ended' ? 'TIMPUL A EXPIRAT' : v.statusText);
  timer.classList.toggle('rehearsal', test);
  drawClock(Number(v.dd) * 86400 + Number(v.hh) * 3600 + Number(v.mm) * 60 + Number(v.ss), state);
  // Band lines for this state (read fresh at every rotation, so «ÎNCĂ 41 MIN» stays current).
  const t = view;
  const when = (ms: number) => (dayBuc(ms) === dayBuc(Date.now()) ? `LA ${hmBuc(ms)}` : `PE ${dayBuc(ms).toUpperCase()} · ${hmBuc(ms)}`);
  tickLines = () => {
    if (state === 'frozen' && t.pausedUntil) return [`PÂNĂ ${when(t.pausedUntil)}`, 'SUBS ȘI DONAȚIILE ADAUGĂ TIMP', GOODS];
    if (state === 'double' && t.doubleUntil) {
      const m = Math.max(1, Math.ceil((t.doubleUntil - Date.now()) / 60_000));
      return [`×2 · ÎNCĂ ${m} MIN`, ...(t.doubleSponsor ? [`DE LA ${t.doubleSponsor.toUpperCase()}`] : []), GOODS];
    }
    if (state === 'upcoming' && t.startsAt) return [`START ${when(t.startsAt).replace(/^(LA|PE) /, '')}`, GOODS];
    if (state === 'ended') return ['MULȚUMIM TUTUROR!'];
    return [GOODS];
  };
  if (tickState !== state) { tickState = state; tickI = 0; showTick(tickLines()[0]); }
  else if (tickI === 0) showTick(tickLines()[0]);
  // The minute bar drains with the seconds; it refills without a slide.
  const sec = Number(v.ss) || 0;
  const bar = $('[data-sweep]');
  bar.style.transition = sec > lastSec ? 'none' : '';
  bar.style.transform = `scaleX(${state === 'live' ? sec / 59 : 1})`;
  lastSec = sec;
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
  wakeSnow();
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
// The frame loop runs only while there is snow to draw: a gift wave wakes it, and it
// clears the canvas and stops once the wave is over (no work per frame on a quiet stream).
const canvas = document.getElementById('ov-snow') as HTMLCanvasElement;
const flakes = Array.from({ length: 260 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 2.6, v: 0.0008 + Math.random() * 0.0016, d: Math.random() * 2 - 1 }));
let wakeSnow = () => {};
function snow() {
  if (calm || piece) return;
  const ctx = canvas.getContext('2d')!;
  const w = (canvas.width = innerWidth), h = (canvas.height = innerHeight);
  let running = false;
  const frame = () => {
    const amount = brb ? 0.18 : snowAmount();
    ctx.clearRect(0, 0, w, h);
    const n = Math.round(flakes.length * amount);
    if (!n) { running = false; return; }
    ctx.fillStyle = '#FFFFFF';
    for (let i = 0; i < n; i++) {
      const f = flakes[i];
      f.y += f.v * (1 + amount); f.x += f.d * 0.0004;
      if (f.y > 1) { f.y = -0.02; f.x = Math.random(); }
      ctx.globalAlpha = 0.35 + (f.r / 3.6) * 0.5;
      ctx.beginPath(); ctx.arc(f.x * w, f.y * h, f.r * fitK, 0, Math.PI * 2); ctx.fill();
    }
    requestAnimationFrame(frame);
  };
  wakeSnow = () => { if (!running) { running = true; requestAnimationFrame(frame); } };
  wakeSnow();
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
  setMono(el.querySelector('[data-vleft]'), v.roundLeft);
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
    setMono(el.querySelector('[data-cleft]'), `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  };
  tick();
  codeTimer = window.setInterval(tick, 1000);
  window.setTimeout(() => { if (shownCode === c.code) { el.classList.remove('show'); clearInterval(codeTimer); } }, Math.max(5_000, Math.min(codeSecs * 1000, end - Date.now())));
}

// ---- Quiet partner line every few minutes -------------------------------------------
// The sponsors marked «pe overlay» on /mod take turns, each with its own line; before they are
// set up on /mod, the main partner from site.ts.
const brandName = params.has('demo') ? params.get('brand') : null;
let promoTurn = 0;
function promo() {
  if (!show.has('promo')) return;
  const list = brandName ? [] : visibleSponsors(data.sponsors, Date.now(), 'overlay');
  const s = list.length ? list[promoTurn++ % list.length] : null;
  const name = brandName || s?.name || (Array.isArray(data.sponsors) ? '' : site.sponsor.logoText);
  if (!name) return;
  const el = $('.ov-promo');
  setText(el.querySelector('strong'), name.toUpperCase());
  setText(el.querySelector('[data-pline]'), s?.overlayLine ? ` · ${s.overlayLine}` : '');
  el.classList.add('show');
  window.setTimeout(() => el.classList.remove('show'), 10_000);
}
if (!brb && promoMinutes > 0) window.setInterval(promo, promoMinutes * 60_000);
if (params.has('promoNow')) window.setTimeout(promo, 1500);

// ---- Pause scene (?scene=brb) --------------------------------------------------------
function drawBrb(v: ReturnType<typeof derive>) {
  setMono($('[data-bclock]'), v.navClock);
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
// ---- Bingo draw (?part=draw) ---------------------------------------------------------------
// Owner, 24 Nov: Iceman (or a moderator) presses «Trage la sorți» on /mod; the server picks the
// winner first, the reel is only the show. It plays when the draw's shownAt is new and recent, so
// «Arată din nou» replays it and an OBS source loaded later doesn't replay an old draw.
const DRAW_ROW = 64;
// Owner, 24 Nov: «much longer, to keep the suspense». ~18 s: fast at first, then a long slow-down,
// and the last few names creep through the middle row one by one before it stops on the winner.
const DRAW_SPIN = 18_000;
const DRAW_ROWS = 150;      // rows the reel travels
const DRAW_EASE = 2.4;      // 1-(1-t)^2.4: ~20 rows/s at the start, the last 4 names over the last ~4 s
let drawSeen = 0;
let drawShowTimer = 0;
let drawRun = 0;
const shuffle = <T>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
function checkDraw() {
  const dr = data.bingo.draw;
  if (!dr || !show.has('draw') || brb || !(dr.shownAt > drawSeen)) return;
  drawSeen = dr.shownAt;
  if (Date.now() - dr.shownAt > 90_000) return;
  // A raffle draw (PREMII → Tombole) carries its own prize; a bingo draw uses the bingo prize.
  if (dr.kind === 'tombola') playDraw(dr.name, dr.entrants, dr.prize ?? '', dr.sponsor ?? null, dr.total, 'tombola');
  else playDraw(dr.name, dr.entrants, data.bingo.prize, data.bingo.prizeSponsor ?? null, dr.total);
}
function playDraw(winner: string, entrants: string[], prize: string, sponsor: string | null, total = entrants.length, kind: 'bingo' | 'tombola' = 'bingo') {
  const el = $('.ov-draw');
  window.clearTimeout(drawShowTimer);
  const names = entrants.length ? entrants : [winner];
  // The reel: every entry, shuffled, over and over (DRAW_ROWS + 2 rows), then the winner and two more.
  const seq: string[] = [];
  while (seq.length < DRAW_ROWS + 2) {
    const block = shuffle(names);
    if (names.length > 1 && block[0] === seq[seq.length - 1]) block.push(block.shift()!);
    seq.push(...block);
  }
  const at = seq.length;
  // The winner's name doesn't pass through the slow last stretch before it stops there.
  for (let i = Math.max(0, at - 10); i < at; i++) {
    if (seq[i] !== winner) continue;
    const j = seq.findIndex((n, k) => k < at - 10 && n !== winner);
    if (j >= 0) [seq[i], seq[j]] = [seq[j], seq[i]];
  }
  const rest = names.filter((n) => n !== winner);
  const after = rest.length ? rest : names;
  seq.push(winner, after[0], after[1 % after.length]);
  const prizeTxt = prize && !prize.startsWith('[') ? prize : 'premiul cel mare';
  const n = Math.max(total, names.length);
  const head = kind === 'tombola'
    ? `<span class="dr-tag">TOMBOLĂ · TRAGEREA LA SORȚI</span><span class="dr-meta"><b>${esc(count(n, 'participant', 'participanți'))}</b></span>`
    : `<span class="dr-tag">BINGO · TRAGEREA LA SORȚI</span><span class="dr-meta"><b>${esc(count(n, 'jucător', 'jucători'))}</b> cu linia completă</span>`;
  el.innerHTML = `<div class="dr-head">${head}</div>
    <div class="dr-reel"><ul class="dr-list">${seq.map((n, i) => `<li${i === at ? ' class="win"' : ''}>${esc(n)}</li>`).join('')}</ul><div class="dr-frame"></div><div class="dr-burst"></div><div class="dr-shards">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('')}</div></div>
    <div class="dr-foot"><span class="dr-won">CÂȘTIGĂTOR</span><span class="dr-prize">${esc(prizeTxt)}${sponsor ? ` <span class="spon">· de la ${esc(sponsor)}</span>` : ''}</span></div>`;
  const list = el.querySelector<HTMLElement>('.dr-list')!;
  const rows = [...list.children] as HTMLElement[];
  const endPx = (at - 2) * DRAW_ROW;
  const run = ++drawRun;
  el.classList.remove('won');
  void el.offsetWidth;
  el.classList.add('show');
  let landed = false;
  const finish = () => { if (run !== drawRun || landed) return; landed = true; list.style.transform = `translateY(${-endPx}px)`; rows.forEach((r) => r.classList.remove('at')); el.classList.add('won'); drawSound.win(); };
  if (calm) finish();
  else {
    // Driven frame by frame (not a CSS transition) for the long tail; the name in the middle row
    // brightens as it passes, so the slow end reads name by name.
    list.style.transition = 'none';
    list.style.transform = 'translateY(0)';
    const startAt = performance.now() + 1200;
    window.setTimeout(() => { if (run === drawRun) drawSound.whoosh(); }, 1200);
    const start = at - 2 - DRAW_ROWS;   // top row at t=0 (the middle row is always top + 2); ends at at - 2
    let lit = -1;
    const step = (now: number) => {
      if (run !== drawRun) return;
      const t = Math.min(1, Math.max(0, (now - startAt) / DRAW_SPIN));
      const y = (start + (1 - Math.pow(1 - t, DRAW_EASE)) * DRAW_ROWS) * DRAW_ROW;
      list.style.transform = `translateY(${-y}px)`;
      const mid = Math.round(y / DRAW_ROW) + 2;
      if (mid !== lit) { rows[lit]?.classList.remove('at'); rows[mid]?.classList.add('at'); if (lit >= 0 && t > 0) drawSound.tick(t); lit = mid; }
      if (t < 1) requestAnimationFrame(step); else finish();
    };
    list.style.transform = `translateY(${-start * DRAW_ROW}px)`;
    requestAnimationFrame(step);
    // If frames stop (a hidden source), still land on the winner on time.
    window.setTimeout(finish, 1200 + DRAW_SPIN + 400);
  }
  drawShowTimer = window.setTimeout(() => { if (run === drawRun) el.classList.remove('show', 'won'); }, (calm ? 0 : 1200 + DRAW_SPIN) + 22_000);
}

// The raffle on stream (part 'raffle'): its own solid panel under the bingo draw.
// Draw sounds (countdown, spin clicks, win chime); &sound=0 turns them off, &vol=0–1 sets the level.
const drawSound = overlaySound(show.has('draw') && params.get('sound') !== '0', params.has('vol') ? Number(params.get('vol')) : 0.8);
const raffleView = show.has('draw') && !brb ? rafflePanel($('.ov-raffle'), calm, drawSound) : null;
function onData(first: boolean) {
  raffleView?.update(data.raffle ?? null);
  checkDraw();
  compare(data);
  rehearsalEvents(data);
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
      api.raffleDemoTick();   // demo: sample viewers keep entering the raffle on stream
      data = api.toSiteData();
      const cc = api.currentCode();
      showCode(cc ? { code: cc.code, sponsor: cc.sponsor, expires_at: new Date(cc.expiresAt).toISOString() } : null);
      queueEvents(api.state.events.filter((e) => lastId === null || e.id > lastId).reverse().map(tickerItem), lastId === null);
      onData(first);
      first = false;
    };
    api.subscribe(sync);
    sync();
    // ?demo&part=draw: a sample draw on load and every 40 s, to place and preview it in OBS.
    if (piece === 'draw') {
      const sample = () => { if (!data.raffle && (!data.bingo.draw || Date.now() - data.bingo.draw.shownAt > 60_000)) playDraw(DEMO_DRAW[2], demoEntrants(40), data.bingo.prize, data.bingo.prizeSponsor ?? null); };
      window.setTimeout(sample, 800);
      window.setInterval(sample, 40_000);
    }
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
  /** Play the bingo draw with sample names (demo). */
  draw(n = 40) { playDraw(DEMO_DRAW[2], demoEntrants(n), data.bingo.prize, data.bingo.prizeSponsor ?? null); },
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
    wheelMoment(w?.user ?? 'kxtrin', w?.prize ?? 'VIP 24 de ore', w?.sponsor ?? 'Sponsor Principal');
    return { moments: momentQ.length };
  },
};

function demoEntrants(n: number) {
  return shuffle(Array.from({ length: n }, (_, i) => DEMO_DRAW[i] ?? `viewer_${100 + i * 7}`));
}

snow();
setInterval(draw, 1000);
draw();
void PRISM;
