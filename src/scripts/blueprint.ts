// Plays the stream plan (components/StreamBlueprint.astro) on its own in the
// sponsor presentation: the game clock ticks, minion waves walk in and meet,
// Iceman's champion last-hits with his Q and an auto attack (gold, CS, Q
// cooldown, mana), pings come up on the minimap, and Iceman talks on camera
// now and then. say() lets the presentation make him react to demo events.
// With prefers-reduced-motion it stays still and only the speech bubble shows.

const NS = 'http://www.w3.org/2000/svg';
const IDLE = ['HAI CĂ PUTEM!', 'FACEM VISCOL!', 'ÎNCĂ UN MECI?', 'CE PLAY!', 'MERSI PENTRU SUB!', 'MID E AL NOSTRU!'];

// Lane frame, same as the component: D along the mid lane, N across it.
const C = [1000, 600], D = [0.85, -0.527], N = [0.527, 0.85];
const P = (t: number, s: number) => [C[0] + t * N[0] + s * D[0], C[1] + t * N[1] + s * D[1]];
const off = (dt: number, ds: number) => [dt * N[0] + ds * D[0], dt * N[1] + ds * D[1]];
const ENEMY_OFF = [off(-36, 0), off(0, 0), off(36, 0), off(-23, 44), off(23, 44), off(0, 70)];
const ALLY = [P(55, -560), P(55, -110)];
const ENEMY = [P(-5, 470), P(-5, 85)];
const STAFF = [794 + 39 * 1.25, 705 - 116 * 1.25]; // champion position + crystal (drawn at 1.25×)
const LOOP = 9000;
// Minimap spots worth pinging: dragon, baron, the lanes, enemy jungle.
const PINGS = [[1818, 990], [1726, 874], [1660, 930], [1800, 1042], [1750, 952], [1846, 916], [1700, 820], [1884, 900]];

export interface Blueprint { say: (text: string, mood?: 'hype' | 'talk') => void }

export function initBlueprint(svg: SVGSVGElement): Blueprint {
  const q = <T extends Element>(s: string) => svg.querySelector<T>(s)!;
  const cam = q<SVGGElement>('.cam');
  const champ = q<SVGGElement>('.champ');
  const bubble = q<SVGGElement>('[data-bp-bubble]');
  const sayText = q<SVGTextElement>('[data-bp-say]');
  const sayBox = bubble.querySelector('rect')!;
  const fx = q<SVGGElement>('[data-fx]');
  const mapFx = q<SVGGElement>('[data-map-fx]');
  const clock = q<SVGTextElement>('[data-bp-clock]');
  const csEl = q<SVGTextElement>('[data-bp-cs]');
  const goldEl = q<SVGTextElement>('[data-bp-gold]');
  const cd = q<SVGRectElement>('[data-bp-cd]');
  const mana = q<SVGRectElement>('[data-bp-mana]');
  const manaBar = q<SVGRectElement>('[data-bp-manabar]');
  const allyWave = q<SVGGElement>('[data-wave="ally"]');
  const enemyWave = q<SVGGElement>('[data-wave="enemy"]');
  const enemies = [...enemyWave.querySelectorAll<SVGGElement>('[data-i]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const visible = () => svg.getClientRects().length > 0 && !document.hidden;

  let secs = 24 * 60 + 13, cs = 145, gold = 2140, speaking = false;
  const fmtGold = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const addGold = (n: number) => { gold += n; goldEl.textContent = fmtGold(gold); };
  setInterval(() => {
    secs++;
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    if (secs % 2 === 0) addGold(3);
  }, 1000);

  function el(tag: string, attrs: Record<string, string | number>, parent: Element, text?: string) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    parent.append(e);
    return e;
  }

  // ---- Iceman on camera ----
  let sayTimer = 0;
  function say(text: string, mood: 'hype' | 'talk' = 'hype') {
    sayText.textContent = text;
    let w = 0;
    try { w = sayText.getComputedTextLength(); } catch { /* not rendered */ }
    sayBox.setAttribute('width', String(Math.round((w || text.length * 17) + 44)));
    bubble.classList.remove('show');
    cam.classList.remove('hype', 'talking');
    void bubble.getBoundingClientRect(); // restart the pop
    bubble.classList.add('show');
    cam.classList.add(mood === 'hype' ? 'hype' : 'talking');
    speaking = true;
    clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => {
      bubble.classList.remove('show');
      cam.classList.remove('hype', 'talking');
      speaking = false;
    }, 2600);
  }

  if (reduce) return { say };

  // ---- the game ----
  const wavePos = (w: number[][], p: number) => [w[0][0] + (w[1][0] - w[0][0]) * p, w[0][1] + (w[1][1] - w[0][1]) * p];
  let loop = -1, casted = false, autoed = false;
  const t0 = performance.now();

  function hit(i: number, reward: number) {
    const [ex, ey] = wavePos(ENEMY, ((performance.now() - t0) % LOOP) / LOOP);
    const tx = ex + ENEMY_OFF[i][0], ty = ey + ENEMY_OFF[i][1] - 18;
    return { tx, ty, done: () => {
      enemies[i].classList.add('killed');
      const g = el('text', { class: 'gold', x: tx + 14, y: ty - 18 }, fx, `+${reward}`);
      setTimeout(() => g.remove(), 1700);
      addGold(reward); cs++; csEl.textContent = String(cs);
    } };
  }

  function castQ() {
    const { tx, ty, done } = hit(1, 21);
    const [sx, sy] = STAFF;
    const dx = tx - sx, dy = ty - sy, L = Math.hypot(dx, dy), px = -dy / L * 4, py = dx / L * 4;
    const parts = [
      el('path', { class: 'shot', d: `M${sx} ${sy} L${tx} ${ty}`, pathLength: 1 }, fx),
      el('path', { class: 'shot trail', d: `M${sx + px} ${sy + py} L${tx + px} ${ty + py}`, pathLength: 1 }, fx),
      el('circle', { class: 'boom', cx: tx, cy: ty, r: 24 }, fx),
      el('path', { class: 'shard', d: [0, 1, 2, 3, 4, 5].map((k) => { const a = k * Math.PI / 3 + .3; return `M${tx + 10 * Math.cos(a)} ${ty + 7 * Math.sin(a)} L${tx + 22 * Math.cos(a)} ${ty + 15 * Math.sin(a)}`; }).join(' ') }, fx),
    ];
    setTimeout(() => parts.forEach((p) => p.remove()), 1100);
    setTimeout(done, 300);
    champ.classList.add('cast'); setTimeout(() => champ.classList.remove('cast'), 450);
    cd.classList.remove('run'); cd.classList.add('on');
    void cd.getBoundingClientRect();
    cd.classList.add('run'); cd.classList.remove('on');
    mana.setAttribute('width', '50'); manaBar.setAttribute('width', '186');
    setTimeout(() => { mana.setAttribute('width', '66'); manaBar.setAttribute('width', '222'); }, 3000);
  }

  function autoAttack() {
    const { tx, ty, done } = hit(0, 19);
    const [sx, sy] = STAFF;
    const orb = el('circle', { class: 'gem', cx: sx, cy: sy, r: 4 }, fx);
    orb.animate([{ transform: 'translate(0px, 0px)' }, { transform: `translate(${tx - sx}px, ${ty - sy}px)` }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
    setTimeout(() => { orb.remove(); done(); }, 380);
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (!visible()) return;
    const k = Math.floor((now - t0) / LOOP), p = ((now - t0) % LOOP) / LOOP;
    if (k !== loop) { loop = k; casted = autoed = false; enemies.forEach((e) => e.classList.remove('killed')); }
    const fade = p < .08 ? p / .08 : p > .86 ? (1 - p) / .14 : 1;
    const [ax, ay] = wavePos(ALLY, p), [ex, ey] = wavePos(ENEMY, p);
    allyWave.setAttribute('transform', `translate(${ax.toFixed(1)} ${ay.toFixed(1)})`);
    enemyWave.setAttribute('transform', `translate(${ex.toFixed(1)} ${ey.toFixed(1)})`);
    allyWave.style.opacity = enemyWave.style.opacity = String(fade);
    if (!casted && p > .58) { casted = true; castQ(); }
    if (!autoed && p > .72) { autoed = true; autoAttack(); }
  }
  requestAnimationFrame(frame);

  // ---- minimap pings ----
  let last = -1;
  setInterval(() => {
    if (!visible()) return;
    let i = Math.floor(Math.random() * PINGS.length);
    if (i === last) i = (i + 1) % PINGS.length;
    last = i;
    const [x, y] = PINGS[i];
    const g = el('g', {}, mapFx);
    el('circle', { class: 'ping', cx: x, cy: y, r: 13 }, g);
    el('circle', { class: 'ping second', cx: x, cy: y, r: 13 }, g);
    el('path', { class: 'ping-mark', d: `M${x - 1.6} ${y - 8} h3.2 l-.6 9 h-2 Z M${x - 1.6} ${y + 3} h3.2 v3.2 h-3.2 Z` }, g);
    setTimeout(() => g.remove(), 1800);
  }, 6500);

  // ---- Iceman talks now and then ----
  let idle = -1;
  const chatter = () => {
    if (visible() && !speaking) {
      let i = Math.floor(Math.random() * IDLE.length);
      if (i === idle) i = (i + 1) % IDLE.length;
      idle = i;
      say(IDLE[i], 'talk');
    }
  };
  setTimeout(chatter, 7000);
  setInterval(chatter, 22000);

  return { say };
}
