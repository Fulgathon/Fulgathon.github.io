// OBS overlay: same live data and maths as the site (Live + derive), drawn as
// a compact timer box, a goal bar and a pop-up for each new event.

import { emptyData } from '../data/sample';
import type { SiteData } from '../data/types';
import { derive, initialState } from '../lib/derive';
import { Live } from './live';

const show = new Set((new URLSearchParams(location.search).get('show') ?? 'timer,goal,events').split(','));
const $ = (id: string) => document.getElementById(id)!;
$('timer-part').hidden = !show.has('timer');
$('goal-part').hidden = !show.has('goal');
if (!show.has('timer') && !show.has('goal')) (document.querySelector('.box') as HTMLElement).hidden = true;

let data: SiteData = emptyData();
let lastTop = '';

function draw() {
  const v = derive({ ...initialState(), now: Date.now() }, data);
  for (const k of ['dd', 'hh', 'mm', 'ss'] as const) if ($(k).textContent !== v[k]) $(k).textContent = v[k];
  $('label').textContent = v.timerLabel;
  $('badge').textContent = v.statusText;
  $('badge').classList.toggle('live', v.isLive);
  $('goal-title').textContent = v.nextGoalTitle;
  $('goal-progress').textContent = v.progressLabel;
  ($('goal-fill') as HTMLElement).style.width = v.progressPct;
}

let hideTimer: number | undefined;
function popEvent(time: string, user: string, what: string) {
  if (!show.has('events')) return;
  const el = $('event');
  el.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = time;
  el.append(b, ` ${user} · ${what}`);
  el.classList.add('show');
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => el.classList.remove('show'), 8000);
}

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
setInterval(draw, 1000);
draw();
