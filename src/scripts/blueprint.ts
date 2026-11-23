// Brings the stream plan (components/StreamBlueprint.astro) to life in the
// sponsor presentation: a ticking game clock, Iceman's webcam that reacts
// (click him, or any demo event calls say()), a skillshot when you click his
// champion, and pings on the minimap. Purely decorative: every step's real
// actions are buttons in the step panel.

const NS = 'http://www.w3.org/2000/svg';
const LINES = ['HAI CĂ PUTEM!', 'GG!', 'FACEM VISCOL!', 'MERSI PENTRU SUB!', 'ÎNCĂ UN MECI?', 'CE PLAY!'];

export interface Blueprint { say: (text: string) => void }

export function initBlueprint(svg: SVGSVGElement): Blueprint {
  const q = <T extends Element>(s: string) => svg.querySelector<T>(s)!;
  const cam = q<SVGGElement>('[data-hit="cam"]');
  const bubble = q<SVGGElement>('[data-bp-bubble]');
  const sayText = q<SVGTextElement>('[data-bp-say]');
  const sayBox = bubble.querySelector('rect')!;
  const fx = q<SVGGElement>('[data-fx]');
  const mapFx = q<SVGGElement>('[data-map-fx]');
  const clock = q<SVGTextElement>('[data-bp-clock]');
  const csEl = q<SVGTextElement>('[data-bp-cs]');
  const goldEl = q<SVGTextElement>('[data-bp-gold]');
  const cd = q<SVGRectElement>('[data-bp-cd]');

  let secs = 24 * 60 + 13, cs = 142, gold = 2140, last = -1;
  const fmtGold = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  setInterval(() => {
    secs++;
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (secs % 4 === 0) { cs++; csEl.textContent = String(cs); }
    if (secs % 2 === 0) { gold += 3; goldEl.textContent = fmtGold(gold); }
  }, 1000);

  function el(tag: string, attrs: Record<string, string | number>, parent: Element, text?: string) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    parent.append(e);
    return e;
  }
  const later = (e: Element, ms: number) => setTimeout(() => e.remove(), ms);

  let sayTimer = 0;
  function say(text: string) {
    sayText.textContent = text;
    let w = 0;
    try { w = sayText.getComputedTextLength(); } catch { /* hidden */ }
    sayBox.setAttribute('width', String(Math.round((w || text.length * 17) + 44)));
    bubble.classList.remove('show');
    cam.classList.remove('hype');
    void bubble.getBoundingClientRect(); // restart the animations
    bubble.classList.add('show');
    cam.classList.add('hype');
    clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => { bubble.classList.remove('show'); cam.classList.remove('hype'); }, 2600);
  }

  cam.addEventListener('click', () => {
    let i = Math.floor(Math.random() * LINES.length);
    if (i === last) i = (i + 1) % LINES.length;
    last = i;
    say(LINES[i]);
  });

  // Skillshot from the staff up the lane, hits the enemy wave, +gold.
  let cooling = false;
  q('[data-hit="champ"]').addEventListener('click', () => {
    if (cooling) return;
    cooling = true;
    const [x1, y1, x2, y2] = [836, 598, 1196, 452]; // staff tip → the enemy wave
    el('path', { class: 'shot', d: `M${x1} ${y1} L${x2} ${y2}`, pathLength: 1 }, fx);
    el('circle', { class: 'boom', cx: x2, cy: y2, r: 34 }, fx);
    el('text', { class: 'gold', x: x2 + 20, y: y2 - 20 }, fx, '+21');
    [...fx.children].forEach((c) => later(c, 1600));
    gold += 21; cs++;
    goldEl.textContent = fmtGold(gold); csEl.textContent = String(cs);
    cd.classList.remove('run'); cd.classList.add('on');
    void cd.getBoundingClientRect();
    cd.classList.add('run'); cd.classList.remove('on');
    setTimeout(() => { cooling = false; cd.classList.remove('run'); }, 3000);
  });

  // Ping wherever the minimap is clicked.
  q('[data-hit="map"]').addEventListener('click', (e) => {
    const m = svg.getScreenCTM();
    if (!m) return;
    const p = new DOMPoint((e as MouseEvent).clientX, (e as MouseEvent).clientY).matrixTransform(m.inverse());
    const g = el('g', {}, mapFx);
    el('circle', { class: 'ping', cx: p.x, cy: p.y, r: 16 }, g);
    el('circle', { class: 'ping', cx: p.x, cy: p.y, r: 16 }, g);
    later(g, 1400);
  });

  return { say };
}
