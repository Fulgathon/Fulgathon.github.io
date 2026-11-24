// «Camera de control» (/overlay/?scene=control): one OBS Browser Source, 1920×1080, transparent.
// Iceman's background photo sits under it in OBS; the game capture and the webcam go in the two
// framed holes (positions in HOLES below and on /mod → SETĂRI → Overlay OBS). On top it draws:
//   the timer (status, clock, Strâns towards the next milestone) · «Donează și alegi» (the price
//   list and the requests waiting, from part 'tasks') · the sponsor strip (main partner fixed,
//   partners and supporters two at a time in a slow carousel) · notices for each event ·
//   snow that stays faint and reacts: a sub puffs out of the webcam, bits twinkle, a donation
//   bursts from the timer (bigger for bigger amounts), a gift wave blows a blizzard across.
// Tests from /mod: «Testează pe stream» (part 'otest') plays the reactions with «TEST» names and a
// sample request in «Urmează»; «Repetiție» drives the clock (yellow TEST tag) and its test donations react.
// ?calm=1 (or reduced motion): no snow, no slides. ?frame=1: outlines the holes, for placing the
// sources. ?demo: sample data (window.__sc.sub() / bits() / gift(n) / donate(n) to try reactions).

import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData, Sponsor, TickerItem } from '../data/types';
import { visibleSponsors } from '../lib/sponsorViews';
import { tickerItem } from '../lib/events';
import { derive, initialState } from '../lib/derive';

const params = new URLSearchParams(location.search);
const calm = params.has('calm') || matchMedia('(prefers-reduced-motion: reduce)').matches;
const demo = params.has('demo');

/** Where the OBS sources go (px in the 1920×1080 scene). */
export const HOLES = { game: { x: 58, y: 54, w: 1152, h: 648 }, cam: { x: 1325, y: 54, w: 518, h: 291 } };
const BOX = { timer: { x: 1325, y: 360, w: 518, h: 208 }, tasks: { x: 1325, y: 584, w: 518, h: 388 }, spon: { x: 58, y: 745, w: 1152, h: 227 } };

document.getElementById('compact')!.hidden = true;
const root = document.getElementById('control')!;
root.hidden = false;
document.body.classList.add('scene-control');
document.body.classList.toggle('calm', calm);
document.body.classList.toggle('frame', params.has('frame'));

const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const pos = (b: { x: number; y: number; w: number; h: number }) => `left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px`;
const euro = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';

// The background photo (uploaded on /mod) is drawn here, with the game and webcam places cut out, so
// the sponsor strip can be real frosted glass over it. OBS: game and webcam under this source.
const cut = (b: { x: number; y: number; w: number; h: number }) => `M${b.x} ${b.y}H${b.x + b.w}V${b.y + b.h}H${b.x}Z`;
const CLIP = `path(evenodd, 'M0 0H1920V1080H0Z ${cut(HOLES.game)} ${cut(HOLES.cam)}')`;

root.innerHTML = `
  <div class="scc-bg" data-bg style="clip-path:${CLIP}"></div>
  <div class="scc-hole" id="scc-game" style="${pos(HOLES.game)}"><span>GAME · ${HOLES.game.w}×${HOLES.game.h} la ${HOLES.game.x},${HOLES.game.y}</span></div>
  <div class="scc-hole" id="scc-cam" style="${pos(HOLES.cam)}"><span>WEBCAM · ${HOLES.cam.w}×${HOLES.cam.h} la ${HOLES.cam.x},${HOLES.cam.y}</span></div>
  <section class="scc-panel scc-timer" id="scc-timer" style="${pos(BOX.timer)}">
    <p class="scc-tline"><span class="scc-tag" data-tag>LIVE</span><span class="scc-by" data-by></span></p>
    <div class="scc-clock" data-clock>${['ZILE', 'ORE', 'MIN', 'SEC'].map((u, i) => `${i ? '<i class="scc-colon">:</i>' : ''}<div class="scc-cg"><b data-cg="${i}">00</b><span>${u}</span></div>`).join('')}</div>
    <p class="scc-raised"><span>Strâns</span><b data-raised>0 €</b></p>
  </section>
  <section class="scc-panel scc-tasks" id="scc-tasks" style="${pos(BOX.tasks)}">
    <p class="scc-lbl">Donează și alegi</p>
    <div class="scc-menu" data-menu></div>
    <p class="scc-qhead"><span class="scc-lbl dim">Urmează</span><span class="scc-lbl" data-pending>0</span></p>
    <div class="scc-queue" data-queue></div>
  </section>
  <section class="scc-panel scc-spon" id="scc-spon" style="${pos(BOX.spon)}">
    <div class="scc-logo main" data-main></div>
    <div class="scc-car p" data-partners></div>
    <div class="scc-car s" data-supp></div>
  </section>
  <canvas class="scc-snow" data-snow width="1920" height="1080"></canvas>
  <div class="scc-toast" data-toast style="left:${HOLES.cam.x + 16}px;top:${HOLES.cam.y + HOLES.cam.h - 46}px;max-width:${HOLES.cam.w - 32}px"></div>
  <div class="scc-warm" data-warm></div>
  <div class="scc-frost" data-frost></div>`;

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const setText = (el: HTMLElement, t: string) => { if (el.textContent !== t) el.textContent = t; };

// Previews in a browser window smaller than 1920×1080: scale the whole scene down (OBS is exactly 1920×1080).
function fit() {
  const k = Math.min(innerWidth / 1920, innerHeight / 1080);
  root.style.transform = k < 0.999 ? `scale(${k})` : '';
}
addEventListener('resize', fit);
fit();

let data: SiteData = emptyData();

// ---- Timer ------------------------------------------------------------------------
// «Repetiție» on /mod: before the marathon the practice clock takes over (the real one is untouched).
const rehearsing = (d: SiteData) => !!d.rehearsal && d.rehearsal.until > Date.now() && (d.status !== 'live' || demo);
function view(d: SiteData): SiteData {
  if (!rehearsing(d)) return d;
  const r = d.rehearsal!;
  return { ...d, loaded: true, status: 'live', endsAt: r.endsAt, pausedUntil: r.pausedUntil, doubleFrom: r.doubleFrom, doubleUntil: r.doubleUntil, doubleSponsor: r.doubleUntil ? d.doubleSponsor ?? null : null };
}
function drawTimer() {
  const d = view(data);
  const v = derive({ ...initialState(), now: Date.now() }, d);
  const st = !d.status || d.status === 'upcoming' ? 'upcoming' : d.status === 'ended' ? 'ended' : v.isFrozen ? 'frozen' : v.doubleNow ? 'double' : 'live';
  const test = !!data.testMode || rehearsing(data);
  const tag = $('[data-tag]');
  setText(tag, st === 'double' ? '×2 ORA DUBLĂ' : st === 'frozen' ? 'ÎNGHEȚAT' : st === 'ended' ? 'TIMPUL A EXPIRAT' : st === 'upcoming' ? 'ÎNCEPE ÎN' : test ? 'TEST' : 'LIVE');
  tag.dataset.state = test && st === 'live' ? 'test' : st;
  setText($('[data-by]'), st === 'double' && d.doubleSponsor ? `de la ${d.doubleSponsor}` : '');
  [v.dd, v.hh, v.mm, v.ss].forEach((x, i) => setText($(`[data-cg="${i}"]`), x));
  root.dataset.state = st;
  // The whole sum raised so far (not the step to the next milestone).
  setText($('[data-raised]'), data.raised || '0 €');
}

// ---- Sponsors: main fixed, partners + supporters two at a time -----------------------
type Logo = { name: string; logo: string | null };
const logoHtml = (s: Logo | null, cls = '') => `<div class="scc-logo ${cls}">${s?.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">` : `<span>${esc((s?.name || 'LOGO').toUpperCase())}</span>`}</div>`;
function sponsorLists(): { main: Logo | null; partners: Logo[]; supp: Logo[] } {
  const list: Sponsor[] | null = data.sponsors ? visibleSponsors(data.sponsors, Date.now(), 'overlay') : null;
  if (list) {
    const pick = (t: Sponsor['tier']) => list.filter((s) => s.tier === t).map((s) => ({ name: s.name, logo: s.logo }));
    return { main: pick('main')[0] ?? null, partners: pick('partner'), supp: pick('supporter') };
  }
  // Nothing saved on /mod yet: the main partner from src/data/site.ts, empty «LOGO» slots for the rest.
  return { main: { name: site.sponsor.logoText || site.sponsor.name, logo: site.sponsor.logo || null }, partners: [], supp: [] };
}
class Carousel {
  private off = 0;
  private key = '';
  private list: Logo[] = [];
  constructor(private el: HTMLElement) {}
  set(list: Logo[]) {
    const padded = list.length >= 2 ? list : [...list, ...Array.from({ length: 2 - list.length }, () => ({ name: 'LOGO', logo: null }))];
    const key = JSON.stringify(padded);
    if (key === this.key) return;
    this.key = key; this.list = padded; this.off = 0;
    this.el.innerHTML = this.page(0);
  }
  private page(off: number) { return `<div class="scc-pg">${[0, 1].map((i) => logoHtml(this.list[(off + i) % this.list.length])).join('')}</div>`; }
  next() {
    if (this.list.length <= 2) return;
    this.off = (this.off + 2) % this.list.length;
    const old = this.el.firstElementChild as HTMLElement | null;
    this.el.insertAdjacentHTML('beforeend', this.page(this.off));
    const nw = this.el.lastElementChild as HTMLElement;
    if (!old) return;
    if (calm) { old.remove(); nw.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 600 }); return; }
    const o: KeyframeAnimationOptions = { duration: 900, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' };
    old.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-108%)' }], o).onfinish = () => old.remove();
    nw.animate([{ transform: 'translateX(108%)' }, { transform: 'translateX(0)' }], o);
  }
}
const partners = new Carousel($('[data-partners]'));
const supp = new Carousel($('[data-supp]'));
let mainKey = '';
function drawSponsors() {
  const s = sponsorLists();
  const key = JSON.stringify(s.main);
  if (key !== mainKey) { mainKey = key; $('[data-main]').outerHTML = logoHtml(s.main, 'main').replace('class="scc-logo main"', 'class="scc-logo main" data-main'); }
  partners.set(s.partners);
  supp.set(s.supp);
  $('[data-main]').classList.toggle('lit', root.dataset.state === 'double' && !!view(data).doubleSponsor);
}
window.setInterval(() => partners.next(), 8000);
window.setTimeout(() => window.setInterval(() => supp.next(), 8000), 1500);

// ---- «Donează și alegi» -------------------------------------------------------------
const knownTasks = new Set<number>();
let testReq: { item: { id: number; price: number; title: string; name: string; at: number }; until: number } | null = null;
let tasksFirst = true;
let menuKey = '';
function drawTasks() {
  const t = data.tasks;
  const menu = t?.menu ?? [];
  const mk = JSON.stringify(menu);
  if (mk !== menuKey) {
    menuKey = mk;
    $('[data-menu]').innerHTML = menu.length
      ? menu.map((m) => `<div class="scc-row" data-price="${m.price}"><span>${esc(m.title)}</span><b>${euro(m.price)}</b></div>`).join('')
      : '<p class="scc-more">Lista se completează pe /mod.</p>';
  }
  // «Testează pe stream»: a sample request on top for a few seconds (never stored).
  const queue = [...(testReq && testReq.until > Date.now() ? [testReq.item] : []), ...(t?.queue ?? [])];
  const pending = (t?.pending ?? (t?.queue ?? []).length) + (queue.length > (t?.queue ?? []).length ? 1 : 0);
  const fresh = queue.filter((q) => !knownTasks.has(q.id));
  queue.forEach((q) => knownTasks.add(q.id));
  const box = $('[data-queue]');
  const item = (q: (typeof queue)[number]) => `<div class="scc-q${!tasksFirst && fresh.includes(q) ? ' new' : ''}"><b>${euro(q.price)}</b><span><i>${esc(q.name)}</i> · ${esc(q.title)}</span></div>`;
  if (!queue.length) box.innerHTML = '<p class="scc-more">Nimic deocamdată.</p>';
  else {
    // As many whole requests as fit, then «+N în așteptare».
    let n = queue.length;
    box.innerHTML = queue.map(item).join('') + (pending > n ? `<p class="scc-more">+${pending - n} în așteptare</p>` : '');
    while (n > 0 && box.scrollHeight > box.clientHeight + 1) {
      n--;
      box.innerHTML = queue.slice(0, n).map(item).join('') + `<p class="scc-more">+${pending - n} în așteptare</p>`;
    }
  }
  setText($('[data-pending]'), String(pending));
  $('[data-pending]').classList.toggle('on', pending > 0);
  if (!tasksFirst) for (const q of fresh) {
    $(`[data-price="${q.price}"]`)?.animate([{ background: 'rgba(63,208,255,.28)' }, { background: 'transparent' }], { duration: 1600 });
    $('#scc-tasks').animate([{ borderColor: '#3FD0FF' }, { borderColor: '#1E4560' }], { duration: 1600 });
    window.setTimeout(() => toast(`${q.name} a ales: ${q.title}`), 1600);
  }
  tasksFirst = false;
}

// ---- Notices -------------------------------------------------------------------------
const toastQ: string[] = [];
let toastBusy = false;
function toast(text: string) {
  toastQ.push(text);
  if (toastQ.length > 6) toastQ.shift();
  if (!toastBusy) void nextToast();
}
async function nextToast() {
  const el = $('[data-toast]');
  const text = toastQ.shift();
  if (text === undefined) { toastBusy = false; return; }
  toastBusy = true;
  el.textContent = text;
  el.classList.add('show');
  await new Promise((r) => setTimeout(r, 2800));
  el.classList.remove('show');
  await new Promise((r) => setTimeout(r, 450));
  void nextToast();
}

// ---- Snow ------------------------------------------------------------------------------
type Flake = { k: 'f' | 'b' | 'g'; x: number; y: number; r: number; v?: number; vx?: number; vy?: number; a?: number; ph: number; life: number; col?: string; amb?: boolean };
const cv = $<HTMLCanvasElement>('[data-snow]');
const cx = cv.getContext('2d')!;
let P: Flake[] = [];
let wind = 0;
const W = 1920, H = 1080;
const centerOf = (b: { x: number; y: number; w: number; h: number }) => [b.x + b.w / 2, b.y + b.h / 2, b.w, b.h] as const;
function fall(n: number, big = 1, fast = 1) {
  for (let i = 0; i < n; i++) P.push({ k: 'f', x: Math.random() * W * 1.1 - W * 0.05, y: -Math.random() * H * 0.6 - 6, r: (Math.random() * 1.6 + 1) * big, v: (Math.random() * 1.1 + 1) * fast, a: Math.random() * 0.4 + 0.45, ph: Math.random() * 6, life: 1 });
}
function burst(b: { x: number; y: number; w: number; h: number }, n: number, spd: number, col: string) {
  const [x0, y0, w, h] = centerOf(b);
  for (let i = 0; i < n; i++) {
    const an = Math.random() * Math.PI * 2, sp = (Math.random() * 0.7 + 0.3) * spd;
    P.push({ k: 'b', x: x0 + (Math.random() - 0.5) * w * 0.6, y: y0 + (Math.random() - 0.5) * h * 0.6, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp - 1.2, r: Math.random() * 2.2 + 1.2, col, ph: 0, life: 1 });
  }
}
function glints(n: number) {
  for (let i = 0; i < n; i++) P.push({ k: 'g', x: Math.random() * W, y: -Math.random() * H * 0.5 - 6, r: Math.random() * 1.4 + 1, v: Math.random() * 0.9 + 1.1, ph: Math.random() * 6, life: 1 });
}
function loop() {
  if (Math.random() < 0.05) P.push({ k: 'f', x: Math.random() * W, y: -6, r: Math.random() * 1.6 + 0.9, v: Math.random() * 0.45 + 0.45, a: Math.random() * 0.2 + 0.15, ph: Math.random() * 6, life: 1, amb: true });
  wind *= 0.985;
  cx.clearRect(0, 0, W, H);
  P = P.filter((p) => {
    p.ph += 0.03;
    if (p.k === 'b') {
      p.vx! *= 0.95; p.vy = p.vy! * 0.95 + 0.09; p.x += p.vx! + wind * 1.8; p.y += p.vy; p.life -= 0.008;
      cx.fillStyle = p.col!.replace('A', (p.life * 0.95).toFixed(2));
    } else if (p.k === 'g') {
      p.y += p.v!; p.x += Math.sin(p.ph) * 0.55 + wind * 1.8;
      const tw = 0.45 + 0.55 * Math.abs(Math.sin(p.ph * 2.4));
      cx.fillStyle = `rgba(190,240,255,${tw})`;
      if (tw > 0.85) { cx.fillRect(p.x - p.r * 2.4, p.y - 0.7, p.r * 4.8, 1.4); cx.fillRect(p.x - 0.7, p.y - p.r * 2.4, 1.4, p.r * 4.8); }
    } else {
      p.y += p.v! * (1 + Math.abs(wind) * 0.35); p.x += wind * (p.amb ? 1.8 : 2.5) + Math.sin(p.ph * 0.4) * 0.28;
      cx.fillStyle = `rgba(223,246,255,${p.a})`;
    }
    cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill();
    return p.life > 0 && p.y < H + 8 && p.x > -60 && p.x < W + 60;
  });
  if (P.length > 1600) P.splice(0, P.length - 1600);
  requestAnimationFrame(loop);
}
if (!calm) requestAnimationFrame(loop);

// ---- Events: each one gets its own reaction ----------------------------------------------
let lastId: number | null = null;
function react(t: TickerItem) {
  const qty = t.qty ?? 0;
  toast(`${t.user} · ${t.what}${t.time !== '—' ? ` · ${t.time}` : ''}`);
  if (!calm && t.time !== '—') root.querySelectorAll<HTMLElement>('[data-cg]').forEach((b) => b.animate([{ color: '#3FD0FF' }, { color: '' }], { duration: 900 }));
  if (calm) return;
  if (t.kind === 'sub' || t.kind === 'resub') { burst(HOLES.cam, 22, 3.6, 'rgba(223,246,255,A)'); fall(30); }
  else if (t.kind === 'bits') glints(Math.min(120, 20 + Math.round(qty / 16)));
  else if (t.kind === 'gift') { wind = Math.min(4.5, 1.8 + qty / 12); fall(Math.min(420, 60 + qty * 12), 1.1, 2.2); }
  else if (t.kind === 'donation') { burst(BOX.timer, Math.min(70, 16 + qty * 1.2), 3.4 + Math.min(qty, 100) / 18, 'rgba(63,208,255,A)'); fall(Math.min(120, 10 + qty * 2.4), 1.5, 1.1); }
}
function queueEvents(items: TickerItem[], first: boolean) {
  for (const t of items) {
    if (t.id === undefined || (lastId !== null && t.id <= lastId)) continue;
    if (!first && lastId !== null) react(t);
    lastId = Math.max(lastId ?? 0, t.id);
  }
}

// ---- Tests from /mod ------------------------------------------------------------------------
let testSeq = 0;
const testItem = (kind: string, qty: number, secs: number) =>
  tickerItem({ id: -(++testSeq), kind, tier: '1000', quantity: qty, currency: 'EUR', seconds_added: secs, user_name: 'TEST', user_login: null });
const later = (ms: number, f: () => void) => window.setTimeout(f, ms);
function testRequest() {
  const menu = data.tasks?.menu ?? [];
  const m = menu.find((x) => x.price === 10) ?? menu[0];
  if (!m) return;
  testReq = { item: { id: -1, price: m.price, title: m.title, name: 'TEST', at: Date.now() }, until: Date.now() + 12_000 };
  drawTasks();
  later(12_100, () => { testReq = null; drawTasks(); });
}
function runTest(kind: string) {
  if (kind === 'event') {
    react(testItem('sub', 1, 360));
    later(1400, () => react(testItem('bits', 400, 240)));
    later(2800, () => { react(testItem('donation', 10, 3600)); testRequest(); });
  } else if (kind === 'gift') {
    react(testItem('gift', 20, 7200));
  } else if (kind === 'moments') {
    react(testItem('donation', 50, 18000));
    later(1600, () => react(testItem('gift', 20, 7200)));
    later(3200, () => testRequest());
  } else if (kind === 'promo') {
    $('#scc-spon').animate([{ borderColor: 'rgba(230,196,106,.8)' }, { borderColor: '' }], { duration: 2400 });
    toast('TEST · banda sponsorilor');
  } else if (kind === 'code') {
    toast('TEST · codul secret apare doar pe scena întreagă veche, cu cheie');
  }
}
let lastRehearsalN = -1;
function rehearsalEvents() {
  const last = data.rehearsal?.last;
  if (!rehearsing(data) || !last) { if (!data.rehearsal) lastRehearsalN = -1; return; }
  if (lastRehearsalN === -1) { lastRehearsalN = last.n; return; }
  if (last.n <= lastRehearsalN) return;
  lastRehearsalN = last.n;
  react(tickerItem({ id: -(100000 + last.n), kind: last.kind, tier: '1000', quantity: last.amount, currency: 'EUR', seconds_added: last.seconds, user_name: last.user, user_login: null }));
}

// ---- Data ---------------------------------------------------------------------------------
let bgUrl: string | null = null;
function drawBackground() {
  const url = data.scene?.bg ?? null;
  if (url === bgUrl) return;
  bgUrl = url;
  const el = $('[data-bg]');
  if (!url) { el.innerHTML = ''; root.classList.remove('has-bg'); return; }
  const img = new Image();
  img.alt = '';
  img.onload = () => { if (bgUrl === url) { el.replaceChildren(img); root.classList.add('has-bg'); } };
  img.src = url;
}
function drawAll() {
  rehearsalEvents();
  drawBackground();
  drawTimer();
  drawSponsors();
  drawTasks();
  $('[data-warm]').classList.toggle('on', root.dataset.state === 'double');
  $('[data-frost]').classList.toggle('on', root.dataset.state === 'frozen');
}
window.setInterval(drawTimer, 1000);

if (demo) {
  void import('../demo/backend').then(({ DemoBackend }) => {
    const api = new DemoBackend();
    let first = true;
    let lastTest = api.state.overlayTest?.n ?? 0;
    const sync = () => {
      const ot = api.state.overlayTest;
      if (ot && ot.n > lastTest) { lastTest = ot.n; if (Date.now() - ot.at < 60_000) runTest(ot.kind); }
      data = api.toSiteData();
      queueEvents(api.state.events.filter((e) => lastId === null || e.id > lastId).reverse().map(tickerItem), first);
      drawAll();
      first = false;
    };
    api.subscribe(sync);
    sync();
    window.setInterval(sync, 2000);
    const names = ['kxtrin', 'vladutz97', 'andreiGG', 'Rares1337', 'ioana_plays'];
    const who = () => names[Math.floor(Math.random() * names.length)];
    (window as unknown as { __sc: unknown }).__sc = {
      sub: () => api.recordEvent('sub', who(), '1000'),
      bits: (n = 400) => api.recordEvent('bits', who(), null, n),
      gift: (n = 20) => api.recordEvent('gift', who(), '1000', n),
      donate: (n = 10) => api.recordEvent('donation', who(), null, n, 'EUR'),
      done: () => { const q = api.toSiteData().tasks?.queue[0]; if (q) api.rpc('mod_task_done', { p_id: q.id, p_done: true }); },
      /** The /mod buttons, on the demo backend: test('event' | 'gift' | 'moments' | 'promo' | 'code'), rehearsal('start' | 'donation' | 'stop' …). */
      test: (kind = 'event') => api.rpc('mod_overlay_test', { p_kind: kind }),
      rehearsal: (action = 'start', minutes?: number) => api.rpc('mod_rehearsal', { p_action: action, p_minutes: minutes ?? null }),
    };
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
        drawAll();
      },
      onMe() {},
      onTest(t) { if (Date.now() - Date.parse(t.at) < 60_000) runTest(t.kind); },
    }, { intervalMs: 3000, pollHidden: true });
    void live.start();
  });
}
drawAll();
