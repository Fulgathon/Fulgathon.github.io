// The raffle on stream, in the OBS piece «Tragerea la sorți» (owner, 25 Nov 2026). Solid while a raffle
// is on stream (the streamer hides the source from his Stream Deck when he wants), gone when it ends.
//   open   → «Viscol de nume»: everyone who entered falls through the box like snow; a new entrant first
//            drops in big in the middle with an ice burst, then joins the snow. Live count on top.
//   closed → the snow fades, the reel stands still, the middle row breathes (waiting for the draw).
//   drawn  → 3·2·1, then the reel spins 18 s and stops on the winner the server already picked; the winner
//            stays on screen (also after an OBS reload) until the raffle leaves the stream.
// «Arată din nou pe stream» (a newer shownAt) plays the countdown and the spin again.

import type { RaffleStage } from '../data/types';
import { count } from '../lib/format';
import type { OverlaySound } from './overlay-sound';

const ROW = 64;          // reel row height (same as the bingo reel)
const SPIN = 18_000;     // the same suspense as the bingo draw
const ROWS = 150;
const EASE = 2.4;
const COUNT_STEP = 900;  // 3 · 2 · 1, each beat
const FLAKES = 18;       // names falling at once (more gets crowded)
const esc = (t: unknown) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const shuffle = <T>(a: T[]) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
/** Rewrite only when the text changed: a same-text rewrite makes OBS repaint for nothing. */
const setHtml = (e: HTMLElement, html: string) => { if (e.dataset.html !== html) { e.dataset.html = html; e.innerHTML = html; } };
const rewardTitle = (prize: string) => { const t = `Tombolă: ${prize.trim()}`; return t.length > 45 ? `${t.slice(0, 44).trimEnd()}…` : t; };
const ruleLine = (r: RaffleStage) => r.rule === 'points'
  ? `Puncte de canal: <b>${esc(rewardTitle(r.prize))}</b> · <b>${esc(new Intl.NumberFormat('ro-RO').format(r.cost ?? 0))}</b> puncte`
  : r.rule === 'subs' ? 'Intră <b>abonații</b> de pe icemanlucky.ro'
  : r.rule === 'hours' ? `Intră cine are <b>${esc(String(r.hours ?? '').replace('.', ','))} ore privite</b>`
  : 'Intră toți de pe <b>icemanlucky.ro</b>';

export function rafflePanel(el: HTMLElement, calm: boolean, sound: OverlaySound) {
  el.innerHTML = `<div class="rf-head"><span class="dr-tag">TOMBOLĂ</span><span class="rf-prize"></span><span class="rf-count"><b></b> <i></i></span></div>
    <div class="rf-box">
      <div class="rf-snow"></div>
      <div class="rf-drop"></div>
      <p class="rf-empty">Fii primul care intră!</p>
      <div class="dr-reel rf-reel"><ul class="dr-list"></ul><div class="dr-frame"></div><div class="dr-burst"></div><div class="dr-shards">${Array.from({ length: 12 }, (_, i) => `<i style="--a:${i * 30}deg"></i>`).join('')}</div></div>
      <div class="rf-three" aria-hidden="true"></div>
    </div>
    <div class="rf-foot"></div>`;
  const q = <T extends HTMLElement = HTMLElement>(s: string) => el.querySelector<T>(s)!;
  const prizeEl = q('.rf-prize'), countB = q('.rf-count b'), countI = q('.rf-count i'), snow = q('.rf-snow'), drop = q('.rf-drop');
  const empty = q('.rf-empty'), list = q<HTMLUListElement>('.dr-list'), three = q('.rf-three'), foot = q('.rf-foot');

  let stage: RaffleStage | null = null;
  let shownId = 0, shownPhase = '', seenDraw = 0, lastCount = -1;
  let names: string[] = [];            // what the snow uses
  const known = new Set<string>();     // entrants already on screen (new ones drop in)
  const dropQ: string[] = [];
  let dropping = false, run = 0;

  // ---- Snow of names -----------------------------------------------------------------------
  // Each name is on screen once at a time: with few entrants, fewer flakes fall.
  let nameAt = 0;
  const onScreen = () => new Set(flakes.filter((f) => !f.hidden).map((f) => f.textContent ?? ''));
  const nextName = (mine: string) => {
    const busy = onScreen();
    busy.delete(mine);
    for (let i = 0; i < names.length; i++) {
      const n = names[nameAt++ % names.length];
      if (!busy.has(n)) return n;
    }
    return '';
  };
  const flakes: HTMLElement[] = [];
  function placeFlake(f: HTMLElement, first: boolean) {
    const n = nextName(f.textContent ?? '');
    f.textContent = n;
    f.style.setProperty('--x', `${4 + Math.random() * 82}%`);
    f.style.setProperty('--sway', `${(Math.random() * 2 - 1) * 46}px`);
    f.style.setProperty('--fs', `${20 + Math.round(Math.random() * 14)}px`);
    f.style.setProperty('--op', `${0.45 + Math.random() * 0.5}`);
    // The speed is set once: changing a running animation's duration makes it jump mid-box.
    if (first) { f.style.animationDuration = `${9 + Math.random() * 8}s`; f.style.animationDelay = `${-Math.random() * 14}s`; }
    f.hidden = !n;
  }
  function buildSnow() {
    if (flakes.length) return;
    for (let i = 0; i < FLAKES; i++) {
      const f = document.createElement('span');
      f.className = 'rf-flake';
      placeFlake(f, true);
      f.addEventListener('animationiteration', () => placeFlake(f, false));
      snow.append(f);
      flakes.push(f);
    }
  }
  // An empty flake that now gets a name starts again from the top (fading in), never mid-box.
  function refreshFlakes() {
    flakes.forEach((f) => {
      if (!f.hidden && f.textContent) return;
      placeFlake(f, false);
      if (f.hidden) return;
      f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
      f.style.animationDuration = `${9 + Math.random() * 8}s`;
      f.style.animationDelay = `${Math.random() * 4}s`;
    });
  }

  // ---- A new entrant drops in --------------------------------------------------------------
  async function dropLoop() {
    if (dropping) return;
    dropping = true;
    while (dropQ.length && stage?.phase === 'open') {
      // A rush (many at once): one card with how many joined, then on.
      const batch = dropQ.length > 6 ? dropQ.splice(0, dropQ.length) : [dropQ.shift()!];
      drop.innerHTML = batch.length > 1
        ? `<span class="rf-plus">+${batch.length}</span><span class="rf-dname">au intrat acum</span><span class="rf-dsub">${esc(batch.slice(0, 3).join(' · '))}…</span>`
        : `<span class="rf-plus">+1</span><span class="rf-dname">${esc(batch[0])}</span><span class="rf-dsub">a intrat în tombolă</span>`;
      drop.classList.remove('go'); void drop.offsetWidth; drop.classList.add('go');
      await new Promise((r) => setTimeout(r, calm ? 1400 : 2100));
    }
    dropping = false;
  }

  // ---- The reel ----------------------------------------------------------------------------
  function stillReel(pool: string[], center?: string) {
    const base = pool.length ? shuffle(pool) : ['…'];
    const seq: string[] = [];
    while (seq.length < 7) seq.push(...base);
    const mid = center ?? seq[2];
    seq[2] = mid;
    list.innerHTML = seq.slice(0, 7).map((n, i) => `<li${i === 2 ? ' class="win at"' : ''}>${esc(n)}</li>`).join('');
    list.style.transition = 'none';
    list.style.transform = 'translateY(0)';
  }
  function spin(winner: string, entrants: string[]) {
    const my = ++run;
    const pool = entrants.length ? entrants : [winner];
    const seq: string[] = [];
    while (seq.length < ROWS + 2) {
      const block = shuffle(pool);
      if (pool.length > 1 && block[0] === seq[seq.length - 1]) block.push(block.shift()!);
      seq.push(...block);
    }
    const at = seq.length;
    for (let i = Math.max(0, at - 10); i < at; i++) {
      if (seq[i] !== winner) continue;
      const j = seq.findIndex((n, k) => k < at - 10 && n !== winner);
      if (j >= 0) [seq[i], seq[j]] = [seq[j], seq[i]];
    }
    const rest = pool.filter((n) => n !== winner);
    const after = rest.length ? rest : pool;
    seq.push(winner, after[0], after[1 % after.length]);
    list.innerHTML = seq.map((n, i) => `<li${i === at ? ' class="win"' : ''}>${esc(n)}</li>`).join('');
    const rows = [...list.children] as HTMLElement[];
    const endPx = (at - 2) * ROW;
    let landed = false;
    const finish = () => {
      if (my !== run || landed) return;
      landed = true;
      list.style.transform = `translateY(${-endPx}px)`;
      rows.forEach((r) => r.classList.remove('at'));
      el.classList.add('won');
      sound.win();
      showWinnerFoot();
    };
    el.classList.remove('won', 'still');
    if (calm) { finish(); return; }
    list.style.transition = 'none';
    const start = at - 2 - ROWS;
    list.style.transform = `translateY(${-start * ROW}px)`;
    const t0 = performance.now();
    sound.whoosh();
    let lit = -1;
    const step = (now: number) => {
      if (my !== run) return;
      const t = Math.min(1, (now - t0) / SPIN);
      const y = (start + (1 - Math.pow(1 - t, EASE)) * ROWS) * ROW;
      list.style.transform = `translateY(${-y}px)`;
      const m = Math.round(y / ROW) + 2;
      if (m !== lit) { rows[lit]?.classList.remove('at'); rows[m]?.classList.add('at'); if (lit >= 0) sound.tick(t); lit = m; }
      if (t < 1) requestAnimationFrame(step); else finish();
    };
    requestAnimationFrame(step);
    window.setTimeout(finish, SPIN + 500);   // a hidden source still lands on time
  }
  async function countdownThenSpin(winner: string, entrants: string[]) {
    const my = ++run;
    el.classList.remove('won', 'still');
    el.classList.add('counting');
    setHtml(foot, '<span class="rf-wait">EXTRAGEREA ÎNCEPE</span>');
    for (const n of ['3', '2', '1']) {
      if (my !== run) return;
      three.textContent = n;
      three.classList.remove('beat'); void three.offsetWidth; three.classList.add('beat');
      sound.beep(n === '1');
      await new Promise((r) => setTimeout(r, calm ? 500 : COUNT_STEP));
    }
    if (my !== run) return;
    three.textContent = '';
    el.classList.remove('counting');
    setHtml(foot, '<span class="rf-wait">SE TRAGE LA SORȚI…</span>');
    spin(winner, entrants);
  }
  function showWinnerFoot() {
    if (!stage) return;
    const others = stage.winners.slice(0, -1);
    setHtml(foot, `<span class="dr-won">CÂȘTIGĂTOR</span><span class="dr-prize">${esc(stage.prize)}${stage.sponsor ? ` <span class="spon">· de la ${esc(stage.sponsor)}</span>` : ''}</span>${others.length ? `<span class="rf-prev">înainte: ${esc(others.join(' · '))}</span>` : ''}`);
  }

  // ---- State -------------------------------------------------------------------------------
  function update(next: RaffleStage | null) {
    if (!next) {
      if (stage) { el.classList.remove('show'); run++; }
      stage = null; shownId = 0; shownPhase = '';
      return;
    }
    const firstOfRaffle = next.id !== shownId;
    if (firstOfRaffle) { known.clear(); dropQ.length = 0; seenDraw = 0; lastCount = -1; el.classList.remove('won', 'still', 'counting'); }
    stage = next;
    el.classList.add('show');
    el.dataset.phase = next.phase;
    setHtml(prizeEl, `${esc(next.prize)}${next.sponsor ? ` <span class="spon">· de la ${esc(next.sponsor)}</span>` : ''}`);
    if (next.count !== lastCount) {
      countB.textContent = new Intl.NumberFormat('ro-RO').format(next.count);
      countI.textContent = count(next.count, 'participant', 'participanți').replace(/^[\d.\s]+/, '');
      if (lastCount >= 0 && next.count > lastCount) { countB.classList.remove('bump'); void countB.offsetWidth; countB.classList.add('bump'); }
      lastCount = next.count;
    }
    const pool = next.rule === 'points' ? next.entries.map((e) => e.name) : next.sample;
    names = pool.length ? shuffle(pool) : [];

    if (next.phase === 'open') {
      buildSnow();
      refreshFlakes();
      empty.hidden = pool.length > 0;
      setHtml(foot, `<span class="rf-rule">${ruleLine(next)}</span>`);
      if (next.rule === 'points') {
        // Entrants not seen yet drop in, oldest first (not on the first look at this raffle).
        const fresh = next.entries.filter((e) => !known.has(e.name)).reverse();
        fresh.forEach((e) => known.add(e.name));
        if (!firstOfRaffle && shownPhase === 'open') { dropQ.push(...fresh.map((e) => e.name)); void dropLoop(); }
      }
    } else if (next.phase === 'closed') {
      if (shownPhase !== 'closed' || firstOfRaffle) {
        run++;
        stillReel(pool);
        el.classList.add('still');
        el.classList.remove('won');
      }
      setHtml(foot, '<span class="rf-wait">ÎNSCRIERI ÎNCHISE · URMEAZĂ EXTRAGEREA</span>');
    } else if (next.phase === 'drawn' && next.draw) {
      const d = next.draw;
      const fresh = d.shownAt > seenDraw;
      seenDraw = Math.max(seenDraw, d.shownAt);
      if (fresh && Date.now() - d.shownAt < 90_000) void countdownThenSpin(d.name, d.entrants);
      else if (firstOfRaffle || shownPhase !== 'drawn') {
        // Already drawn (OBS reloaded, or switched back to this raffle): the winner, standing.
        run++;
        stillReel(d.entrants, d.name);
        el.classList.remove('still');
        el.classList.add('won', 'landed');
        showWinnerFoot();
      } else if (el.classList.contains('won')) showWinnerFoot();
    }
    shownId = next.id;
    shownPhase = next.phase;
  }
  return { update };
}
