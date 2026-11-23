// Sponsor presentation (/sponsori): steps on the left, the real site and the
// stream overlay on the right, all showing the visitor's own brand. Runs on
// its own copy of the demo backend ('pitch'), apart from /prezentare and ?demo.

import { pitch } from '../data/pitch';
import { site } from '../data/site';
import { DemoBackend } from '../demo/backend';
import { esc } from '../lib/views';
import { initBlueprint } from './blueprint';

const api = new DemoBackend('pitch');
const compact = matchMedia('(max-width: 1000px)');
type View = 'site' | 'stream' | 'report' | 'packages';
interface Action { label: string; primary?: boolean; run: () => void }
interface Step { title: string | (() => string); view: View; scroll?: string; focus?: 'double' | 'code' | 'promo' | 'wins'; body: () => string; actions?: Action[]; enter?: () => void }

// ---- The brand being pitched ---------------------------------------------------
const BRAND_KEY = 'icemaraton:pitch-brand';
const brandInput = document.getElementById('brand') as HTMLInputElement;
let brand = '';
try { brand = localStorage.getItem(BRAND_KEY) ?? ''; } catch { /* storage blocked */ }
const params = new URLSearchParams(location.search);
if (params.get('brand')) brand = params.get('brand')!.slice(0, 40);
brandInput.value = brand;
const B = () => brand.trim() || 'Brandul vostru';
const b = () => `<strong>${esc(B())}</strong>`;

// ---- Talking to the embedded site and overlay ------------------------------------
const siteFrame = () => document.querySelector<HTMLIFrameElement>('.frame[data-name="site"] iframe');
// The stream plan's webcam: Iceman reacts to what the sponsor tries.
const bpSvg = document.querySelector<SVGSVGElement>('#blueprint svg');
const blueprint = bpSvg ? initBlueprint(bpSvg) : null;
const say = (text: string) => blueprint?.say(text);

function post(msg: Record<string, unknown>) {
  siteFrame()?.contentWindow?.postMessage({ icemaraton: 'demo', ...msg }, location.origin);
}
const scrollSite = (id: string) => post({ scrollTo: id });
const pushBrand = () => post({ brand: B() });
function overlay(promoNow = false) {
  const f = document.querySelector<HTMLIFrameElement>('iframe[data-overlay-src]');
  if (!f) return;
  const src = `${f.dataset.overlaySrc}&brand=${encodeURIComponent(B())}${promoNow ? '&promoNow' : ''}`;
  if (f.src !== new URL(src, location.href).href) f.src = src;
}
const note = (text: string) => {
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--ice);font-weight:700';
  p.textContent = text;
  document.getElementById('step')!.append(p);
  setTimeout(() => p.remove(), 6000);
};

// Keep the demo looking like a live marathon, with the brand on its moments.
function prepare() {
  api.reset();
  api.setStatus('live');
  api.brandEverything(B());
  api.doubleHour(Date.now() + 2 * 3_600_000, 60, B());
}

// ---- The steps (Romanian: for brands) -------------------------------------------
const steps: Step[] = [
  {
    title: 'ICEMARATON, pe scurt', view: 'site', scroll: 'top',
    body: () => `<p><strong>ICEMARATON</strong> e subathonul de Crăciun al lui <strong>Icemanlucky</strong> pe Twitch: un stream care nu se oprește cât timp comunitatea adaugă timp. Fiecare donație și fiecare sub prelungesc cronometrul.</p>
<ul>${pitch.audience.map((a) => `<li><strong>${esc(a.value)}</strong> ${esc(a.label)}</li>`).join('')}</ul>
<p>Lângă stream există un site interactiv: vot pe provocări, roata cu premii, bingo, milestone-uri. ${compact.matches ? 'Deasupra' : 'În dreapta'} e chiar site-ul, cu ${b()} ca partener.</p>`,
    actions: [{ label: 'Vezi-vă brandul pe site', primary: true, run: () => scrollSite('parteneri') }],
  },
  {
    title: () => `${B()}, în prim-plan`, view: 'site', scroll: 'top',
    body: () => `<p>Partenerul principal stă <strong>sub cronometru</strong>, locul la care se uită toată lumea: «Prezentat de ${esc(B())}».</p>
<p>Imediat după cronometru vine secțiunea de parteneri: oferta voastră, <strong>codul de reducere</strong> (cu buton de copiere) și linkul. E primul link din meniul site-ului.</p>`,
    actions: [
      { label: 'Sub cronometru', primary: true, run: () => scrollSite('top') },
      { label: 'Secțiunea de parteneri', run: () => scrollSite('parteneri') },
    ],
  },
  {
    title: () => `Ora dublă oferită de ${B()}`, view: 'stream', focus: 'double',
    body: () => `<p><strong>Ora dublă</strong> e cea mai intensă oră a zilei: tot timpul adăugat valorează dublu, așa că atunci vin cele mai multe donații.</p>
<p>Ora poartă numele vostru: pe site, pe stream («ORA DUBLĂ ×2 · oferită de ${esc(B())}») și în ce spune Iceman.</p>`,
    actions: [
      { label: 'Pornește Ora dublă', primary: true, run: () => { api.doubleHour(Date.now(), 60, B()); overlay(); say(`ORA DUBLĂ! MERSI, ${B().toUpperCase()}!`); } },
      { label: 'O donație de 20 €', run: () => { api.recordEvent('donation', 'ninsoare_ana', null, 20, 'EUR'); say('MERSI, NINSOARE_ANA!'); } },
    ],
    enter: () => { api.codeEnd(); overlay(); },
  },
  {
    title: () => `Câștigătorii, «de la ${B()}»`, view: 'stream', focus: 'wins',
    body: () => `<p>Premiile de pe roată poartă numele vostru. De fiecare dată când cineva câștigă, pe stream apare: «<em>snowdrift_tv a câștigat căștile de la ${esc(B())}</em>».</p>
<p>Roata se învârte de zeci de ori pe zi, deci numele vostru apare legat de un moment bun, din nou și din nou.</p>`,
    actions: [{ label: 'Simulează un câștigător', primary: true, run: () => { api.fakeWin(); say('FELICITĂRI!'); } }],
    enter: () => { api.codeEnd(); overlay(); },
  },
  {
    title: () => `Premiile de la ${B()}, pe site`, view: 'site', scroll: 'roata',
    body: () => `<p>Pe site, aceleași premii apar «de la ${esc(B())}»: pe roată, la ultimele premii câștigate, la un milestone și la marele premiu de la bingo.</p>`,
    actions: [
      { label: 'Roata și câștigătorii', primary: true, run: () => scrollSite('roata') },
      { label: 'Milestone-ul vostru', run: () => scrollSite('goals') },
      { label: 'Premiul de la bingo', run: () => scrollSite('joaca') },
    ],
  },
  {
    title: 'Codul secret', view: 'stream', focus: 'code',
    body: () => `<p>Un joc care face oamenii să fie atenți la momentul vostru: când Iceman vă prezintă, pe stream apare un <strong>cod secret</strong> pentru câteva minute.</p>
<p>Cine îl scrie pe site primește o <strong>rotire bonus</strong> la roată. Oamenii ascultă mesajul vostru pentru că le aduce ceva, și ajung pe site, unde e oferta voastră.</p>`,
    actions: [
      { label: 'Arată un cod pe stream', primary: true, run: () => { const c = api.codeShow(B(), 10); note('Pe stream: ' + c.code); say('SCRIEȚI CODUL PE SITE!'); } },
      { label: '50 de viewers îl revendică', run: () => { api.simulateClaims(50); note('+50 de revendicări'); say('50 DE ROTIRI BONUS!'); } },
    ],
    enter: () => overlay(),
  },
  {
    title: 'Discret, dar constant', view: 'stream', focus: 'promo',
    body: () => `<p>La fiecare 10 minute, overlay-ul arată 10 secunde «Partener: ${esc(B())} · codul vostru», doar când nu se întâmplă altceva.</p>
<p>Fără clipeli și fără să acopere jocul. Restul timpului, numele vostru apare doar la momentele care contează.</p>`,
    actions: [{ label: 'Arată mențiunea', primary: true, run: () => { overlay(true); say(`MERSI, ${B().toUpperCase()}!`); } }],
    enter: () => { api.codeEnd(); overlay(); },
  },
  {
    title: 'Raportul vostru', view: 'report',
    body: () => `<p>La final primiți un raport cu ce a adus parteneriatul: click-uri pe linkul vostru, coduri de reducere copiate, coduri secrete revendicate, donațiile din orele voastre și câți oameni erau pe stream atunci.</p>
<p>Click-urile se numără fără date personale. ${compact.matches ? 'Deasupra' : 'În dreapta'} e un exemplu cu cifre din această demonstrație.</p>`,
    enter: () => renderReport(),
  },
  {
    title: 'Pachete', view: 'packages',
    body: () => `<p>Trei feluri de a fi alături de ICEMARATON, plus câteva idei speciale pe care le construim împreună.</p>
<p>Premiile se dau mereu prin tragere gratuită: nu vindem șanse, ca totul să rămână corect pentru comunitate.</p>`,
    enter: () => renderPackages(),
  },
];

// ---- Report and packages -------------------------------------------------------
function renderReport() {
  const r = api.sponsorReport();
  const x = r.sponsors.find((s) => s.sponsor === B()) ?? r.sponsors[0];
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('ro-RO'));
  document.getElementById('report')!.innerHTML = `
<section class="card ice" style="grid-column: 1 / -1"><span class="tag">EXEMPLU</span><h2 style="margin-top:10px">Raport ICEMARATON · ${esc(B())}</h2>
<p style="margin:0;color:#AEB8C7">Cifre din demonstrație. Raportul real se face din datele maratonului și îl primiți la final.</p></section>
<div class="metrics">
  <div class="metric"><b>${fmt(x?.clicks)}</b><span>click-uri pe linkul vostru</span></div>
  <div class="metric"><b>${fmt(x?.code_copies)}</b><span>coduri de reducere copiate</span></div>
  <div class="metric"><b>${fmt(x?.code_claims)}</b><span>coduri secrete revendicate (${fmt(x?.codes_shown)} afișate)</span></div>
  <div class="metric"><b>${fmt(x?.donated_in_hours)} €</b><span>donate în orele duble oferite de voi (${fmt(x?.double_hours)})</span></div>
  <div class="metric"><b>${fmt(x?.peak_in_hours)}</b><span>viewers în chat la vârf, în orele voastre</span></div>
  <div class="metric"><b>${fmt(x?.wins)}</b><span>premii câștigate «de la» voi</span></div>
</div>
<section class="card" style="grid-column: 1 / -1"><h2>Maratonul în total</h2><p style="margin:0;color:#C9D2DF">Vârf de <strong>${fmt(r.peak_chatters)}</strong> viewers în chat · <strong>${fmt(r.watch_hours)}</strong> ore privite · <strong>${fmt(r.raised)} €</strong> strânși (exemplu).</p></section>`;
}

function renderPackages() {
  const contact = site.contactEmail.startsWith('[') ? '' : site.contactEmail;
  document.getElementById('packages')!.innerHTML = `
${pitch.packages.map((p) => `<section class="card pkg${p.highlight ? ' ice' : ''}">
  ${p.highlight ? '<span class="tag">CEL MAI VIZIBIL</span>' : ''}<h2 style="margin-top:${p.highlight ? '10px' : '0'}">${esc(p.name)}</h2>
  <p class="seats">${esc(p.seats)}</p>
  <ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
  <p class="price">${esc(p.price)}</p>
</section>`).join('')}
<section class="card" style="grid-column: 1 / -1"><h2>Idei speciale, la discuție</h2>
  <ul>${pitch.extras.map((e) => `<li><strong style="color:#F2F5FA">${esc(e.title)}</strong>: ${esc(e.text)}</li>`).join('')}</ul></section>
<div class="links">
  ${contact ? `<a href="mailto:${esc(contact)}?subject=${encodeURIComponent('Parteneriat ICEMARATON · ' + B())}">Scrie-ne: ${esc(contact)}</a>` : '<span style="color:#8C97A8">Contact: [EMAIL CONTACT]</span>'}
  <a href="../" target="_blank" rel="noopener">Site-ul ICEMARATON ↗</a>
</div>`;
}

// ---- Frames: create on first view, scale to fit ---------------------------------
const stage = document.getElementById('stage')!;
const frames = [...document.querySelectorAll<HTMLElement>('.frame')];
function ensureFrame(frame: HTMLElement) {
  if (frame.dataset.src && !frame.querySelector('iframe')) {
    const f = document.createElement('iframe');
    f.src = frame.dataset.src;
    f.title = 'Site-ul ICEMARATON (demo)';
    f.style.width = `${frame.dataset.w}px`;
    f.style.height = `${frame.dataset.h}px`;
    // Once the site has loaded, show the brand on it.
    f.addEventListener('load', () => { setTimeout(pushBrand, 400); setTimeout(pushBrand, 1500); });
    frame.append(f);
  }
}
function fit(frame: HTMLElement) {
  const box = frame.parentElement!;
  const inner = frame.querySelectorAll<HTMLElement>('iframe, .scene');
  if (compact.matches && frame.dataset.src) {
    const bw = box.clientWidth, bh = box.clientHeight;
    if (!bw || !bh) return;
    Object.assign(frame.style, { width: `${bw}px`, height: `${bh}px`, left: '0', top: '0' });
    inner.forEach((el) => Object.assign(el.style, { width: `${bw}px`, height: `${bh}px`, transform: 'none' }));
    return;
  }
  const w = Number(frame.dataset.w), h = Number(frame.dataset.h);
  const s = Math.min((box.clientWidth - 2) / w, (box.clientHeight - 2) / h);
  if (!(s > 0)) return;
  frame.style.width = `${w * s}px`;
  frame.style.height = `${h * s}px`;
  frame.style.left = `${(box.clientWidth - w * s - 2) / 2}px`;
  frame.style.top = `${(box.clientHeight - h * s - 2) / 2}px`;
  inner.forEach((el) => Object.assign(el.style, { width: `${w}px`, height: `${h}px`, transform: `scale(${s})` }));
}
new ResizeObserver(() => frames.forEach(fit)).observe(stage);

// ---- Rendering a step -----------------------------------------------------------
let current = 0;
const toc = document.getElementById('toc')!;
const stepEl = document.getElementById('step')!;
const titleOf = (s: Step) => (typeof s.title === 'function' ? s.title() : s.title);
const drawToc = () => { toc.innerHTML = steps.map((s, i) => `<li><button type="button" data-goto="${i}" title="${esc(titleOf(s))}"${i === current ? ' aria-current="step"' : ''}>${i + 1}</button></li>`).join(''); };

function showStep(i: number) {
  current = Math.max(0, Math.min(steps.length - 1, i));
  const s = steps[current];
  drawToc();
  stepEl.innerHTML = `<span class="num">${String(current + 1).padStart(2, '0')} / ${steps.length}</span><h1>${esc(titleOf(s))}</h1>${s.body()}
${s.actions?.length ? `<div class="try"><p class="try-label">Vedeți cum arată</p><div class="acts">${s.actions.map((a, k) => `<button type="button" class="act${a.primary ? ' primary' : ''}" data-act="${k}">${esc(a.label)}</button>`).join('')}</div></div>` : ''}`;
  document.querySelectorAll<HTMLElement>('.view').forEach((v) => { v.hidden = v.dataset.view !== s.view; });
  const visible = document.querySelector<HTMLElement>(`.view[data-view="${s.view}"]`)!;
  visible.querySelectorAll<HTMLElement>('.frame').forEach((f) => { ensureFrame(f); fit(f); });
  // Blueprint: brand on the callouts, and replay the drawing for this step's focus.
  const bp = document.getElementById('blueprint');
  if (bp) {
    bp.querySelectorAll('[data-bp-brand]').forEach((t) => { t.textContent = B().toUpperCase(); });
    bp.dataset.focus = '';
    requestAnimationFrame(() => { bp.dataset.focus = s.focus ?? ''; });
  }
  s.enter?.();
  if (s.scroll) setTimeout(() => { scrollSite(s.scroll!); pushBrand(); }, 300);
  (document.getElementById('prev') as HTMLButtonElement).disabled = current === 0;
  (document.getElementById('next') as HTMLButtonElement).textContent = current === steps.length - 1 ? 'De la început ↺' : 'Mai departe →';
  history.replaceState(null, '', `${location.search}#${current + 1}`);
  stepEl.scrollTop = 0;
}
compact.addEventListener('change', () => showStep(current));

stepEl.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (btn) steps[current].actions?.[Number(btn.dataset.act)]?.run();
});
toc.addEventListener('click', (e) => {
  const btn = (e.target as Element).closest<HTMLElement>('[data-goto]');
  if (btn) showStep(Number(btn.dataset.goto));
});
document.getElementById('prev')!.addEventListener('click', () => showStep(current - 1));
document.getElementById('next')!.addEventListener('click', () => showStep(current === steps.length - 1 ? 0 : current + 1));
document.addEventListener('keydown', (e) => {
  if ((e.target as Element).closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight' || e.key === 'PageDown') showStep(current + 1);
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') showStep(current - 1);
});

// Typing the brand: everything follows (site, overlay, demo data, step text).
let brandTimer: number | undefined;
brandInput.addEventListener('input', () => {
  brand = brandInput.value.slice(0, 40);
  try { localStorage.setItem(BRAND_KEY, brand); } catch { /* storage blocked */ }
  clearTimeout(brandTimer);
  brandTimer = window.setTimeout(() => {
    api.brandEverything(B());
    const t = api.state.timer;
    if (t.doubleFrom !== null) api.doubleHour(t.doubleFrom, Math.round(((t.doubleUntil ?? t.doubleFrom) - t.doubleFrom) / 60_000) || 60, B());
    pushBrand();
    if (steps[current].view === 'stream') overlay();
    showStep(current);
  }, 450);
});

setInterval(() => api.tick(), 1000);
prepare();
showStep(Math.max(0, (Number(location.hash.slice(1)) || 1) - 1));
