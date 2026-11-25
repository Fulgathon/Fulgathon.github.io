// Guided presentation: steps on the left, the real site / moderator page /
// overlay on the right, all running on the shared demo backend. The step
// buttons and the "Twitch simulat" bar change the demo; every frame updates.

import { DemoBackend } from '../demo/backend';
import { derive, initialState } from '../lib/derive';
import { fmtInt } from '../lib/format';

const api = new DemoBackend();
const HOUR = 3_600_000;

type View = 'site' | 'phone' | 'split' | 'overlay' | 'final';
interface Action { label: string; primary?: boolean; run: () => void }
interface Step { title: string; view: View; scroll?: string; body: string | (() => string); actions?: Action[] }

// Phones and tablets (matches the CSS): the demo sits above the step, and the
// live pages render at their real size instead of a scaled-down desktop.
const compact = matchMedia('(max-width: 1000px)');
const where = () => (compact.matches && !matchMedia('(orientation: landscape)').matches ? 'Deasupra' : 'În dreapta');

// ---- Talking to the embedded site ------------------------------------------
function post(name: string, msg: Record<string, unknown>) {
  const f = document.querySelector<HTMLIFrameElement>(`.frame[data-name="${name}"] iframe`);
  f?.contentWindow?.postMessage({ icemaraton: 'demo', ...msg }, location.origin);
}
const scrollSite = (id: string) => { post('site', { scrollTo: id }); post('site2', { scrollTo: id }); post('phone', { scrollTo: id }); };
const currentRoundId = () => api.state.rounds.slice().sort((a, b) => b.number - a.number)[0]?.id;
const guard = (fn: () => void) => () => { try { fn(); } catch (e) { flash(String((e as Error).message)); } };

const errorText: Record<string, string> = {
  round_closed: 'Runda e închisă.',
  timer_not_live: 'Cronometrul nu e pornit.',
  round_already_open: 'Există deja o rundă deschisă.',
  no_bingo_winners: 'Nimeni cu bingo încă.',
};
function flash(code: string) {
  const key = Object.keys(errorText).find((k) => code.includes(k));
  const el = document.getElementById('step')!;
  const p = document.createElement('p');
  p.style.cssText = 'color:#FF8A95;font-weight:600';
  p.textContent = key ? errorText[key] : 'Nu a mers: ' + code;
  el.append(p);
  setTimeout(() => p.remove(), 4000);
}
function note(text: string) {
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--ice);font-weight:700';
  p.textContent = text;
  document.getElementById('step')!.append(p);
  setTimeout(() => p.remove(), 6000);
}

// ---- The steps (Romanian: for Iceman) ---------------------------------------
const steps: Step[] = [
  {
    title: 'Bun venit la ICEMARATON', view: 'site', scroll: 'top',
    body: () => `<p>Site-ul subathonului, legat de Twitch și TipeeeStream. Donațiile și subs adaugă timp.</p>
<p>${where()}: site-ul real, pe date de test.</p>`,
    actions: [{ label: 'Pornește simularea automată', primary: true, run: () => setAuto(true) }],
  },
  {
    title: 'Cronometrul', view: 'site', scroll: 'top',
    body: `<p>Ce adaugă timp:</p>
<ul><li>Donație (TipeeeStream): <strong>+6 min pentru fiecare 1 €</strong></li><li>Tier 1 / Prime: <strong>+6 min</strong> · Tier 2: <strong>+12 min</strong> · Tier 3: <strong>+18 min</strong></li><li>Fiecare sub cadou: <strong>+6 min</strong> · 400 de biți: <strong>+4 min</strong></li></ul>
<p>La zero, subathonul se termină.</p>`,
    actions: [
      { label: 'Donație 10 €', primary: true, run: () => api.recordEvent('donation', 'darius_ro', null, 10, 'EUR') },
      { label: 'Sub Tier 1', run: () => api.recordEvent('sub', 'alexx_ro', '1000') },
      { label: 'Sub Tier 3', run: () => api.recordEvent('sub', 'vlad_tz', '3000') },
      { label: '10 subs cadou', run: () => api.recordEvent('gift', 'vladutz97', '1000', 10) },
      { label: '500 de biți', run: () => api.recordEvent('bits', 'teo_mid', null, 500) },
    ],
  },
  {
    title: 'Ora dublă și înghețarea', view: 'site', scroll: 'top',
    body: `<p><strong>Ora dublă</strong>: timpul adăugat × 2.</p>
<p><strong>Înghețat</strong>: cronometrul stă pe loc.</p>`,
    actions: [
      { label: 'Pornește Ora dublă', primary: true, run: () => api.doubleHour(Date.now(), 60) },
      { label: 'Sub Tier 3', run: () => api.recordEvent('sub', 'gabi_supp', '3000') },
      { label: 'Îngheață 5 minute', run: guard(() => api.freeze(5)) },
      { label: 'Oprește Ora dublă', run: () => api.doubleHour(Date.now() - 2 * HOUR, 60) },
    ],
  },
  {
    title: 'Milestone Maraton', view: 'site', scroll: 'top',
    body: `<p>Provocări deblocate de <strong>suma donațiilor</strong>. Lista se editează pe /mod.</p>`,
    actions: [
      { label: 'Donează până la milestone-ul următor', primary: true, run: () => {
        const raised = api.state.stats.raised;
        const next = api.state.goals.map((g) => g.threshold).find((t) => t > raised);
        if (next) api.recordEvent('donation', 'andreiGG', null, Math.ceil(next - raised), 'EUR');
        scrollSite('top');
      } },
      { label: 'Arată lista', run: () => scrollSite('goals') },
    ],
  },
  {
    title: 'Votul abonaților', view: 'site', scroll: 'vote',
    body: `<p>Doar <strong>abonații</strong> votează. 5 provocări pe rundă, 24 de ore.</p>`,
    actions: [
      { label: 'Vezi ca vizitator', run: () => api.setViewer('out') },
      { label: 'Vezi ca abonat', primary: true, run: () => api.setViewer('sub') },
      { label: '50 de abonați votează', run: guard(() => api.simulateVotes(50)) },
      { label: 'Închide runda', run: () => { const id = currentRoundId(); if (id) api.closeRound(id); } },
    ],
  },
  {
    title: 'Roata lui Lucky', view: 'site', scroll: 'roata',
    body: `<p><strong>Abonați</strong>, 2 ore privite = o rotire pe zi. Premiul îl alege serverul.</p>`,
    actions: [
      { label: 'Intră ca abonat', primary: true, run: () => api.setViewer('sub') },
      { label: '+30 min privit', run: () => api.watchHalfHour() },
    ],
  },
  {
    title: 'Bingo și propuneri', view: 'site', scroll: 'joaca',
    body: `<p><strong>Bingo</strong>: fiecare alege o linie. Linia completă intră la tragere.</p>
<p><strong>Propuneri</strong>: abonații trimit idei, moderatorii aprobă.</p>`,
    actions: [
      { label: 'Intră ca viewer', primary: true, run: () => api.setViewer('nonsub') },
      { label: 'Închide alegerile', run: guard(() => api.bingoCloseNow()) },
      { label: 'Bifează linia mea', run: () => { (api.state.bingo.pick ?? []).forEach((id) => api.bingoTick(id, true)); scrollSite('joaca'); } },
      { label: 'Trage la sorți', run: guard(() => note('Câștigătorul tras la sorți: ' + api.bingoDraw())) },
      { label: 'Redeschide alegerile', run: () => api.bingoReopenDemo() },
    ],
  },
  {
    title: 'Pe telefon', view: 'phone', scroll: 'top',
    body: `<p>Totul merge și pe telefon.</p>`,
    actions: [
      { label: 'Sub Tier 1', run: () => api.recordEvent('sub', 'darius_ro', '1000') },
      { label: 'Mergi la vot', run: () => scrollSite('vote') },
      { label: 'Mergi la roată', run: () => scrollSite('roata') },
    ],
  },
  {
    title: 'Pagina moderatorilor', view: 'split',
    body: () => `<p>Totul se conduce de pe <strong>/mod</strong>: timp, vot, bingo, tombole, premii, sponsori.</p>`,
  },
  {
    title: 'Overlay-ul pe stream', view: 'overlay',
    body: `<p>Piese pentru OBS, transparente.</p>`,
    actions: [
      { label: 'Sub Tier 3', primary: true, run: () => api.recordEvent('sub', 'Rares1337', '3000') },
      { label: '10 subs cadou', run: () => api.recordEvent('gift', 'vladutz97', '1000', 10) },
      { label: '1.000 de biți', run: () => api.recordEvent('bits', 'dianaplays', null, 1000) },
    ],
  },
  {
    title: 'Partenerii, peste tot', view: 'site', scroll: 'roata',
    body: `<ul><li><strong>Ora dublă oferită de …</strong></li>
<li><strong>Premii de la …</strong></li>
<li><strong>Codul secret</strong>: o rotire bonus.</li>
<li><strong>Raport</strong> pe /mod.</li></ul>`,
    actions: [
      { label: 'Arată un cod secret', primary: true, run: () => { const c = api.codeShow('Sponsor Principal', 10); note('Pe stream: ' + c.code); } },
      { label: 'Revendică-l ca viewer', run: guard(() => { api.setViewer('nonsub'); const c = api.currentCode(); if (c) api.claimCode(c.code); scrollSite('roata'); }) },
      { label: 'Ora dublă oferită de Sponsor Principal', run: () => api.doubleHour(Date.now(), 60, 'Sponsor Principal') },
    ],
  },
  {
    title: 'Ce urmează', view: 'final',
    body: () => `<p>${where()}: ce e gata și ce mai e de hotărât.</p>`,
  },
];

// ---- Frames: create on first view, scale to fit -----------------------------
const stage = document.getElementById('stage')!;
const frames = [...document.querySelectorAll<HTMLElement>('.frame')];

function ensureFrame(frame: HTMLElement) {
  if (frame.dataset.src && !frame.querySelector('iframe')) {
    const f = document.createElement('iframe');
    f.src = frame.dataset.src;
    f.title = frame.dataset.name === 'mod' ? 'Pagina moderatorilor (demo)' : 'Site-ul ICEMARATON (demo)';
    f.style.width = `${frame.dataset.w}px`;
    f.style.height = `${frame.dataset.h}px`;
    frame.append(f);
  }
  const lazy = frame.querySelector<HTMLIFrameElement>('iframe[data-overlay-src]');
  if (lazy && !lazy.src) lazy.src = lazy.dataset.overlaySrc!;
}

function fit(frame: HTMLElement) {
  const box = frame.parentElement!;
  const inner = frame.querySelectorAll<HTMLElement>('iframe, .scene');
  if (compact.matches && frame.dataset.src) {
    // A live page at its real size: readable, and scrollable by touch.
    const bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    Object.assign(frame.style, { width: `${bw}px`, height: `${bh}px`, left: '0', top: '0' });
    inner.forEach((el) => Object.assign(el.style, { width: `${bw}px`, height: `${bh}px`, transform: 'none' }));
    return;
  }
  const w = Number(frame.dataset.w), h = Number(frame.dataset.h);
  const pad = frame.classList.contains('phone') ? 20 : 2;
  const s = Math.min((box.clientWidth - pad) / w, (box.clientHeight - pad) / h);
  if (!(s > 0)) return;
  frame.style.width = `${w * s}px`;
  frame.style.height = `${h * s}px`;
  frame.style.left = `${(box.clientWidth - w * s - pad) / 2}px`;
  frame.style.top = `${(box.clientHeight - h * s - pad) / 2}px`;
  inner.forEach((el) => Object.assign(el.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${s})` }));
}
new ResizeObserver(() => frames.forEach(fit)).observe(stage);

// Small screens show the moderator page and the site one at a time.
const split = document.querySelector<HTMLElement>('.view[data-view="split"]')!;
split.querySelector('.split-tabs')!.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('button[data-show]');
  if (!b) return;
  split.dataset.show = b.dataset.show;
  split.querySelectorAll('.split-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  split.querySelectorAll<HTMLElement>('.frame').forEach(fit);
});

// ---- Rendering a step --------------------------------------------------------
let current = 0;
const toc = document.getElementById('toc')!;
const stepEl = document.getElementById('step')!;
toc.innerHTML = steps.map((s, i) => `<li><button type="button" data-goto="${i}" title="${s.title}">${i + 1}</button></li>`).join('');

function showStep(i: number) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  const s = steps[current];
  toc.querySelectorAll('button').forEach((b, k) => { if (k === current) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
  stepEl.innerHTML = `<span class="num">${String(current + 1).padStart(2, '0')} / ${steps.length}</span><h1>${s.title}</h1>${typeof s.body === 'function' ? s.body() : s.body}
${s.actions?.length ? `<div class="try"><p class="try-label">Încearcă</p><div class="acts">${s.actions.map((a, k) => `<button type="button" class="act${a.primary ? ' primary' : ''}" data-act="${k}">${a.label}</button>`).join('')}</div></div>` : ''}`;
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => { v.hidden = v.dataset.view !== s.view; });
  const visible = document.querySelector<HTMLElement>(`.view[data-view="${s.view}"]`)!;
  visible.querySelectorAll<HTMLElement>('.frame').forEach((f) => { ensureFrame(f); fit(f); });
  if (s.scroll) setTimeout(() => scrollSite(s.scroll!), 300);
  (document.getElementById('prev') as HTMLButtonElement).disabled = current === 0;
  (document.getElementById('next') as HTMLButtonElement).textContent = current === steps.length - 1 ? 'De la început ↺' : 'Mai departe →';
  history.replaceState(null, '', `#${current + 1}`);
  stepEl.scrollTop = 0;
}
// Rotating the phone or resizing across the breakpoint: re-lay out the frames
// and the step text.
compact.addEventListener('change', () => showStep(current));
matchMedia('(orientation: landscape)').addEventListener('change', () => showStep(current));

stepEl.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (b) steps[current].actions?.[Number(b.dataset.act)]?.run();
});
toc.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-goto]');
  if (b) showStep(Number(b.dataset.goto));
});
document.getElementById('prev')!.addEventListener('click', () => showStep(current - 1));
document.getElementById('next')!.addEventListener('click', () => showStep(current === steps.length - 1 ? 0 : current + 1));
document.addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') showStep(current + 1);
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') showStep(current - 1);
});

// ---- Final step: what's ready, what's next ----------------------------------
document.getElementById('final')!.innerHTML = `
<section class="card ice"><h2>Gata și testat</h2><ul>
<li>Site-ul public, pe calculator și telefon</li><li>Twitch conectat: subs, cadouri, biți, live</li>
<li>Donațiile din TipeeeStream, în euro</li><li>Conectare cu Twitch și verificare abonament</li>
<li>Vot, roata zilnică, Milestone Maraton, bingo, propuneri</li><li>Pagina moderatorilor și overlay-ul pentru OBS</li></ul></section>
<section class="card"><h2>Stabilit</h2><ul>
<li>Start: 20 decembrie, 12:00 · final programat: 10 ianuarie, 12:00</li>
<li>1 € = +6 min · Tier 1 +6 · Tier 2 +12 · Tier 3 +18 · cadou +6 · 400 biți +4</li>
<li>Roata: abonați, 2 ore pe zi, o rotire pe zi</li></ul></section>
<section class="card"><h2>De hotărât</h2><ul>
<li>Milestone-urile și sumele lor (se editează pe /mod)</li><li>Premiile roții și programul Orei duble</li>
<li>Premiul de la bingo (un produs de la sponsor) și cartonașul</li>
<li>Sponsorii: logo-uri, linkuri, codul de reducere</li><li>Linkurile de Discord și rețele</li></ul></section>
<div class="links">
<a href="../?demo" target="_blank" rel="noopener">Site-ul (demo) ↗</a>
<a href="../mod/?demo" target="_blank" rel="noopener">Moderatori (demo) ↗</a>
<a href="../overlay/?demo" target="_blank" rel="noopener">Overlay (demo) ↗</a>
</div>`;

// ---- Twitch simulat bar ------------------------------------------------------
let autoTimer: number | undefined;
function setAuto(on: boolean) {
  clearInterval(autoTimer);
  autoTimer = on ? window.setInterval(() => api.randomEvent(), 3200) : undefined;
  document.querySelector('[data-sim="auto"]')!.setAttribute('aria-pressed', String(on));
}
document.querySelector('.sim')!.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-sim]');
  if (!b) return;
  const who = ['alexx_ro', 'sebastian_77', 'crisss', 'radu_nexus', 'teodora_x'][Math.floor(Math.random() * 5)];
  switch (b.dataset.sim) {
    case 'sub': api.recordEvent('sub', who, '1000'); break;
    case 'tier3': api.recordEvent('sub', who, '3000'); break;
    case 'gift': api.recordEvent('gift', who, '1000', 10); break;
    case 'bits': api.recordEvent('bits', who, null, 500); break;
    case 'donation': api.recordEvent('donation', who, null, 10, 'EUR'); break;
    case 'auto': setAuto(!autoTimer); break;
    case 'reset':
      if (confirm('Resetezi demo-ul la starea de început?')) { setAuto(false); api.reset(); showStep(0); }
      break;
  }
});

// ---- Header readout + background jobs --------------------------------------
function readout() {
  const v = derive({ ...initialState(), now: Date.now() }, api.toSiteData());
  document.getElementById('r-clock')!.textContent = v.navClock;
  const badge = document.getElementById('r-badge')!;
  badge.textContent = v.statusText;
  badge.classList.toggle('live', v.isLive);
  document.getElementById('r-subs')!.textContent = `${fmtInt(api.state.stats.subs)} subs`;
}
api.subscribe(readout);
setInterval(() => { api.tick(); readout(); }, 1000);
readout();

showStep(Math.max(0, (Number(location.hash.slice(1)) || 1) - 1));
