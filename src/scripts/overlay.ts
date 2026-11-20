// OBS overlay: same live data and maths as the site (Live + derive).
// Default is a slim strip in a corner; ?style=box gives the large box.
// ?demo shows the design's sample data and pops a sample event every 10 s,
// for placing the overlay in OBS before the subathon.

import { emptyData, sampleData } from '../data/sample';
import type { SiteData } from '../data/types';
import { derive, initialState } from '../lib/derive';

const params = new URLSearchParams(location.search);
const show = new Set((params.get('show') ?? 'timer,goal,events').split(','));
const boxStyle = params.get('style') === 'box';
const pos = ['tr', 'tl', 'br', 'bl'].includes(params.get('pos') ?? '') ? params.get('pos')! : 'tr';
const scale = Math.min(2, Math.max(0.6, Number(params.get('scale')) || 1));

document.body.className = `pos-${pos}`;
document.documentElement.style.setProperty('--scale', String(scale));

// Only the chosen style, and only the chosen parts.
const root = document.getElementById(boxStyle ? 'box' : 'compact')!;
document.getElementById(boxStyle ? 'compact' : 'box')!.hidden = true;
root.hidden = false;
const eventEl = boxStyle ? document.querySelector<HTMLElement>('.box-event')! : root.querySelector<HTMLElement>('.chip')!;
eventEl.hidden = !show.has('events');
root.querySelectorAll<HTMLElement>('[data-part]').forEach((el) => { el.hidden = !show.has(el.dataset.part!); });
if (!show.has('timer') && !show.has('goal')) (boxStyle ? root : document.getElementById('strip')!).hidden = true;

const all = (sel: string) => root.querySelectorAll<HTMLElement>(sel);
let data: SiteData = emptyData();
let lastTop = '';

function draw() {
  const v = derive({ ...initialState(), now: Date.now() }, data);
  const set = (sel: string, text: string) => all(sel).forEach((el) => { if (el.textContent !== text) el.textContent = text; });
  set('[data-clock]', v.navClock);
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) set(`[data-unit="${k}"]`, v[k]);
  set('[data-label]', v.timerLabel);
  set('[data-badge]', v.statusText);
  all('[data-badge]').forEach((el) => el.classList.toggle('live', v.isLive));
  set('[data-goal-title]', v.nextGoalTitle);
  set('[data-progress]', v.progressLabel);
  all('[data-fill]').forEach((el) => { el.style.width = v.progressPct; });
}

let hideTimer: number | undefined;
function popEvent(time: string, user: string, what: string) {
  if (!show.has('events')) return;
  eventEl.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = time;
  eventEl.append(b, ` ${user} · ${what}`);
  eventEl.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => eventEl.classList.remove('show'), boxStyle ? 8000 : 6000);
}

if (params.has('demo')) {
  data = sampleData(Date.now());
  let i = 0;
  const next = () => { const t = data.ticker[i++ % data.ticker.length]; popEvent(t.time, t.user, t.what); };
  window.setTimeout(next, 600);
  window.setInterval(next, 10_000);
} else {
  void import('./live').then(({ Live }) => {
    const live = new Live(data, {
      onData(patch, first) {
        data = { ...data, ...patch };
        const top = data.ticker[0];
        const key = top ? `${top.time}|${top.user}|${top.what}` : '';
        // Pop up only events that arrive while the overlay is open.
        if (!first && top && key !== lastTop && top.time !== '—') popEvent(top.time, top.user, top.what);
        lastTop = key;
        draw();
      },
      onMe() {},
    });
    void live.start();
  });
}
setInterval(draw, 1000);
draw();
