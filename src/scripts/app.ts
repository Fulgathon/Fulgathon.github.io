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

import { emptyData } from '../data/sample';
import { site } from '../data/site';
import type { SiteData } from '../data/types';
import { derive, initialState, type State } from '../lib/derive';
import { views, type RegionName } from '../lib/views';
import type { DemoBackend } from '../demo/backend';
import type { Live, Me } from './live';

type AnyVals = Record<string, unknown>;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const params = new URLSearchParams(location.search);
const demo = params.has('demo');
const embed = params.has('embed');
const BINGO_KEY = 'icemaraton:bingo-pick';

let data: SiteData = emptyData();
// state.demo shows the demo panel (not inside the presentation page).
let state: State = { ...initialState(), demo: demo && !embed, now: Date.now() };
let live: Live | null = null;
let demoApi: DemoBackend | null = null;

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

function render() {
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
    el.innerHTML = html;
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

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  render();
  if ('viewer' in patch || 'viewerName' in patch) fitNav();
}

// Countdowns: derived from the wall clock, so a throttled background tab
// still shows the right time when it comes back.
setInterval(() => {
  const now = Date.now();
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
};
function info(eyebrow: string, text: string) {
  set({ toast: 'info', info: { eyebrow, text } });
}
function fail(err: unknown) {
  const msg = String((err as { message?: string })?.message ?? '');
  const key = Object.keys(errors).find((k) => msg.includes(k));
  info('Nu a mers', key ? errors[key] : 'Ceva n-a mers. Încearcă din nou.');
}

// ---- Live data ----------------------------------------------------------
const reachedGoals = (d: SiteData) => d.goals.filter((g) => d.raisedNum >= g.threshold).length;

function applyMe(me: Me | null) {
  if (!me) {
    set({ viewer: 'out', viewerName: '', spins: 0, watchedToday: 0, spunToday: false, bonusSpins: 0, myVote: null, result: null, suggestDone: false, bingoSaved: null });
    return;
  }
  set({
    ...withSaved(me.bingoSaved),
    viewer: me.isSub ? 'sub' : 'nonsub', viewerName: me.name, myVote: me.myVote,
    // Don't let a refresh jump the counter while the wheel is still turning.
    ...(state.spinning ? {} : { spins: me.spins, spunToday: me.spunToday }),
    watchedToday: me.watchedToday, bonusSpins: me.bonusSpins,
  });
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
    },
    onMe: applyMe,
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
    watchedToday: me.watchedToday, bonusSpins: me.bonusSpins,
    ...(state.spinning ? {} : { spins: me.spins, spunToday: me.spunToday }),
  };
  const unlocked = data.status === 'live' && (first ? reachedGoals(data) > 0 : reachedGoals(data) > before);
  set(unlocked ? { ...patch, toast: 'goal' } : patch);
}
async function startDemo() {
  const { DemoBackend } = await import('../demo/backend');
  demoApi = new DemoBackend();
  demoApi.subscribe(() => demoSync());
  demoSync(true);
  // Background jobs (close rounds, end at zero) run in the top window only.
  if (window.top === window) setInterval(() => demoApi?.tick(), 1000);
  setInterval(() => demoSync(), 30_000);   // "acum 3 min" labels
}
if (demo) void startDemo();

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
let spinTimer: number | undefined;
let copyTimer: number | undefined;

/** Rotate 5 full turns plus the offset that lands segment `idx` under the pointer. */
function spinTo(idx: number, spinsLeft: number) {
  const jitter = Math.random() * 30 - 15;
  const cur = state.wheelDeg;
  const target = (((360 - (idx * 45 + 22.5 + jitter)) % 360) + 360) % 360;
  const delta = (((target - (cur % 360)) % 360) + 360) % 360;
  set({ wheelDeg: cur + 5 * 360 + delta, spinning: true, spins: spinsLeft, spunToday: true, result: null });
  clearTimeout(spinTimer);
  spinTimer = window.setTimeout(() => {
    set({ spinning: false, result: idx });
    void live?.refreshMe();
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
    live?.saveBingo(pick)
      .then(() => { set({ bingoSaved: pick }); info('Bingo', 'Linia ta e salvată. O poți schimba până la închidere.'); })
      .catch(fail);
  },

  sendSuggestion: () => {
    const text = state.suggestion.trim();
    if (!text) { document.getElementById('suggestion')?.focus(); return; }
    if (demo) {
      try { demoApi?.suggest(text); set({ suggestDone: true }); } catch (err) { fail(err); }
      return;
    }
    live?.suggest(text).then(() => set({ suggestDone: true })).catch(fail);
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
    live?.claimCode(code).then((r) => done(r.sponsor)).catch(fail);
  },

  copyCode: () => {
    try { navigator.clipboard?.writeText(site.sponsor.code).catch(() => {}); } catch { /* clipboard blocked */ }
    set({ copied: true });
    clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => set({ copied: false }), 2000);
  },

  popout: () => {
    const url = `https://player.twitch.tv/?channel=${encodeURIComponent(site.channel)}&parent=${encodeURIComponent(location.hostname)}`;
    window.open(url, 'icemaraton-player', 'popup,width=960,height=540');
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

// ---- Twitch player and chat: loaded when the Live section comes into view. ----
function loadEmbeds() {
  const host = location.hostname;
  const player = document.getElementById('player-slot');
  const chat = document.getElementById('chat-slot');
  const frame = (src: string, title: string) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.title = title;
    f.allowFullscreen = true;
    f.setAttribute('allow', 'autoplay; fullscreen');
    f.style.cssText = 'position: absolute; inset: 0; width: 100%; height: 100%; border: 0';
    return f;
  };
  if (player) player.replaceChildren(frame(`https://player.twitch.tv/?channel=${site.channel}&parent=${host}&muted=true&autoplay=true`, 'Playerul Twitch'));
  if (chat) {
    chat.style.cssText = 'flex: 1 1 auto; position: relative; min-height: 420px';
    chat.replaceChildren(frame(`https://www.twitch.tv/embed/${site.channel}/chat?parent=${host}&darkpopout`, 'Chatul Twitch'));
  }
}
const liveSection = document.getElementById('live');
// Not inside the presentation page (?embed): three copies of the Twitch player would be too heavy.
if (liveSection && !embed && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); loadEmbeds(); }
  }, { rootMargin: '400px 0px' });
  io.observe(liveSection);
}

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
  if (e.key === 'Escape' && state.menu) {
    set({ menu: false });
    document.querySelector<HTMLElement>('.nav-menu')?.focus();
  }
});

render();
