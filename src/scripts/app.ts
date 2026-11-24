// Client side: holds the state, re-derives the values on every change and
// writes them into the page through small data-* bindings:
//
//   data-text="key"           textContent = vals[key]
//   data-if="key"             hidden = !vals[key]
//   data-style="prop:key;…"   style.setProperty(prop, vals[key])
//   data-attr="attr:key;…"    setAttribute(attr, vals[key])
//   data-toggle="cls:key"     classList.toggle(cls, !!vals[key])
//   data-region="name"        innerHTML = views[name](vals), only when it changed
//   data-action="name"        click handler (data-arg is passed along)
//
// Two modes:
//   * normal: live data from Supabase (./live.ts, loaded lazily), real actions.
//   * ?demo:  the simulated backend (../demo/backend.ts): same rules, kept in
//             the browser and shared with /mod/?demo and /overlay/?demo; a
//             panel switches viewer and stream states and fakes Twitch events.
//             ?demo&embed hides the panel (used inside /prezentare/).

import './motion';
import { morph } from '../lib/morph';
import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData } from '../data/types';
import { derive, initialState, type State } from '../lib/derive';
import { count, duration, fmtInt } from '../lib/format';
import { views, type RegionName } from '../lib/views';
import { codeOf, mainOf, partnerWallHtml, sponsorKey, sponsorLineHtml, visibleSponsors } from '../lib/sponsorViews';
import { LineBag, fillLine, groupFor, varsFor } from '../lib/lines';
import { FALLBACK_LINE } from '../data/content';
import type { TickerItem } from '../data/types';
import type { DemoBackend } from '../demo/backend';
import type { Live, Me } from './live';

type AnyVals = Record<string, unknown>;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const embed = params.has('embed');
// /demo: the sponsor showcase (?demo=showcase). Fresh and busy on every visit, no demo panel.
const showcase = params.get('demo') === 'showcase';
const BINGO_KEY = 'icemaraton:bingo-pick';

let data: SiteData = emptyData();
// state.demo shows the demo panel (not inside the presentation page).
let state: State = { ...initialState(), demo: demo && !embed && !showcase, now: Date.now() };
// Demo mode: fill the partner row and wall with the invented brands (src/data/demoSponsors.ts),
// so the page shows how it looks with every slot taken. The public page keeps the real list.
if (demo) {
  document.querySelectorAll<HTMLElement>('[data-demo]').forEach((slot) => {
    const tpl = document.getElementById(slot.dataset.demo!) as HTMLTemplateElement | null;
    if (tpl) slot.replaceChildren(tpl.content.cloneNode(true));
  });
}
let live: Live | null = null;
let demoApi: DemoBackend | null = null;
// /sponsori presentation: a visiting brand replaces the main partner; live sponsors stay out of the way.
let brandPreview = false;

if (!demo) state.bingoPick = loadPick();

const all = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
const pairs = (spec: string) => spec.split(';').filter(Boolean).map((p) => p.split(':') as [string, string]);

const texts = all('[data-text]');
const ifs = all('[data-if]');
const styles = all('[data-style]').map((el) => ({ el, list: pairs(el.dataset.style!) }));
const attrs = all('[data-attr]').map((el) => ({ el, list: pairs(el.dataset.attr!) }));
const toggles = all('[data-toggle]').map((el) => ({ el, list: pairs(el.dataset.toggle!) }));
const regions = all('[data-region]').map((el) => ({ el, name: el.dataset.region as RegionName }));

// The build rendered the regions from the empty initial state (src/lib/ssr.ts);
// start from those strings and only touch the DOM when something changes.
const builtVals = derive(initialState(), emptyData());
const lastHtml = new Map(regions.map(({ el, name }) => [el, views[name](builtVals)]));

const REBUILD = new Set<RegionName>(['heroRecent', 'ticker', 'todayFeed']);

// ---- Sponsors from /mod (public_state 'sponsors'); null = keep the list built from site.ts ----
let sponsorDrawn = '';
function drawSponsors() {
  if (!Array.isArray(data.sponsors) || brandPreview) return;
  const now = Date.now();
  const list = visibleSponsors(data.sponsors, now, 'site');
  const key = sponsorKey(list, now);
  if (key === sponsorDrawn) return;
  sponsorDrawn = key;
  const line = document.querySelector<HTMLElement>('.sponsor-line');
  if (line) line.innerHTML = sponsorLineHtml(list);
  const wall = document.querySelector<HTMLElement>('#parteneri [data-demo="pw-demo"]');
  if (wall) wall.innerHTML = partnerWallHtml(list);
  // The offer bar under the timer: updated in place (its text bindings stay alive).
  const main = mainOf(list);
  const bar = document.getElementById('oferta');
  if (!bar) return;
  const code = codeOf(main, now);
  bar.hidden = !main || (!code && !main.url && !main.description);
  if (!main) return;
  bar.querySelectorAll<HTMLElement>('[data-sponsor="name"]').forEach((el) => { el.textContent = main.name; });
  bar.querySelectorAll<HTMLElement>('[data-sponsor="code"]').forEach((el) => { el.textContent = code ?? ''; });
  const desc = bar.querySelector<HTMLElement>('[data-sponsor-desc]');
  if (desc) { desc.textContent = [main.description, code && main.codeNote ? `Cu codul: ${main.codeNote}.` : ''].filter(Boolean).join(' '); desc.hidden = !desc.textContent; }
  const soc = bar.querySelector<HTMLElement>('[data-sponsor-soc]');
  if (soc) {
    const names: Record<string, string> = { website: 'Site', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', discord: 'Discord' };
    soc.replaceChildren(...Object.entries(main.socials ?? {}).filter(([, u]) => u).map(([k, u]) => {
      const a = document.createElement('a');
      a.href = u!; a.textContent = names[k] ?? k; a.target = '_blank'; a.rel = 'noopener'; a.dataset.track = `${main.name}|click`;
      return a;
    }));
    soc.hidden = !soc.childElementCount;
  }
  const btn = bar.querySelector<HTMLElement>('[data-sponsor-code-btn]');
  if (btn) { btn.hidden = !code; btn.dataset.track = `${main.name}|code_copy`; }
  const cta = bar.querySelector<HTMLAnchorElement>('[data-sponsor-cta]');
  if (cta) {
    cta.hidden = !main.url;
    if (main.url) cta.href = main.url;
    cta.dataset.track = `${main.name}|click`;
    cta.textContent = `${main.cta || 'Vezi oferta'} →`;
  }
}

function render() {
  drawSponsors();
  const v = derive(state, data);
  const vals = v as unknown as AnyVals;

  for (const el of texts) {
    const s = String(vals[el.dataset.text!] ?? '');
    if (el.textContent !== s) el.textContent = s;
  }
  // toggleAttribute, not .hidden: SVG elements have no hidden property.
  for (const el of ifs) el.toggleAttribute('hidden', !vals[el.dataset.if!]);
  for (const { el, list } of styles) for (const [prop, key] of list) el.style.setProperty(prop, String(vals[key]));
  for (const { el, list } of attrs) {
    for (const [attr, key] of list) {
      const s = String(vals[key]);
      if (el.getAttribute(attr) !== s) el.setAttribute(attr, s);
    }
  }
  for (const { el, list } of toggles) for (const [cls, key] of list) el.classList.toggle(cls, Boolean(vals[key]));

  for (const { el, name } of regions) {
    const html = views[name](v);
    if (lastHtml.get(el) === html) continue;
    // Keep keyboard focus on the same control across the re-render.
    const active = document.activeElement as HTMLElement | null;
    const key = active && el.contains(active) ? active.dataset.key : undefined;
    // Live feeds are rebuilt (their newest row animates in); everything else is patched
    // in place so its transitions run (src/lib/morph.ts).
    if (REBUILD.has(name)) el.innerHTML = html; else morph(el, html);
    lastHtml.set(el, html);
    if (key) el.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
  }
}

// Keep the navbar on one row: collapse the links into the menu button
// whenever they don't fit, whatever the viewer chip or name length.
const nav = document.getElementById('main-nav');
function fitNav() {
  if (!nav) return;
  nav.classList.remove('nav-collapsed');
  if (nav.scrollWidth > nav.clientWidth + 1) nav.classList.add('nav-collapsed');
}
if (nav) new ResizeObserver(fitNav).observe(nav);
document.fonts?.ready.then(fitNav);

/** Moments (thanks, new legend) wait for the current message to close instead of replacing it. */
const pendingMoments: State['info'][] = [];
function moment(eyebrow: string, text: string) {
  if (state.toast) pendingMoments.push({ eyebrow, text });
  else set({ toast: 'info', info: { eyebrow, text } });
}

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  if (!state.toast && pendingMoments.length) state = { ...state, toast: 'info', info: pendingMoments.shift()! };
  render();
  if ('viewer' in patch || 'viewerName' in patch) fitNav();
}

// Countdowns: derived from the wall clock, so a throttled background tab
// still shows the right time when it comes back. clockOffset corrects a
// device whose clock is wrong (server time minus device time).
let clockOffset = 0;
setInterval(() => {
  const now = Date.now() + clockOffset;
  if (Math.floor(now / 1000) !== Math.floor(state.now / 1000)) set({ now });
}, 250);

// ---- Bingo: the 5 picks being chosen survive the Twitch login redirect. ----
function loadPick(): number[] {
  try {
    const p = JSON.parse(localStorage.getItem(BINGO_KEY) ?? 'null');
    if (Array.isArray(p)) return p.map(Number).filter(Number.isInteger).slice(0, 5);
  } catch { /* storage blocked */ }
  return [];
}
function storePick(pick: number[]) {
  if (demo) return;
  try { localStorage.setItem(BINGO_KEY, JSON.stringify(pick)); } catch { /* storage blocked */ }
}
/** A fresh saved pick from the server: show it, unless the viewer was mid-choice (e.g. before logging in). */
function withSaved(saved: number[] | null): Partial<State> {
  const draft = state.bingoPick;
  const changedBeforeLogin = state.bingoSaved === null && draft.length > 0 && !demo;
  return { bingoSaved: saved, ...(changedBeforeLogin || (saved === null && draft.length) ? {} : { bingoPick: saved ?? [] }) };
}

// ---- Messages for things that didn't work. ------------------------------
const errors: Record<string, string> = {
  not_logged_in: 'Conectează-te cu Twitch mai întâi.',
  not_subscribed: 'Asta e doar pentru abonați.',
  round_closed: 'Runda de vot s-a închis.',
  not_in_round: 'Provocarea nu mai e în runda asta.',
  no_spins: 'Nu ai rotire acum. Mai stai puțin!',
  wheel_closed: 'Roata se deschide odată cu maratonul.',
  not_subscriber: 'Roata e doar pentru abonați.',
  not_enough_watch: 'Ai nevoie de 2 ore de privit azi pentru rotire.',
  already_spun: 'Ai învârtit deja azi. Revino mâine!',
  bingo_closed: 'Alegerile pentru bingo s-au închis.',
  bad_code: 'Codul nu e bun sau a expirat. Verifică literele de pe stream.',
  already_claimed: 'Ai folosit deja codul ăsta.',
  too_many_attempts: 'Prea multe încercări. Mai încearcă peste un minut.',
  bad_pick: 'Alege o linie întreagă de pe cartonaș.',
  not_a_line: 'Alege un rând, o coloană sau o diagonală întreagă.',
  too_many: 'Ai trimis deja 3 propuneri. Mai încearcă peste câteva minute.',
  duplicate: 'Cineva a propus deja asta. Încearcă altceva.',
  blocked_text: 'Propunerea nu poate avea linkuri, numere de telefon sau cuvinte urâte.',
};
function info(eyebrow: string, text: string) {
  set({ toast: 'info', info: { eyebrow, text } });
}
function fail(err: unknown) {
  const msg = String((err as { message?: string })?.message ?? '');
  const key = Object.keys(errors).find((k) => msg.includes(k));
  info('Nu a mers', key ? errors[key] : 'Ceva n-a mers. Încearcă din nou.');
}


// ---- Hero: Iceman reacts to each new event (callout, hop, flash, «+18:00»). ----
const bag = new LineBag();
let heroLastId: number | null = null;
const heroQueue: TickerItem[] = [];
/** How long one reaction stays when others are waiting (typing + reading). */
const DWELL = 3200;
let heroTimer: number | undefined;   // the pending "next" step
let heroDue = 0;                     // when it fires (ms)
let heroHold = false;                // pointer or focus on the callout: wait
let heroPending = 0;                 // ms left while held

/** Edge colour per kind of support (subtle: a 3 px edge, the corner and the «+time»). */
const ACCENT: Record<string, string> = { sub: '#3FD0FF', sub23: '#9FE8FF', gift: '#F2F5FA', donSmall: '#3FD0FF', donBig: '#E6C46A', bits: '#B794FF' };

function bubbleFor(t: TickerItem): State['bubble'] {
  const group = groupFor(t, data.smallDonation);
  if (!group) return null;
  const vars = varsFor(t);
  // The server picks the line when it records the event (the same one goes to Twitch chat).
  const { line } = t.line !== undefined
    ? (t.line ? { line: t.line } : { line: FALLBACK_LINE })
    : bag.pick(group, data.lines[group]);
  // No line in Iceman's voice is ever invented: without his lines it says «Mersi, {nume}!».
  return { user: t.user, what: t.what, text: fillLine(line, vars), time: t.time, accent: ACCENT[group] ?? '#3FD0FF' };
}

/** Type the line in (the space is reserved by a hidden copy, so the callout doesn't grow). */
let typeTimer: number | undefined;
function typeLine(text: string, animate: boolean) {
  const ghost = document.querySelector<HTMLElement>('.bub-ghost');
  const typed = document.querySelector<HTMLElement>('.bub-typed');
  if (!ghost || !typed) return;
  clearInterval(typeTimer);
  ghost.textContent = text;
  const line = typed.parentElement!;
  if (!animate || reducedMotion.matches) { typed.textContent = text; line.classList.remove('typing'); return; }
  const chars = [...text];
  const step = Math.max(14, Math.min(32, 560 / chars.length));
  let n = 0;
  typed.textContent = '';
  line.classList.add('typing');
  typeTimer = window.setInterval(() => {
    n += 1;
    typed.textContent = chars.slice(0, n).join('');
    if (n >= chars.length) { clearInterval(typeTimer); window.setTimeout(() => line.classList.remove('typing'), 700); }
  }, step);
}
/** Restart the thin bar that shows when the next reaction comes. */
function restartBar(ms: number) {
  const bar = document.querySelector<HTMLElement>('.bub-bar > i');
  if (!bar) return;
  bar.style.setProperty('--d', `${ms}ms`);
  bar.style.animation = 'none';
  void bar.offsetWidth;
  bar.style.animation = '';
}

function heroSchedule(ms: number) {
  clearTimeout(heroTimer);
  heroTimer = undefined;
  if (heroHold) { heroPending = Math.max(ms, 1); return; }
  heroDue = Date.now() + ms;
  heroTimer = window.setTimeout(showNextHero, ms);
}
function showNextHero() {
  clearTimeout(heroTimer);
  heroTimer = undefined;
  heroPending = 0;
  const t = heroQueue.shift();
  if (!t) { set({ bubbleQueue: 0 }); return; }
  const bubble = bubbleFor(t);
  if (bubble) {
    set({ bubble, fx: state.fx + 1, bubbleQueue: heroQueue.length });
    typeLine(bubble.text, true);
  } else set({ bubbleQueue: heroQueue.length });
  // One reaction at a time, so a burst reads as a burst; reduced motion jumps to the newest.
  if (heroQueue.length) { const ms = reducedMotion.matches ? 0 : DWELL; restartBar(ms); heroSchedule(ms); }
}
/** New events since the last look: queue them (oldest first). The first load only shows the newest, without animation. */
function heroEvents(d: SiteData) {
  const real = d.ticker.filter((t) => t.id !== undefined && t.time !== '—');
  if (!real.length) return;
  const newest = Math.max(...real.map((t) => t.id!));
  if (heroLastId === null) {
    heroLastId = newest;
    const b = bubbleFor(real[0]);
    if (b) { set({ bubble: b }); typeLine(b.text, false); }
    return;
  }
  const fresh = real.filter((t) => t.id! > heroLastId!).sort((a, b) => a.id! - b.id!);
  heroLastId = Math.max(heroLastId, newest);
  if (!fresh.length) return;
  if (reducedMotion.matches) heroQueue.splice(0, heroQueue.length, fresh[fresh.length - 1]);
  else heroQueue.push(...fresh.slice(-12));
  if (heroTimer === undefined && !heroPending) {
    if (heroHold) { heroPending = 400; set({ bubbleQueue: heroQueue.length }); }
    else showNextHero();
  } else set({ bubbleQueue: heroQueue.length });
}
// Hovering or focusing the callout holds the queue (the bar pauses with it, in CSS).
{
  const callout = document.querySelector<HTMLElement>('.bubble');
  const hold = () => {
    if (heroHold) return;
    heroHold = true;
    if (heroTimer !== undefined) { heroPending = Math.max(1, heroDue - Date.now()); clearTimeout(heroTimer); heroTimer = undefined; }
  };
  const release = () => {
    if (!heroHold || callout?.matches(':hover, :focus-within')) return;
    heroHold = false;
    if (heroPending) { const ms = heroPending; heroPending = 0; heroSchedule(ms); }
  };
  callout?.addEventListener('pointerenter', hold);
  callout?.addEventListener('pointerleave', () => window.setTimeout(release));
  callout?.addEventListener('focusin', hold);
  callout?.addEventListener('focusout', () => window.setTimeout(release));
}

// ---- Live data ----------------------------------------------------------
const reachedGoals = (d: SiteData) => d.goals.filter((g) => d.raisedNum >= g.threshold).length;

// ---- Moments: "your sub added 6 minutes", "new legend". -------------------
const MINE_KEY = 'icemaraton:last-mine';
/** Thank the viewer once for their latest contribution, if it's fresh (15 min). */
function thankFor(e: Me['lastEvent']) {
  if (!e) return;
  let seen = 0;
  try { seen = Number(localStorage.getItem(MINE_KEY)) || 0; } catch { /* storage blocked */ }
  if (e.id <= seen) return;
  try { localStorage.setItem(MINE_KEY, String(e.id)); } catch { /* storage blocked */ }
  if (Date.now() - e.at > 15 * 60_000 || e.seconds <= 0) return;
  const t = duration(e.seconds);
  const text = e.kind === 'gift' ? (e.quantity === 1 ? `Subul dăruit de tine a adăugat ${t} la cronometru.` : `Cele ${count(e.quantity, 'sub', 'subs')} dăruite de tine au adăugat ${t} la cronometru.`)
    : e.kind === 'donation' ? `Donația ta de ${fmtInt(e.quantity)} € a adăugat ${t} la cronometru.`
    : e.kind === 'bits' ? `Cei ${count(e.quantity, 'bit', 'biți')} ai tăi au adăugat ${t} la cronometru.`
    : `Subul tău a adăugat ${t} la cronometru.`;
  moment('Mulțumim!', text);
}

/** Someone takes #1 or enters the top 5 of a legend board: celebrate it (not on the first load). */
const legendLabels = { donations: 'donații', gifts: 'subs dăruite', bits: 'biți' } as const;
let prevLegends: Record<string, string[]> | null = null;
function checkLegends(d: SiteData) {
  const now = Object.fromEntries((Object.keys(legendLabels) as (keyof typeof legendLabels)[]).map((k) => [k, d.boards[k].slice(0, 5).map((r) => r[0])]));
  const before = prevLegends;
  prevLegends = now;
  if (!before) return;
  for (const k of Object.keys(legendLabels) as (keyof typeof legendLabels)[]) {
    const [top] = now[k];
    if (top && before[k].length && top !== before[k][0]) { moment('Legendă nouă', `${top} urcă pe locul 1 la ${legendLabels[k]}!`); return; }
    const fresh = now[k].find((n) => !before[k].includes(n));
    if (fresh && before[k].length) { moment('Legendă nouă', `${fresh} intră în top 5 la ${legendLabels[k]}.`); return; }
  }
}

function applyMe(me: Me | null) {
  if (!me) {
    set({ viewer: 'out', viewerName: '', isPublic: true, mine: null, loyalty: null, spins: 0, watchedToday: 0, spunToday: false, bonusSpins: 0, myVote: null, result: null, suggestDone: false, bingoSaved: null });
    return;
  }
  set({
    ...withSaved(me.bingoSaved),
    viewer: me.isSub ? 'sub' : 'nonsub', viewerName: me.name, myVote: me.myVote, isPublic: me.isPublic,
    mine: me.mine, loyalty: me.loyalty,
    // Don't let a refresh jump the counter while the wheel is still turning.
    ...(state.spinning ? {} : { spins: me.spins, spunToday: me.spunToday }),
    watchedToday: me.watchedToday, bonusSpins: me.bonusSpins,
  });
  thankFor(me.lastEvent);
}

async function startLive() {
  const { Live } = await import('./live');
  live = new Live(data, {
    onData(patch, first) {
      const before = reachedGoals(data);
      data = { ...data, ...patch };
      const live = data.status === 'live';
      // Like the design: show the latest goal on arrival, and again whenever one unlocks.
      if (live && ((first && reachedGoals(data) > 0) || (!first && reachedGoals(data) > before))) set({ toast: 'goal' });
      else render();
      if (patch.boards) checkLegends(data);
      if (patch.ticker || first) heroEvents(data);
    },
    onMe: applyMe,
    // Only trust a clear difference: small ones are network noise.
    onClock(offset) { clockOffset = Math.abs(offset) > 2000 ? offset : 0; },
    onConn(failures) { if (failures !== state.connFailures) set({ connFailures: failures }); },
  });
  await live.start();
}
if (!demo) startLive().catch(() => { /* backend unreachable: the page stays on "starting soon" */ });

// ---- Demo backend ---------------------------------------------------------
function demoSync(first = false) {
  if (!demoApi) return;
  const before = reachedGoals(data);
  data = demoApi.toSiteData(Date.now());
  const me = demoApi.viewerInfo();
  const patch: Partial<State> = {
    ...(state.bingoSaved?.join() === me.bingoSaved?.join() ? {} : withSaved(me.bingoSaved)),
    viewer: me.state, viewerName: me.name, myVote: me.myVote,
    mine: me.state === 'out' ? null : me.mine, loyalty: me.state === 'out' ? null : me.loyalty,
    watchedToday: me.watchedToday, bonusSpins: me.bonusSpins,
    ...(state.spinning ? {} : { spins: me.spins, spunToday: me.spunToday }),
  };
  const unlocked = data.status === 'live' && (first ? reachedGoals(data) > 0 : reachedGoals(data) > before);
  set(unlocked ? { ...patch, toast: 'goal' } : patch);
  checkLegends(data);
  heroEvents(data);
}
async function startDemo() {
  const { DemoBackend } = await import('../demo/backend');
  demoApi = new DemoBackend();
  if (showcase && window.top === window) demoApi.reset();   // always the clean day-9 picture
  demoApi.subscribe(() => demoSync());
  demoSync(true);
  if (showcase) startShowcase();
  // Background jobs (close rounds, end at zero) run in the top window only.
  if (window.top === window) setInterval(() => demoApi?.tick(), 1000);
  setInterval(() => demoSync(), 30_000);   // "acum 3 min" labels
}
if (demo) void startDemo();

/** The showcase keeps itself busy: new subs and donations, votes coming in, a wheel win now and then. */
function startShowcase() {
  const tag = document.createElement('p');
  tag.className = 'showcase-tag';
  tag.textContent = 'Demo · date de exemplu';
  document.body.append(tag);
  if (window.top !== window) return;
  const quiet = (fn: () => void) => () => { try { fn(); } catch { /* round closed etc. */ } };
  setInterval(quiet(() => demoApi?.randomEvent()), 5_500);
  setInterval(quiet(() => demoApi?.simulateVotes(3)), 9_000);
  setInterval(quiet(() => demoApi?.fakeWin()), 47_000);
}

/** Demo stand-in for the Twitch login screen. */
function openLoginModal() {
  set({ menu: false });
  const back = document.createElement('div');
  back.className = 'demo-modal';
  back.innerHTML = `<div class="demo-modal-card" role="dialog" aria-modal="true" aria-labelledby="dm-title">
<p class="demo-modal-eyebrow">Twitch · simulare</p>
<h2 id="dm-title">Conectează-te cu Twitch</h2>
<p>Pe site-ul real se deschide aici Twitch. Viewerul aprobă o singură dată, apoi site-ul verifică automat dacă e abonat.</p>
<div class="demo-modal-actions">
<button type="button" class="btn-twitch" data-login="sub">Continuă ca abonat</button>
<button type="button" class="btn-ghost" data-login="nonsub">Continuă fără abonament</button>
<button type="button" class="btn-ghost" data-login="">Anulează</button>
</div></div>`;
  const close = (choice?: string) => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    if (choice) demoApi?.setViewer(choice as State['viewer']);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  back.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('[data-login]');
    if (btn) close(btn.dataset.login);
    else if (e.target === back) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  back.querySelector<HTMLElement>('button')?.focus();
}

let autoSim: number | undefined;
function setAutoSim(on: boolean) {
  clearInterval(autoSim);
  autoSim = on ? window.setInterval(() => demoApi?.randomEvent(), 3500) : undefined;
  document.querySelectorAll<HTMLElement>('[data-action="simAuto"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
}

// The presentation page steers the embedded demo site.
window.addEventListener('message', (e) => {
  if (!demo || e.origin !== location.origin || e.data?.icemaraton !== 'demo') return;
  const m = e.data as { scrollTo?: string; closeToast?: boolean; brand?: string };
  if (m.closeToast) set({ toast: null });
  // Sponsor presentation: show the visiting brand everywhere the main partner appears.
  if (typeof m.brand === 'string') {
    brandPreview = true;
    const brand = m.brand.trim().slice(0, 40) || site.sponsor.name;
    const code = (brand.replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'BRAND') + '10';
    const texts: Record<string, string> = {
      name: brand, logo: brand.toUpperCase(), code,
      pitch: `Partenerul principal al IceMaratonului. Oferta ${brand} pentru comunitate: reducere cu codul de mai jos, pe toată durata maratonului.`,
    };
    all('[data-sponsor]').forEach((el) => { const t = texts[el.dataset.sponsor!]; if (t !== undefined && el.textContent !== t) el.textContent = t; });
  }
  if (m.scrollTo) {
    const behavior = reducedMotion.matches ? 'auto' : 'smooth';
    const el = m.scrollTo === 'top' ? null : document.getElementById(m.scrollTo);
    if (!el) window.scrollTo({ top: 0, behavior });
    else {
      // A single element (like "Prezentat de") is centred and outlined for a moment; sections start at the top.
      const small = el.tagName !== 'SECTION';
      el.scrollIntoView({ behavior, block: small ? 'center' : 'start' });
      if (small) el.animate([{ outline: '2px solid #3FD0FF', outlineOffset: '6px' }, { outline: '2px solid rgba(63,208,255,0)', outlineOffset: '6px' }], { duration: 2200, delay: 500, easing: 'ease-in' });
    }
  }
});

// ---- Actions ------------------------------------------------------------
/** One request at a time per action: a double click sends one suggestion, one code, one save. */
const inflight = new Set<string>();
function once<T>(key: string, run: () => Promise<T>): Promise<T> | undefined {
  if (inflight.has(key)) return undefined;
  inflight.add(key);
  const p = run();
  // Keep the action busy for at least 700 ms, so the second click of a double click is ignored.
  void Promise.allSettled([p, new Promise((r) => setTimeout(r, 700))]).then(() => inflight.delete(key));
  return p;
}

let spinTimer: number | undefined;
let copyTimer: number | undefined;

/** Rotate 5 full turns plus the offset that lands slice `idx` (slice 0 centred at the top) under the pointer. */
function spinTo(idx: number, spinsLeft: number) {
  const seg = 360 / Math.max(1, data.prizes.length);
  const jitter = (Math.random() - 0.5) * seg * 0.6;
  const cur = state.wheelDeg;
  const target = (((360 - (idx * seg + jitter)) % 360) + 360) % 360;
  const delta = (((target - (cur % 360)) % 360) + 360) % 360;
  set({ wheelDeg: cur + 5 * 360 + delta, spinning: true, spins: spinsLeft, spunToday: true, result: null });
  clearTimeout(spinTimer);
  spinTimer = window.setTimeout(() => {
    set({ spinning: false, result: idx });
    void live?.refreshMe();
    void live?.poll(); // the win shows up in "Ultimele premii" for everyone
  }, reducedMotion.matches ? 300 : 4700);
}

const actions: Record<string, (arg: string, el: HTMLElement) => void> = {
  login: () => {
    if (demo) { openLoginModal(); return; }
    if (!site.supabase.twitchLogin || !live) {
      info('În curând', 'Conectarea cu Twitch se activează înainte de start.');
      set({ menu: false });
      return;
    }
    live.login().catch(fail);
  },
  logout: () => {
    if (demo) { demoApi?.setViewer('out'); return; }
    live?.logout().catch(fail);
  },
  becomeSub: () => {
    if (demo) { demoApi?.setViewer('sub'); info('Abonament verificat', 'Ești abonat. Acum poți vota și propune provocări.'); return; }
    live?.checkSub().catch(fail);
  },

  calcPick: (i) => set({ calcPick: Number(i) || 0 }),
  badgeTip: (id) => set({ badgeTip: state.badgeTip === id ? null : id }),
  more: (key) => {
    const k = key as keyof State['more'];
    set({ more: { ...state.more, [k]: !state.more[k] } });
  },

  bubbleNext: () => showNextHero(),
  toggleMenu: () => set({ menu: !state.menu }),
  closeMenu: () => set({ menu: false }),
  closeToast: () => set({ toast: null }),

  voteTab: (id) => set({ voteTab: id as State['voteTab'] }),
  boardTab: (id) => set({ tab: id as State['tab'] }),
  vote: (id) => {
    if (demo) {
      try { demoApi?.castVote(Number(id)); set({ toast: 'vote' }); } catch (err) { fail(err); }
      return;
    }
    if (!live || !data.round) return;
    const previous = state.myVote;
    set({ myVote: id, toast: 'vote' });  // optimistic; the tally follows via realtime
    live.vote(data.round.id, Number(id)).catch((err) => { set({ myVote: previous, toast: null }); fail(err); });
  },

  spin: () => {
    if (state.viewer === 'out') { actions.login('', document.body); return; }
    if (state.spinning || state.spins <= 0) return;
    if (demo) {
      try { const r = demoApi!.spin(); spinTo(r.prize, r.spinsLeft); } catch (err) { fail(err); }
      return;
    }
    // The server picks the prize; the wheel only animates to it.
    set({ spinning: true, result: null });
    live?.spin()
      .then((r) => spinTo(r.prize_position, r.spins_left))
      .catch((err) => { set({ spinning: false }); fail(err); });
  },

  bingoLine: (n) => {
    if (!(data.bingo.closesAt === null || Date.now() < data.bingo.closesAt)) return;
    const vals = derive(state, data);
    const line = vals.bingoLines[Number(n)];
    if (!line) return;
    // The line's 5 events: read them off the same 5×5 layout derive uses.
    const ids = data.bingo.items.slice(0, 25).map((it) => it.id);
    const k = Number(n);
    const lineIds = k < 5 ? ids.slice(k * 5, k * 5 + 5)
      : k < 10 ? [0, 1, 2, 3, 4].map((j) => ids[k - 5 + 5 * j])
      : k === 10 ? [0, 1, 2, 3, 4].map((j) => ids[6 * j])
      : [0, 1, 2, 3, 4].map((j) => ids[20 - 4 * j]);
    const pick = line.on ? [] : lineIds;
    storePick(pick);
    set({ bingoPick: pick });
  },

  bingoSave: () => {
    if (state.viewer === 'out') { actions.login('', document.body); return; }
    if (state.bingoPick.length !== 5) return;
    const pick = state.bingoPick.slice();
    if (demo) {
      try { demoApi?.saveBingo(pick); info('Bingo', 'Linia ta e salvată.'); } catch (err) { fail(err); }
      return;
    }
    if (!live) return;
    once('bingo', () => live!.saveBingo(pick))
      ?.then(() => { set({ bingoSaved: pick }); info('Bingo', 'Linia ta e salvată. O poți schimba până la închidere.'); })
      .catch(fail);
  },

  sendSuggestion: () => {
    const text = state.suggestion.trim();
    if (!text) { document.getElementById('suggestion')?.focus(); return; }
    if (demo) {
      try { demoApi?.suggest(text); set({ suggestDone: true }); } catch (err) { fail(err); }
      return;
    }
    if (!live) return;
    once('suggest', () => live!.suggest(text))?.then(() => set({ suggestDone: true })).catch(fail);
  },
  newSuggestion: () => {
    const field = document.getElementById('suggestion') as HTMLTextAreaElement | null;
    if (field) field.value = '';
    set({ suggestDone: false, suggestion: '' });
    field?.focus();
  },

  claimCode: () => {
    if (state.viewer === 'out') { actions.login('', document.body); return; }
    const code = state.codeInput.trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 4) { document.getElementById('secret-code')?.focus(); return; }
    const done = (sponsor: string | null) => {
      set({ codeInput: '' });
      const field = document.getElementById('secret-code') as HTMLInputElement | null;
      if (field) field.value = '';
      info('Cod secret', `Ai primit o rotire bonus${sponsor ? ` de la ${sponsor}` : ''}! Învârte roata.`);
    };
    if (demo) {
      try { done(demoApi!.claimCode(code)); } catch (err) { fail(err); }
      return;
    }
    if (!live) return;
    once('code', () => live!.claimCode(code))?.then((r) => done(r.sponsor)).catch(fail);
  },

  copyCode: () => {
    const code = document.querySelector('#oferta [data-sponsor="code"]')?.textContent?.trim() || site.sponsor.code;
    try { navigator.clipboard?.writeText(code).catch(() => {}); } catch { /* clipboard blocked */ }
    set({ copied: true });
    clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => set({ copied: false }), 2000);
  },


  // Demo panel (?demo): viewer and stream state, fake Twitch events.
  setViewer: (id) => { demoApi?.setViewer(id as State['viewer']); set({ menu: false }); },
  setStream: (id) => { demoApi?.setStatus(id as SiteData['status']); },
  toggleSnow: () => set({ showSnow: !state.showSnow }),
  simSub: () => { demoApi?.recordEvent('sub', 'viewer_demo', '1000'); },
  simGift: () => { demoApi?.recordEvent('gift', 'viewer_demo', '1000', 10); },
  simBits: () => { demoApi?.recordEvent('bits', 'viewer_demo', null, 500); },
  simAuto: () => setAutoSim(autoSim === undefined),
  simHour: () => { demoApi?.watchHalfHour(); },
  demoReset: () => { if (confirm('Resetezi demo-ul la starea de început?')) { setAutoSim(false); demoApi?.reset(); } },
};

document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!el) return;
  actions[el.dataset.action!]?.(el.dataset.arg ?? '', el);
});

document.addEventListener('input', (e) => {
  const el = e.target as HTMLTextAreaElement;
  if (el.dataset?.input === 'suggestion') set({ suggestion: el.value.slice(0, 140) });
  if (el.dataset?.input === 'codeInput') set({ codeInput: el.value.slice(0, 16) });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.target as HTMLElement).dataset?.input === 'codeInput') { e.preventDefault(); actions.claimCode('', e.target as HTMLElement); }
});

// Sponsor report: count clicks on sponsor links and code copies, once per visit each.
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-track]');
  if (!el || demo || !live) return;
  const [sponsor, kind] = el.dataset.track!.split('|');
  const key = `icemaraton:tracked:${sponsor}:${kind}`;
  try { if (sessionStorage.getItem(key)) return; sessionStorage.setItem(key, '1'); } catch { /* storage blocked: count anyway */ }
  live.track(sponsor, kind === 'code_copy' ? 'code_copy' : 'click');
}, true);

document.addEventListener('keydown', (e) => {
  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  const tab = (e.target as Element).closest<HTMLElement>('[role="tab"]');
  if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const list = Array.from(tab.parentElement!.querySelectorAll<HTMLElement>('[role="tab"]'));
    const i = list.indexOf(tab);
    const next =
      e.key === 'Home' ? list[0]
      : e.key === 'End' ? list[list.length - 1]
      : list[(i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length];
    e.preventDefault();
    next.focus();
    next.click();
    return;
  }
  // «Cât adaugi tu?» is a radio group: arrows move the choice.
  const radio = (e.target as Element).closest<HTMLElement>('.calc[role="radio"]');
  if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const n = Number(radio.dataset.arg) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
    const list = Array.from(radio.parentElement!.querySelectorAll<HTMLElement>('.calc'));
    const next = list[(n + list.length) % list.length];
    e.preventDefault();
    next.click();
    // The group re-rendered: focus the new copy of the chosen option.
    document.querySelector<HTMLElement>(`[data-key="${next.dataset.key}"]`)?.focus();
    return;
  }
  if (e.key === 'Escape' && state.badgeTip) { set({ badgeTip: null }); return; }
  if (e.key === 'Escape' && state.menu) {
    set({ menu: false });
    document.querySelector<HTMLElement>('.nav-menu')?.focus();
  }
});

render();
