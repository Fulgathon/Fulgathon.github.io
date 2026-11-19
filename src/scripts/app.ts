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
// Phase 2: replace the sample data and the fake login with backend calls;
// the bindings stay the same.

import { sample } from '../data/sample';
import { site } from '../data/site';
import { derive, initialState, type State } from '../lib/derive';
import { views, type RegionName } from '../lib/views';

type AnyVals = Record<string, unknown>;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const loadedAt = Date.now();

let state: State = initialState(sample);
state.demo = new URLSearchParams(location.search).has('demo');

const all = <T extends HTMLElement = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel));
const pairs = (spec: string) => spec.split(';').filter(Boolean).map((p) => p.split(':') as [string, string]);

const texts = all('[data-text]');
const ifs = all('[data-if]');
const styles = all('[data-style]').map((el) => ({ el, list: pairs(el.dataset.style!) }));
const attrs = all('[data-attr]').map((el) => ({ el, list: pairs(el.dataset.attr!) }));
const toggles = all('[data-toggle]').map((el) => ({ el, list: pairs(el.dataset.toggle!) }));
const regions = all('[data-region]').map((el) => ({ el, name: el.dataset.region as RegionName }));

// The build rendered the regions from the same initial state, so start from
// those strings and only touch the DOM when something actually changes.
const initialVals = derive(state, sample);
const lastHtml = new Map(regions.map(({ el, name }) => [el, views[name](initialVals)]));

function render() {
  const v = derive(state, sample);
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
  if ('viewer' in patch) fitNav();
}

// Countdowns: derived from the wall clock, so a throttled background tab
// still shows the right time when it comes back.
function tick() {
  const elapsed = Math.floor((Date.now() - loadedAt) / 1000);
  if (elapsed !== state.elapsed) set({ elapsed });
}
setInterval(tick, 250);

let spinTimer: number | undefined;
let copyTimer: number | undefined;

const actions: Record<string, (arg: string, el: HTMLElement) => void> = {
  // Stand-in for "Login with Twitch" until phase 2.
  login: () => set({ viewer: 'sub', menu: false }),
  logout: () => set({ viewer: 'out', myVote: null, result: null }),
  becomeSub: () => set({ viewer: 'sub' }),

  toggleMenu: () => set({ menu: !state.menu }),
  closeMenu: () => set({ menu: false }),
  closeToast: () => set({ toast: null }),

  voteTab: (id) => set({ voteTab: id as State['voteTab'] }),
  boardTab: (id) => set({ tab: id as State['tab'] }),
  vote: (id) => set({ myVote: id, toast: 'vote' }),

  spin: () => {
    if (state.viewer === 'out') { actions.login('', document.body); return; }
    if (state.spinning || state.spins <= 0) return;
    // Decide the result first, then rotate 5 full turns plus the offset to land on it.
    const idx = Math.floor(Math.random() * 8);
    const jitter = Math.random() * 30 - 15;
    const cur = state.wheelDeg;
    const target = (((360 - (idx * 45 + 22.5 + jitter)) % 360) + 360) % 360;
    const delta = (((target - (cur % 360)) % 360) + 360) % 360;
    set({ wheelDeg: cur + 5 * 360 + delta, spinning: true, spins: state.spins - 1, result: null });
    clearTimeout(spinTimer);
    spinTimer = window.setTimeout(() => set({ spinning: false, result: idx }), reducedMotion.matches ? 300 : 4700);
  },

  bingo: (i) => {
    const marked = state.marked.slice();
    marked[Number(i)] = !marked[Number(i)];
    set({ marked });
  },

  sendSuggestion: () => {
    if (state.suggestion.trim()) set({ suggestDone: true });
    else document.getElementById('suggestion')?.focus();
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
  setViewer: (id) => set({ viewer: id as State['viewer'], myVote: null, result: null, menu: false }),
  setStream: (id) => set({ stream: id as State['stream'] }),
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
