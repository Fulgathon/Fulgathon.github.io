// OBS overlay: same live data and maths as the site (Live + derive).
// Default is a slim strip in a corner; ?style=box gives the large box.
// ?demo reads the simulated backend shared with /?demo, /mod/?demo and
// /prezentare/ (events fired there pop up here), for presentations and for
// placing the overlay in OBS before the subathon.

import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData, TickerItem } from '../data/types';
import { tickerItem } from '../lib/events';
import { derive, initialState } from '../lib/derive';

const params = new URLSearchParams(location.search);
const show = new Set((params.get('show') ?? 'timer,goal,events').split(','));
const boxStyle = params.get('style') === 'box';
const pos = ['tr', 'tl', 'br', 'bl'].includes(params.get('pos') ?? '') ? params.get('pos')! : 'tr';
const scale = Math.min(2, Math.max(0.6, Number(params.get('scale')) || 1));
const overlayKey = params.get('key');
const promoMinutes = params.has('promo') ? Math.max(0, Number(params.get('promo')) || 0) : 10;
const codeSecs = Math.min(600, Math.max(10, Number(params.get('codeSecs')) || 60));

document.body.className = `pos-${pos}`;
// Fits the source like the other overlays: a 2560×1440 (2K) source draws it ×4/3.
const fitClassic = () => document.documentElement.style.setProperty('--scale', String(scale * Math.min(4, Math.max(0.25, Math.min(innerWidth / 1920, innerHeight / 1080) || 1))));
fitClassic();
addEventListener('resize', fitClassic);

// Only the chosen style, and only the chosen parts.
const root = document.getElementById(boxStyle ? 'box' : 'compact')!;
document.getElementById(boxStyle ? 'compact' : 'box')!.hidden = true;
root.hidden = false;
const eventEl = boxStyle ? document.querySelector<HTMLElement>('.box-event')! : root.querySelector<HTMLElement>('.chip')!;
eventEl.hidden = !show.has('events');
root.querySelectorAll<HTMLElement>('[data-part]').forEach((el) => { el.hidden = !show.has(el.dataset.part!); });
if (!show.has('timer') && !show.has('goal')) (boxStyle ? root : document.getElementById('strip')!).hidden = true;

const all = (sel: string) => root.querySelectorAll<HTMLElement>(sel);
let data: SiteData = emptyData();
/** Newest event id already queued (null until the first load). */
let lastId: number | null = null;

function draw() {
  const v = derive({ ...initialState(), now: Date.now() }, data);
  const set = (sel: string, text: string) => all(sel).forEach((el) => { if (el.textContent !== text) el.textContent = text; });
  // Every digit in a same-width box (the font has no fixed-width figures), so the clock never jiggles.
  const mono = (sel: string, text: string) => all(sel).forEach((el) => {
    if (el.dataset.mono === text) return;
    el.dataset.mono = text;
    el.innerHTML = text.replace(/[&<>]/g, '').replace(/\d/g, (d) => `<span class="dg">${d}</span>`);
  });
  mono('[data-clock]', v.navClock);
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) mono(`[data-unit="${k}"]`, v[k]);
  set('[data-label]', v.timerLabel);
  set('[data-badge]', v.statusText);
  all('[data-badge]').forEach((el) => el.classList.toggle('live', v.isLive));
  set('[data-goal-title]', v.nextGoalTitle);
  set('[data-progress]', v.progressLabel);
  all('[data-fill]').forEach((el) => { el.style.width = v.progressPct; });
  // Sponsored Ora dublă, while it runs (slim strip only).
  const dbl = document.querySelector<HTMLElement>('[data-double]');
  if (dbl && !boxStyle) {
    dbl.hidden = !v.doubleNow;
    const html = v.doubleNow ? `<b>ORA DUBLĂ ×2</b>${v.doubleSponsor ? ` · oferită de ${esc(v.doubleSponsor)}` : ''}` : '';
    if (dbl.innerHTML !== html) dbl.innerHTML = html;
  }
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Secret code on screen (needs ?key=…, or ?demo): big, for codeSecs or until it expires.
const codeEl = document.querySelector<HTMLElement>('[data-code]')!;
let shownCode = '';
let codeTimer: number | undefined;
function showCode(c: { code: string; sponsor: string | null; expires_at: string } | null) {
  if (!c) { if (shownCode) { codeEl.classList.remove('show'); shownCode = ''; } return; }
  if (c.code === shownCode) return;
  shownCode = c.code;
  codeEl.innerHTML = `COD SECRET<span class="code">${esc(c.code)}</span><small>Scrie-l pe ${esc(location.host)} pentru o rotire bonus${c.sponsor ? ` · oferit de ${esc(c.sponsor)}` : ''}</small>`;
  codeEl.classList.add('show');
  clearTimeout(codeTimer);
  const left = Math.max(5_000, Math.min(codeSecs * 1000, Date.parse(c.expires_at) - Date.now()));
  codeTimer = window.setTimeout(() => codeEl.classList.remove('show'), left);
}

// Wins pop up like events: "user a câștigat X de la Sponsor".
let lastWin = '';
function checkWin(first: boolean) {
  const w = data.recentWins[0];
  const key = w ? `${w.user}|${w.prize}|${data.recentWins.length}|${w.ago}` : '';
  const id = w ? `${w.user}|${w.prize}` : '';
  if (!first && w && id !== lastWin.split('#')[0] && key) popEvent('PREMIU', w.user, `a câștigat ${w.prize}`, undefined, w.sponsor ? `de la ${w.sponsor}` : undefined);
  lastWin = id + '#';
}

// A new #1 (or a new name in the top 5) on a legend board gets its own big alert.
const legendLabels = { donations: 'donații', gifts: 'subs dăruite', bits: 'biți' } as const;
let prevLegends: Record<string, string[]> | null = null;
function checkLegends() {
  const now = Object.fromEntries((Object.keys(legendLabels) as (keyof typeof legendLabels)[]).map((k) => [k, data.boards[k].slice(0, 5).map((r) => r[0])]));
  const before = prevLegends;
  prevLegends = now;
  if (!before) return;
  for (const k of Object.keys(legendLabels) as (keyof typeof legendLabels)[]) {
    const [top] = now[k];
    if (top && before[k].length && top !== before[k][0]) popEvent('LEGENDĂ NOUĂ', top, `urcă pe locul 1 la ${legendLabels[k]}`, 10_000, undefined, true);
    else {
      const fresh = now[k].find((n) => !before[k].includes(n));
      if (fresh && before[k].length) popEvent('LEGENDĂ NOUĂ', fresh, `intră în top 5 la ${legendLabels[k]}`, 8_000, undefined, true);
    }
  }
}

// A calm partner mention every few minutes (10 s), when nothing else is showing.
// (?demo&brand=… shows another brand, for the sponsor presentation; ?promoNow shows it at once.)
const promoName = (params.has('demo') && params.get('brand')) || site.sponsor.name;
const promoCode = params.has('demo') && params.get('brand') ? (promoName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '10') : site.sponsor.code;
const promo = () => { if (!showing && !queue.length) popEvent('PARTENER', promoName, promoCode ? `cod ${promoCode}` : 'partenerul maratonului', 10_000); };
if (promoMinutes > 0 && promoName) window.setInterval(promo, promoMinutes * 60_000);
if (params.has('promoNow')) window.setTimeout(promo, 1500);

// Alerts queue up and play one after another, so a burst (five people gifting
// at once) shows every name. Big moments stay longer; when the queue grows,
// small ones speed up so the stream never falls minutes behind.
interface Alert { time: string; user: string; what: string; ms?: number; sub?: string; big?: boolean }
const queue: Alert[] = [];
const MAX_QUEUE = 40;
let showing = false;
let hideTimer: number | undefined;
function popEvent(time: string, user: string, what: string, ms?: number, sub?: string, big = false) {
  if (!show.has('events')) return;
  queue.push({ time, user, what, ms, sub, big });
  // Never let it grow without end: drop the oldest small alerts first.
  while (queue.length > MAX_QUEUE) {
    const i = queue.findIndex((a) => !a.big);
    queue.splice(i < 0 ? 0 : i, 1);
  }
  if (!showing) nextAlert();
}
function nextAlert() {
  const a = queue.shift();
  if (!a) { showing = false; return; }
  showing = true;
  eventEl.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = a.time;
  eventEl.append(b, ` ${a.user} · ${a.what}`);
  if (a.sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = a.sub; eventEl.append(s); }
  eventEl.classList.toggle('big', !!a.big);
  eventEl.classList.add('show');
  const base = a.ms ?? (a.big ? 10_000 : boxStyle ? 8000 : 6000);
  const ms = a.big ? base : queue.length >= 10 ? 2000 : queue.length >= 3 ? 3000 : base;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    eventEl.classList.remove('show');
    window.setTimeout(nextAlert, 450); // let the fade-out finish
  }, ms);
}

/** Queue new events (oldest first) and move the mark; the first load only sets the mark. */
function queueEvents(items: TickerItem[], first: boolean) {
  for (const t of items) {
    if (t.id === undefined || (lastId !== null && t.id <= lastId)) continue;
    if (!first && lastId !== null && t.time !== '—') popEvent(t.time, t.user, t.what, undefined, undefined, !!t.big);
    lastId = Math.max(lastId ?? 0, t.id);
  }
}

if (params.has('demo')) {
  void import('../demo/backend').then(({ DemoBackend }) => {
    const api = new DemoBackend();
    let firstSync = true;
    const sync = () => {
      data = api.toSiteData();
      checkWin(firstSync); firstSync = false;
      const cc = api.currentCode();
      showCode(cc ? { code: cc.code, sponsor: cc.sponsor, expires_at: new Date(cc.expiresAt).toISOString() } : null);
      // Every event newer than the mark, straight from the demo state (not just the 12 in the ticker).
      queueEvents(api.state.events.filter((e) => lastId === null || e.id > lastId).reverse().map(tickerItem), lastId === null);
      checkLegends();
      draw();
    };
    api.subscribe(sync);
    sync();
    // A burst of writes from another tab can coalesce into fewer notifications: catch up anyway.
    window.setInterval(sync, 2000);
    // Show the chip once on load, so its place on the stream is visible.
    const first = data.ticker[0];
    if (first && !params.has('promoNow')) window.setTimeout(() => popEvent(first.time, first.user, first.what), 600);
  });
} else {
  void import('./live').then(({ Live }) => {
    const live = new Live(data, {
      onData(patch, first) {
        data = { ...data, ...patch };
        // Pop up only events that arrive while the overlay is open, every one of them.
        if (patch.ticker) {
          const newest = [...data.ticker].reverse();
          if (first || lastId === null) queueEvents(newest, true);
          else void live.feedSince(lastId).then((items) => queueEvents(items, false));
        }
        checkWin(first);
        if (patch.boards) checkLegends();
        draw();
      },
      onMe() {},
    }, { intervalMs: 3000, pollHidden: true }); // OBS: snappy alerts, never paused
    void live.start();
    if (overlayKey) {
      const poll = async () => {
        const { data: rows } = await live.overlayCode(overlayKey);
        showCode(rows?.[0] ?? null);
      };
      void poll();
      window.setInterval(() => void poll(), 8_000);
    }
  });
}
setInterval(draw, 1000);
draw();
