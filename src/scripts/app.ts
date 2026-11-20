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
//   * ?demo:  the design's sample data, actions stay in the browser, and a
//             panel switches viewer and stream states.

import { emptyData, sampleBingoMarked, sampleData, sampleViewer } from '../data/sample';
import { site } from '../data/site';
import type { SiteData } from '../data/types';
import { derive, initialState, type State } from '../lib/derive';
import { views, type RegionName } from '../lib/views';
import type { Live, Me } from './live';

type AnyVals = Record<string, unknown>;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const demo = new URLSearchParams(location.search).has('demo');
const BINGO_KEY = 'fulgathon:bingo';

let data: SiteData = emptyData();
let state: State = { ...initialState(), demo, now: Date.now() };
let live: Live | null = null;

if (demo) {
  data = sampleData(state.now);
  state = {
    ...state,
    viewerName: sampleViewer.name, spins: sampleViewer.spins, flakes: sampleViewer.flakes,
    minutesToNextFlake: sampleViewer.minutesToNextFlake, marked: sampleBingoMarked.slice(), toast: 'goal',
  };
} else {
  state.marked = loadBingo();
}

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

// ---- Bingo is personal: kept in this browser only. ---------------------
function loadBingo(): boolean[] {
  try {
    const saved = JSON.parse(localStorage.getItem(BINGO_KEY) ?? 'null');
    if (Array.isArray(saved) && saved.length === 16) return saved.map(Boolean);
  } catch { /* storage blocked */ }
  return Array(16).fill(false);
}
function saveBingo(marked: boolean[]) {
  if (demo) return;
  try { localStorage.setItem(BINGO_KEY, JSON.stringify(marked)); } catch { /* storage blocked */ }
}

// ---- Messages for things that didn't work. ------------------------------
const errors: Record<string, string> = {
  not_logged_in: 'Conectează-te cu Twitch mai întâi.',
  not_subscribed: 'Asta e doar pentru abonați.',
  round_closed: 'Runda de vot s-a închis.',
  not_in_round: 'Provocarea nu mai e în runda asta.',
  no_spins: 'Nu mai ai rotiri. Mai stai puțin!',
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
const reachedGoals = (d: SiteData) => d.goals.filter((g) => d.subs >= g.threshold).length;

function applyMe(me: Me | null) {
  if (!me) {
    set({ viewer: 'out', viewerName: '', spins: 0, flakes: 0, myVote: null, result: null, suggestDone: false });
    return;
  }
  set({
    viewer: me.isSub ? 'sub' : 'nonsub', viewerName: me.name, myVote: me.myVote,
    // Don't let a refresh jump the counter while the wheel is still turning.
    ...(state.spinning ? {} : { spins: me.spins }),
    flakes: me.flakes, minutesToNextFlake: me.minutesToNextFlake,
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

// ---- Actions ------------------------------------------------------------
let spinTimer: number | undefined;
let copyTimer: number | undefined;

/** Rotate 5 full turns plus the offset that lands segment `idx` under the pointer. */
function spinTo(idx: number, spinsLeft: number) {
  const jitter = Math.random() * 30 - 15;
  const cur = state.wheelDeg;
  const target = (((360 - (idx * 45 + 22.5 + jitter)) % 360) + 360) % 360;
  const delta = (((target - (cur % 360)) % 360) + 360) % 360;
  set({ wheelDeg: cur + 5 * 360 + delta, spinning: true, spins: spinsLeft, result: null });
  clearTimeout(spinTimer);
  spinTimer = window.setTimeout(() => {
    set({ spinning: false, result: idx });
    void live?.refreshMe();
  }, reducedMotion.matches ? 300 : 4700);
}

const actions: Record<string, (arg: string, el: HTMLElement) => void> = {
  login: () => {
    if (demo) { set({ viewer: 'sub', menu: false }); return; }
    if (!site.supabase.twitchLogin || !live) {
      info('În curând', 'Conectarea cu Twitch se activează înainte de start.');
      set({ menu: false });
      return;
    }
    live.login().catch(fail);
  },
  logout: () => {
    if (demo) { set({ viewer: 'out', myVote: null, result: null }); return; }
    live?.logout().catch(fail);
  },
  becomeSub: () => {
    if (demo) { set({ viewer: 'sub' }); return; }
    live?.checkSub().catch(fail);
  },

  toggleMenu: () => set({ menu: !state.menu }),
  closeMenu: () => set({ menu: false }),
  closeToast: () => set({ toast: null }),

  voteTab: (id) => set({ voteTab: id as State['voteTab'] }),
  boardTab: (id) => set({ tab: id as State['tab'] }),
  vote: (id) => {
    if (demo) { set({ myVote: id, toast: 'vote' }); return; }
    if (!live || !data.round) return;
    const previous = state.myVote;
    set({ myVote: id, toast: 'vote' });  // optimistic; the tally follows via realtime
    live.vote(data.round.id, Number(id)).catch((err) => { set({ myVote: previous, toast: null }); fail(err); });
  },

  spin: () => {
    if (state.viewer === 'out') { actions.login('', document.body); return; }
    if (state.spinning || state.spins <= 0) return;
    if (demo) { spinTo(Math.floor(Math.random() * 8), state.spins - 1); return; }
    // The server picks the prize; the wheel only animates to it.
    set({ spinning: true, result: null });
    live?.spin()
      .then((r) => spinTo(r.prize_position, r.spins_left))
      .catch((err) => { set({ spinning: false }); fail(err); });
  },

  bingo: (i) => {
    const marked = state.marked.slice();
    marked[Number(i)] = !marked[Number(i)];
    saveBingo(marked);
    set({ marked });
  },

  sendSuggestion: () => {
    const text = state.suggestion.trim();
    if (!text) { document.getElementById('suggestion')?.focus(); return; }
    if (demo) { set({ suggestDone: true }); return; }
    live?.suggest(text).then(() => set({ suggestDone: true })).catch(fail);
  },
  newSuggestion: () => {
    const field = document.getElementById('suggestion') as HTMLTextAreaElement | null;
    if (field) field.value = '';
    set({ suggestDone: false, suggestion: '' });
    field?.focus();
  },

  copyCode: () => {
    try { navigator.clipboard?.writeText(site.sponsor.code).catch(() => {}); } catch { /* clipboard blocked */ }
    set({ copied: true });
    clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => set({ copied: false }), 2000);
  },

  popout: () => {
    const url = `https://player.twitch.tv/?channel=${encodeURIComponent(site.channel)}&parent=${encodeURIComponent(location.hostname)}`;
    window.open(url, 'fulgathon-player', 'popup,width=960,height=540');
  },

  // Demo panel (?demo). Switching the viewer resets the vote, like the design.
  setViewer: (id) => { if (demo) set({ viewer: id as State['viewer'], myVote: null, result: null, menu: false }); },
  setStream: (id) => { if (demo) { data = { ...data, status: id as SiteData['status'] }; render(); } },
  toggleSnow: () => set({ showSnow: !state.showSnow }),
};

document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!el) return;
  actions[el.dataset.action!]?.(el.dataset.arg ?? '', el);
});

document.addEventListener('input', (e) => {
  const el = e.target as HTMLTextAreaElement;
  if (el.dataset?.input === 'suggestion') set({ suggestion: el.value.slice(0, 140) });
});

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
