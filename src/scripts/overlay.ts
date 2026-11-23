// OBS overlay: same live data and maths as the site (Live + derive).
// Default is a slim strip in a corner; ?style=box gives the large box.
// ?demo reads the simulated backend shared with /?demo, /mod/?demo and
// /prezentare/ (events fired there pop up here), for presentations and for
// placing the overlay in OBS before the subathon.

import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData } from '../data/types';
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
document.documentElement.style.setProperty('--scale', String(scale));

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
let lastTop = '';

function draw() {
  const v = derive({ ...initialState(), now: Date.now() }, data);
  const set = (sel: string, text: string) => all(sel).forEach((el) => { if (el.textContent !== text) el.textContent = text; });
  set('[data-clock]', v.navClock);
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) set(`[data-unit="${k}"]`, v[k]);
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

// A calm partner mention every few minutes (10 s), when nothing else is showing.
// (?demo&brand=… shows another brand, for the sponsor presentation; ?promoNow shows it at once.)
const promoName = (params.has('demo') && params.get('brand')) || site.sponsor.name;
const promoCode = params.has('demo') && params.get('brand') ? (promoName.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() + '10') : site.sponsor.code;
const promo = () => { if (!eventEl.classList.contains('show')) popEvent('PARTENER', promoName, promoCode ? `cod ${promoCode}` : 'partenerul maratonului', 10_000); };
if (promoMinutes > 0 && promoName) window.setInterval(promo, promoMinutes * 60_000);
if (params.has('promoNow')) window.setTimeout(promo, 1500);

let hideTimer: number | undefined;
function popEvent(time: string, user: string, what: string, ms?: number, sub?: string) {
  if (!show.has('events')) return;
  eventEl.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = time;
  eventEl.append(b, ` ${user} · ${what}`);
  if (sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = sub; eventEl.append(s); }
  eventEl.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => eventEl.classList.remove('show'), ms ?? (boxStyle ? 8000 : 6000));
}

if (params.has('demo')) {
  void import('../demo/backend').then(({ DemoBackend }) => {
    const api = new DemoBackend();
    let lastId = api.state.events[0]?.id ?? 0;
    let firstSync = true;
    const sync = () => {
      data = api.toSiteData();
      checkWin(firstSync); firstSync = false;
      const cc = api.currentCode();
      showCode(cc ? { code: cc.code, sponsor: cc.sponsor, expires_at: new Date(cc.expiresAt).toISOString() } : null);
      const top = api.state.events[0];
      if (top && top.id !== lastId) {
        lastId = top.id;
        const t = data.ticker[0];
        if (t && t.time !== '—') popEvent(t.time, t.user, t.what);
      }
      draw();
    };
    api.subscribe(sync);
    sync();
    // Show the chip once on load, so its place on the stream is visible.
    const first = data.ticker[0];
    if (first && !params.has('promoNow')) window.setTimeout(() => popEvent(first.time, first.user, first.what), 600);
  });
} else {
  void import('./live').then(({ Live }) => {
    const live = new Live(data, {
      onData(patch, first) {
        data = { ...data, ...patch };
        const top = data.ticker[0];
        const key = top ? `${top.time}|${top.user}|${top.what}` : '';
        // Pop up only events that arrive while the overlay is open.
        if (!first && top && key !== lastTop && top.time !== '—') popEvent(top.time, top.user, top.what);
        lastTop = key;
        checkWin(first);
        draw();
      },
      onMe() {},
    });
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
