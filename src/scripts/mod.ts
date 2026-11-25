// Moderator page logic. Reads with the moderator's own session (row level
// security lets moderators see suggestions and viewers) and acts through the
// mod_* database functions, which re-check moderator rights every time.
// /mod/?demo runs on the simulated backend instead (no login, shared with
// /?demo, /overlay/?demo and /prezentare/).

import { createClient } from '@supabase/supabase-js';
import { BINGO_SIZES, bingoSide } from '../lib/bingo';
import { site } from '../data/site';
import type { DemoBackend } from '../demo/backend';
import { esc } from '../lib/views';
import { FALLBACK_LINE, lineGroups, MAX_LINE, MIN_LINES } from '../data/content';
import type { LineGroup } from '../data/types';
import { overlayPieces } from '../data/content';
import { fmtInt } from '../lib/format';

const demo = new URLSearchParams(location.search).has('demo');
let demoApi: DemoBackend | null = null;

const db = createClient(site.supabase.url, site.supabase.publishableKey, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const app = document.getElementById('app')!;
const bar = document.getElementById('bar')!;
const nav = document.getElementById('nav')!;
const msgBox = document.getElementById('msg')!;
const endDlg = document.getElementById('endDlg') as HTMLDialogElement;
const endWord = document.getElementById('endWord') as HTMLInputElement;
const endGo = document.getElementById('endGo') as HTMLButtonElement;
/** «ÎNCHEIE» typed (with or without diacritics, any case). */
const endWordOk = () => ['ÎNCHEIE', 'INCHEIE'].includes(endWord.value.trim().toLocaleUpperCase('ro-RO'));
function openEndDialog() {
  endWord.value = '';
  endGo.disabled = true;
  endDlg.showModal();
  endWord.focus();
}
endWord.addEventListener('input', () => { endGo.disabled = !endWordOk(); });
endWord.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (endWordOk()) endGo.click(); } });

const errors: Record<string, string> = {
  not_moderator: 'Contul tău nu e moderator.',
  timer_not_live: 'Cronometrul nu e pornit.',
  round_already_open: 'Există deja o rundă deschisă. Închide-o mai întâi.',
  need_two_challenges: 'O rundă are mereu exact 5 provocări.',
  bad_round_length: 'O rundă ține între 1 și 48 de ore.',
  round_needs_five: 'O rundă are mereu exact 5 provocări: schimbă una cu alta, nu adăuga și nu scoate.',
  bad_goals: 'Fiecare milestone are nevoie de text și de o sumă în euro (număr întreg, peste 0).',
  bad_items: 'Bingo: între 5 și 60 de evenimente, fiecare cu un text de cel mult 80 de caractere.',
  item_in_use: 'Un eveniment ales deja de jucători nu poate fi șters. Îl poți redenumi.',
  need_25: 'Cartonașul trebuie să aibă 9, 16 sau 25 de evenimente (3 × 3, 4 × 4 sau 5 × 5).',
  bad_card_size: 'Cartonașul trebuie să aibă 9, 16 sau 25 de evenimente (3 × 3, 4 × 4 sau 5 × 5).',
  card_locked: 'Jucătorii și-au ales deja linii: poți doar redenumi evenimentele, nu le poți muta, adăuga sau șterge.',
  bingo_open: 'Bifele de bingo se deschid după ce se închid alegerile: până atunci spectatorii încă își aleg linia.',
  bingo_ticked: 'Sunt deja bife (sau tragerea) la bingo: orele de deschidere și închidere nu se mai pot schimba.',
  bingo_not_open: 'Bingo nu e deschis acum.',
  no_bingo_draw: 'Nu s-a făcut încă nicio tragere.',
  bingo_bad_dates: 'Închiderea are nevoie de o oră de deschidere și trebuie să fie după ea.',
  no_bingo_winners: 'Nu e nimeni (nou) pe lista de bingo: încă nu s-a întâmplat toată linia la nimeni.',
  freeze_in_past: 'Alege o dată din viitor (după înghețarea de acum, dacă e una).',
  bad_minutes: 'Scrie un număr de minute mai mare decât 0.',
  bad_clip: 'Linkul clipului trebuie să înceapă cu https://',
  timer_ended: 'Cronometrul a ajuns la zero: maratonul s-a încheiat și nu se mai poate adăuga sau îngheța timp.',
  protected_broadcaster: 'Contul lui Iceman nu poate fi scos dintre moderatori.',
  only_broadcaster: 'Doar streamerul poate porni, prelungi sau încheia subathonul.',
  extend_not_later: 'Finalul nou trebuie să fie după finalul programat de acum.',
  extend_too_far: 'Se poate prelungi cel mult un an de acum.',
  bad_raffle: 'Alege cine intră în tombolă.',
  bad_raffle_hours: 'Scrie câte ore trebuie să fi privit (de exemplu 5).',
  bad_raffle_prize: 'Scrie premiul (cel mult 120 de caractere).',
  raffle_drawn: 'S-a tras deja la sorți: regula nu se mai schimbă și tombola nu se mai poate șterge. Premiul se poate redenumi.',
  raffle_empty: 'Nu mai e nimeni pe listă care să nu fi câștigat deja.',
  no_raffle: 'Tombola nu mai există. Reîncarcă pagina.',
  no_raffle_draw: 'Tragerea nu mai există. Reîncarcă pagina.',
  bad_prize_kind: 'Premiul nu a fost recunoscut. Reîncarcă pagina.',
  round_full: 'O rundă are mereu exact 5 provocări.',
  challenge_unavailable: 'Provocarea nu mai e disponibilă (e deja în rundă sau a fost folosită).',
  challenge_exists: 'Provocarea există deja în listă.',
  challenge_title: 'Scrie textul provocării.',
  not_in_round: 'Provocarea nu mai e în rundă.',
  main_exists: 'Există deja un partener principal. Schimbă-l întâi la «Partener».',
  sponsor_name: 'Sponsorul are nevoie de un nume.',
  sponsor_gone: 'Sponsorul nu mai există (l-a șters altcineva).',
  bad_url: 'Un link nu e valid: trebuie să înceapă cu https://.',
  bad_tier: 'Nivel necunoscut.',
  bad_sponsor: 'O dată nu e validă.',
  test_running: 'Un test merge deja.',
  demo_test: 'În demo totul e deja de probă: modul test e pentru site-ul real.',
  bad_tasks: 'Lista nu e bună: suma între 0 și 10.000 €, sarcina între 1 și 60 de litere, cel mult 8.',
  duplicate_price: 'Două sarcini au aceeași sumă. Fiecare sumă trebuie să fie diferită.',
  no_task: 'Cererea nu mai există (poate a bifat-o alt moderator).',
  bad_scene_photo: 'Fotografia trebuie încărcată de aici, din /mod.',
  test_while_live: 'Testul merge doar înainte de start (maratonul real a pornit sau s-a încheiat).',
  test_too_close: 'E prea aproape de start: testul trebuie să se termine cu 30 de minute înainte.',
  test_off: 'Testul nu mai merge (s-a oprit sau a expirat).',
  test_crowd_full: 'Sunt deja 500 de spectatori de test.',
  bad_test_amount: 'Sumă nevalidă.',
  test_backup_missing: 'Copia de siguranță lipsește. Nu opri nimic, scrie-i lui barsmin.',
  not_eur: 'Se adună doar donațiile în euro.',
  bad_webhook: 'Linkul nu e un webhook de Discord. Îl copiezi din Discord: Setările serverului → Integrări → Webhook-uri.',
  no_webhook: 'Pune întâi linkul webhook-ului de Discord.',
  bad_autopilot: 'Verifică ora (HH:MM), cât durează runda (1–48 de ore), nivelul și orele de la start.',
  plan_in_past: 'Alege o oră din viitor.',
  bad_until: 'Înghețul trebuie să se termine după ce începe.',
  bad_plan: 'Verifică ce ai completat: minute între 1 și 60 la cod, între 1 și 720 la Ora dublă.',
  bad_rule: 'Regula de bingo are nevoie de un număr mai mare decât 0.',
  too_fast: 'Așteaptă 3 secunde între două teste.',
  duplicate_amount: 'Două milestone-uri au aceeași sumă. Fiecare sumă trebuie să fie diferită.',
  bad_lines: 'Replicile nu au putut fi salvate: cel mult 40 pe grup.',
  line_too_long: 'O replică are mai mult de 70 de caractere. Scurteaz-o ca să încapă în balon.',
  bad_threshold: 'Pragul pentru donație mare trebuie să fie un număr între 1 și 10.000 de euro.',
  mod_set_lines: 'Editorul de replici are nevoie de actualizarea bazei de date (migrarea layout v2).',
  mod_set_chat_echo: 'Comutatorul de chat are nevoie de actualizarea bazei de date (migrarea layout v2).',
};
let msgTimer: number | undefined;
function say(text: string, err = false) {
  msgBox.innerHTML = tipHtml(text);   // «word» shows as bold, never with the quote marks
  msgBox.classList.toggle('err', err);
  msgBox.hidden = false;
  // slides in, with a bar that runs out over the 4 s it stays
  msgBox.classList.remove('in'); void msgBox.offsetWidth; msgBox.classList.add('in');
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => { msgBox.hidden = true; }, 4000);
}
// After an action, focus leaves the field it used (Safari keeps focus there on button clicks),
// so the held-back redraw (see `deferred`) happens and the page shows the result.
function releaseField() {
  const a = document.activeElement as HTMLElement | null;
  if (a && app.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) a.blur();
}
// ---- Explanations behind an (i) (owner, 25 Nov: «put them behind a tooltip») ----
// tip(text) = a small square (i) button; the text shows in one floating box on hover, focus or tap
// (the box lives in <body>, positioned in the window, so cards never clip it). Screen readers get
// the same text right after the button. «\n» in the text starts a new line.
// Words in «» are names of buttons or things to type: the box shows them bold, without the marks
// (owner, 25 Nov: no code-like quoting in the explanations).
const tip = (text: string) => `<button type="button" class="tip" data-tip="${esc(text)}" aria-label="Explicație"><span aria-hidden="true">?</span></button><span class="sr-only">${esc(text.replace(/[«»]/g, ''))}</span>`;
const tipHtml = (text: string) => esc(text).replace(/«([^»]+)»/g, '<strong>$1</strong>');
// Owner, 25 Nov 2026: no «word» quote marks anywhere in /mod; names of buttons and things show in bold.
// Every text the console draws goes through boldQuotes() after a render; native confirm boxes can't show
// bold, so ask() drops the marks there.
const ask = (text: string) => window.confirm(text.replace(/[«»]/g, ''));
const NO_BOLD = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION', 'TITLE', 'SELECT']);
function boldQuotes(root: Element) {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue?.includes('«') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const found: Text[] = [];
  for (let n = walk.nextNode(); n; n = walk.nextNode()) found.push(n as Text);
  for (const t of found) {
    const parent = t.parentElement;
    if (!parent) continue;
    if (NO_BOLD.has(parent.tagName)) { t.nodeValue = t.nodeValue!.replace(/[«»]/g, ''); continue; }
    const frag = document.createDocumentFragment();
    let last = 0;
    const text = t.nodeValue!;
    for (const m of text.matchAll(/«([^»]+)»/g)) {
      frag.append(text.slice(last, m.index));
      const b = document.createElement('strong');
      b.textContent = m[1];
      frag.append(b);
      last = m.index! + m[0].length;
    }
    frag.append(text.slice(last).replace(/[«»]/g, ''));
    parent.replaceChild(frag, t);
  }
}
const tipBox = document.createElement('div');
tipBox.id = 'tipBox'; tipBox.setAttribute('role', 'tooltip'); tipBox.hidden = true;
document.body.append(tipBox);
let tipFor: HTMLElement | null = null;
function tipShow(b: HTMLElement) {
  tipFor = b;
  tipBox.innerHTML = tipHtml(b.dataset.tip ?? '');
  tipBox.hidden = false;
  b.setAttribute('aria-expanded', 'true');
  // Big screens zoom the whole page (html { zoom }): rectangles come in zoomed pixels, positions don't.
  const z = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--z')) || 1;
  const r = b.getBoundingClientRect();
  const vw = innerWidth / z, vh = innerHeight / z;
  const bx = r.left / z, by = r.top / z, bw = r.width / z, bh = r.height / z;
  const w = tipBox.offsetWidth, h = tipBox.offsetHeight;
  const left = Math.max(12, Math.min(vw - w - 12, bx + bw / 2 - w / 2));
  const below = by + bh + 10 + h <= vh - 12 || by - 10 - h < 12;
  tipBox.style.left = `${left}px`;
  tipBox.style.top = `${below ? by + bh + 10 : by - 10 - h}px`;
  tipBox.dataset.side = below ? 'below' : 'above';
  tipBox.style.setProperty('--ax', `${Math.max(10, Math.min(w - 10, bx + bw / 2 - left))}px`);
}
function tipHide() {
  if (!tipFor) return;
  tipFor.setAttribute('aria-expanded', 'false');
  tipFor = null;
  tipBox.hidden = true;
}
const tipOf = (e: Event) => (e.target as Element | null)?.closest?.<HTMLElement>('.tip') ?? null;
document.addEventListener('pointerover', (e) => { const b = tipOf(e); if (b && (e as PointerEvent).pointerType === 'mouse') tipShow(b); });
document.addEventListener('pointerout', (e) => { const b = tipOf(e); if (b && b === tipFor && (e as PointerEvent).pointerType === 'mouse' && document.activeElement !== b) tipHide(); });
document.addEventListener('focusin', (e) => { const b = tipOf(e); if (b) tipShow(b); else if (tipFor) tipHide(); });
document.addEventListener('focusout', (e) => { if (tipOf(e) === tipFor) tipHide(); });
document.addEventListener('click', (e) => {
  const b = tipOf(e);
  if (b) { e.preventDefault(); tipShow(b); return; }   // a tap shows it; a tap elsewhere, Esc or scrolling hides it
  if (tipFor) tipHide();
}, true);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) tipHide(); });
addEventListener('scroll', () => tipHide(), { passive: true, capture: true });
addEventListener('resize', () => tipHide());

async function call(fn: string, args: Record<string, unknown> = {}, ok = 'Gata.') {
  releaseField();
  if (demoApi) {
    try {
      const data = demoApi.rpc(fn, args);
      say(ok);
      resetTyped = true;
      void load();
      return data;
    } catch (err) {
      const message = String((err as Error).message);
      const key = Object.keys(errors).find((k) => message.includes(k));
      say(key ? errors[key] : `Eroare: ${message}`, true);
      throw err;
    }
  }
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    const key = Object.keys(errors).find((k) => error.message.includes(k));
    say(key ? errors[key] : `Eroare: ${error.message}`, true);
    throw error;
  }
  say(ok);
  resetTyped = true;
  void load();
  return data;
}

// ---- Formatting ----
const pad = (n: number) => String(n).padStart(2, '0');
function left(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 86400)}z ${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ro-RO', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Bucharest' }) : '—');
/** datetime-local value → ISO (the browser's own time zone). */
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);
/** ISO → datetime-local value (the browser's own time zone). */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

// ---- State ----
interface DueItem { kind: 'roata' | 'bingo' | 'tombola'; id: number; login: string; prize: string | null; sponsor: string | null; at: string }
interface Raffle { id: number; prize: string; sponsor: string | null; rule: 'all' | 'subs' | 'hours'; min_hours: number | null; created_by: string | null; created_at: string; pool: number;
  draws: { id: number; login: string; drawn_at: string; drawn_by: string | null; given_at: string | null; total: number | null }[] }
interface Challenge { id: number; title: string; level: string; category: string; status: string; scheduled_for: string | null }
let S: {
  me: { login: string; is_moderator: boolean; is_subscriber?: boolean } | null;
  status: { broadcaster_login: string; broadcaster_connected: boolean; connect_url: string } | null;
  timer: Record<string, any> | null;
  stats: Record<string, any> | null;
  round: { id: number; number: number; closes_at: string; winner_id: number | null; items: { challenge_id: number; votes: number; title: string }[] } | null;
  pool: Challenge[];
  scheduled: Challenge[];
  suggestions: { id: number; body: string; created_at: string; viewers: { login: string; display_name: string } | null }[];
  /** «Premii de dat»: every win not handed out yet (wheel, bingo, raffle) and the last ones handed out. */
  due: { due: DueItem[]; given: { kind: string; login: string; prize: string; given_at: string; by?: string }[] };
  /** Tombole (mod_raffles) and the live count for the new-raffle form. */
  raffles: Raffle[];
  rafflePreview: { key: string; n: number | null } | null;
  mods: { login: string; display_name: string | null }[];
  draft: number[];
  goals: { title: string; threshold: number; unlocked_at: string | null; sponsor?: string | null; done_at?: string | null; clip_url?: string | null; scheduled_for?: string | null }[];
  /** Milestone list being edited (null = showing the saved list). */
  goalsDraft: { title: string; threshold: string; sponsor: string; done: boolean; clip: string; when: string }[] | null;
  /** Wheel slices (8) as stored, and the copy being edited. */
  wheel: { short_label: string; full_label: string; win_label: string | null; sponsor: string | null; is_win: boolean; weight: number }[];
  wheelDraft: { short_label: string; full_label: string; sponsor: string; is_win: boolean; weight: string }[] | null;
  codes: { code: string; sponsor: string | null; shown_at: string | null; expires_at: string | null; claims: number }[];
  overlayKey: string | null;
  report: any;
  bingo: {
    opens_at: string | null; closes_at: string | null; prize: string; prize_sponsor?: string | null;
    items: { id: number; label: string; happened_at: string | null; auto_rule?: { t: string; n?: number; eur?: number; h?: number } | null }[];
    status: { players: number; winners: { login: string }[]; draws: { login: string; drawn_at: string | null }[] };
  } | null;
  /** Bingo event list being edited (null = showing the saved list). */
  bingoDraft: { id?: number; label: string }[] | null;
  /** The card size picked on /mod (3, 4 or 5); null = what the saved card has. */
  bingoSize: number | null;
  /** mod_health(): is everything still arriving? */
  health: any;
  /** "Acum pe stream" (Twitch title/game + note) and the community goal list. */
  now: { title: string | null; game: string | null; note: string | null } | null;
  /** «Replicile lui Iceman»: saved lines per group, the small/large donation threshold, and the text being edited. */
  lines: Partial<Record<LineGroup, string[]>>;
  smallDonation: number;
  linesDraft: Partial<Record<LineGroup, string>> | null;
  /** Twitch-chat echo: the switch, and whether Iceman's token may write in chat (null = not available yet). */
  chat: { on: boolean; canWrite: boolean; connected: boolean; lastAt: string | null } | null;
  /** Which menu group is open (acum, activitati, premii, sponsori, setari, streamer). */
  page: string;
  /** mod_autopilot(): auto start, vote autopilot, the plan, Discord alerts, the shared checklist. */
  auto: any;
  /** The open menu item (one page each) and the open tab of «Control live». */
  view: string;
  liveTab: 'timp' | 'freeze' | 'double' | 'code' | 'note';
  /** «Mod test»: the whole site on fake data (public_state part 'test'). */
  test: { on: boolean; until: string; startedAt: string; hardUntil: string | null; by: string | null; streamForced: boolean } | null;
  /** «Donează și alegi» (public_state part 'tasks'). */
  tasks: import('../data/types').DonationTasks | null;
  tasksDraft: string | null;
  /** «Camera de control»: the background photo (public_state part 'scene'). */
  sceneBg: string | null;
  /** /mod → Sponsori: every field (mod_sponsors), and the one open in the editor. */
  sponsors: any[];
  spEdit: number | 'new' | null;
  /** «Runda de vot»: the entry being swapped in the open round. */
  rSwap: number | null;
  /** The level picked for a round opened by hand (null = the auto round's level). */
  voteLevel: string | null;
} = { rSwap: null, voteLevel: null, test: null, tasks: null, tasksDraft: null, sceneBg: null, sponsors: [], spEdit: null, auto: null, view: 'rapid', liveTab: 'timp', page: 'acum', chat: null, lines: {}, smallDonation: 10, linesDraft: null, health: null, now: null, me: null, status: null, timer: null, stats: null, round: null, pool: [], scheduled: [], suggestions: [], due: { due: [], given: [] }, raffles: [], rafflePreview: null, mods: [], draft: [], goals: [], goalsDraft: null, bingo: null, bingoDraft: null, bingoSize: null, wheel: [], wheelDraft: null, codes: [], overlayKey: null, report: null };
/** Bingo phase (as private.bingo_phase): moderators open and close it; no ticks until the close (owner, 24 Nov). */
const bingoPhase = (): 'soon' | 'open' | 'closed' => {
  const B = S.bingo;
  if (!B?.opens_at || Date.parse(B.opens_at) > Date.now()) return 'soon';
  return B.closes_at && Date.parse(B.closes_at) <= Date.now() ? 'closed' : 'open';
};
const bingoPicksOpen = () => bingoPhase() !== 'closed';
/** Where bingo stands + the one button for it (open now / close now). */
const bingoNowHtml = () => {
  const B = S.bingo!;
  const ph = bingoPhase();
  if (ph === 'soon') return `<div class="row" style="align-items:center"><p class="muted grow" style="margin:0">Bingo nu e deschis încă${B.opens_at ? `: se deschide singur la <strong style="color:#F2F5FA">${when(B.opens_at)}</strong>` : ''}. Spectatorii văd cartonașul, dar nu pot alege.</p>
    <button class="btn-primary" data-act="bingoOpen">Deschide acum</button></div>`;
  if (ph === 'open') return `<div class="row" style="align-items:center"><p class="muted grow" style="margin:0"><strong style="color:#F2F5FA">Deschis</strong> · ${B.status.players} ${B.status.players === 1 ? 'jucător' : 'jucători'}${B.closes_at ? ` · se închide singur la <strong style="color:#F2F5FA">${when(B.closes_at)}</strong>` : ''}. Bifele încep după închidere, ca nimeni să nu aleagă o linie deja bifată.</p>
    <button class="btn-ghost" data-act="bingoClose">Închide alegerile acum</button></div>`;
  return `<p class="muted" style="margin:0"><strong style="color:#F2F5FA">Alegerile s-au închis</strong>${B.closes_at ? ` la ${when(B.closes_at)}` : ''} · ${B.status.players} ${B.status.players === 1 ? 'jucător' : 'jucători'}. Bingo rămâne pe site până la finalul maratonului.</p>`;
};
const tickBtn = (id: number, on: boolean) => bingoPicksOpen()
  ? ''
  : `<button class="${on ? 'btn-primary' : 'btn-ghost'}" data-act="bingoTick" data-id="${id}" data-on="${on ? '0' : '1'}" aria-pressed="${on}">${on ? '✓ S-a întâmplat' : 'Bifează'}</button>`;
const bingoRows = () => S.bingoDraft ?? (S.bingo?.items ?? []).map((i) => ({ id: i.id, label: i.label }));
const editBingo = () => { if (!S.bingoDraft) S.bingoDraft = bingoRows(); return S.bingoDraft; };
/** The card's side on /mod: the size picked, else the saved card's, else 5. */
const bingoN = () => S.bingoSize ?? bingoSide(S.bingo?.items.length ?? 0) ?? 5;
/** Grow or shrink the draft to n×n (new squares empty). */
function resizeBingo(n: number): boolean {
  const rows = editBingo();
  const want = n * n;
  const lost = rows.slice(want).filter((r) => r.label.trim()).length;
  if (lost && !ask(`Cartonașul ${n} × ${n} are ${want} de pătrate: ultimele ${lost} evenimente completate se scot. Continui?`)) return false;
  rows.length = Math.min(rows.length, want);
  while (rows.length < want) rows.push({ label: '' });
  S.bingoSize = n;
  return true;
}
const goalRows = () => S.goalsDraft ?? S.goals.map((g) => ({ title: g.title, threshold: String(g.threshold), sponsor: g.sponsor ?? '', done: !!g.done_at, clip: g.clip_url ?? '', when: g.scheduled_for ?? '' }));
const wheelRows = () => S.wheelDraft ?? S.wheel.map((p) => ({ short_label: p.short_label, full_label: p.full_label, sponsor: p.sponsor ?? '', is_win: p.is_win, weight: String(p.weight) }));
const editWheel = () => { if (!S.wheelDraft) S.wheelDraft = wheelRows(); return S.wheelDraft; };
/** Sponsor names for the suggestions list: the site's partners plus any already used. */
const sponsorNames = () => [...new Set([...(S.sponsors.length ? S.sponsors.map((x: any) => x.name) : [site.sponsor.name, ...site.partners.map((p) => p.name)]), ...((S.report?.sponsors ?? []).map((x: any) => x.sponsor))]
  .filter((n) => n && !n.startsWith('[')))];
const editGoals = () => { if (!S.goalsDraft) S.goalsDraft = goalRows(); return S.goalsDraft; };

// Suggest a round: 2 easy, 2 medium, 1 hard, all from different categories.
// «Provocare nouă»: a challenge written by a moderator, into the pool and into the round or the draft.
/** A challenge written by a moderator takes one of the 5 places (a round always has exactly 5). */
function newChallengeRow(to: 'round' | 'draft') {
  const places = to === 'round'
    ? (S.round?.items ?? []).map((x, i) => `<option value="${x.challenge_id}">${i + 1} · ${esc(x.title)}</option>`).join('')
    : S.draft.map((id, i) => `<option value="${i}"${i === S.draft.length - 1 ? ' selected' : ''}>${i + 1} · ${esc(S.pool.find((c) => c.id === id)?.title ?? '')}</option>`).join('');
  return `<div class="row"><label class="inline" style="flex:1 1 320px">Provocare nouă<input class="field" id="newCh_${to}" maxlength="140" placeholder="ex: Cântă imnul cu accent de pirat"></label>
    ${to === 'round' ? '<label class="inline">Nivel<select class="field" id="newChLvl_round"><option value="ușor">Ușor</option><option value="mediu" selected>Mediu</option><option value="greu">Greu</option></select></label>' : ''}
    <label class="inline" style="flex:1 1 220px">În locul<select class="field" id="newChFor_${to}">${places}</select></label>
    <button class="btn-ghost" data-act="newChallenge" data-to="${to}">Pune în rundă</button></div>`;
}
const ROUND_SIZE = 5;
// Rounds by level (owner, 25 Nov 2026): 5 challenges of ONE level, picked on /mod; the auto round
// has its own level in «Votul automat». Different categories first, then any of that level.
const LEVELS: [string, string, string][] = [['ușor', 'Ușor', 'ușoare'], ['mediu', 'Mediu', 'medii'], ['greu', 'Greu', 'grele']];
const draftLevel = () => S.voteLevel ?? S.auto?.voteLevel ?? 'mediu';
const levelPlural = (l: string) => LEVELS.find(([k]) => k === l)?.[2] ?? l;
function autoDraft() {
  const lv = draftLevel();
  const pick: number[] = [];
  const used = new Set<string>();
  const shuffled = S.pool.filter((c) => c.level === lv).sort(() => Math.random() - 0.5);
  for (const c of shuffled) {
    if (pick.length >= ROUND_SIZE) break;
    if (!used.has(c.category)) { pick.push(c.id); used.add(c.category); }
  }
  for (const c of shuffled) {
    if (pick.length >= ROUND_SIZE) break;
    if (!pick.includes(c.id)) pick.push(c.id);
  }
  S.draft = pick;
}
/** The draft is remade when one of its challenges was used or isn't of the picked level any more. */
const draftStale = () => !S.draft.length || S.draft.some((id) => S.pool.find((p) => p.id === id)?.level !== draftLevel());

async function load() {
  if (demoApi) {
    Object.assign(S, demoApi.modState());
    S.health = demoHealth();
    S.auto = demoApi.rpc('mod_autopilot', {});
    S.sponsors = (demoApi.rpc('mod_sponsors', {}) as any[]) ?? [];
    const site = demoApi.toSiteData();
    S.now = site.now; S.test = null; S.tasks = site.tasks ?? null; S.sceneBg = site.scene?.bg ?? null;
    S.lines = site.lines; S.smallDonation = site.smallDonation;
    S.chat = demoApi.rpc('mod_chat_status', {}) as typeof S.chat;
    if (draftStale()) autoDraft();
    return render();
  }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { S.me = null; return render(); }
  const meQuery = db.from('viewers').select('login, is_moderator, is_subscriber').eq('id', session.user.id).maybeSingle();
  // Already known as a moderator (every live refresh): check the role in the same round trip as the data,
  // instead of first. The first load (or after losing the role) still asks first.
  const knownMod = !!S.me?.is_moderator;
  if (!knownMod) {
    const { data: me } = await meQuery;
    S.me = me;
    if (!me?.is_moderator) return render();
  }
  const anyDb = db as any;
  // Everything /mod shows, requested at once (one round trip instead of a chain of ten).
  const [meRes, [status, timer, stats, rounds, pool, scheduled, suggestions, due, mods, goals], [wheel, codes, okey, report, raffles], health, auto, sponsors, psRes, chat, [bItems, bSet, bStatus]] = await Promise.all([
    knownMod ? meQuery : Promise.resolve(null),
    Promise.all([
    db.rpc('mod_status'),
    db.from('timer').select('*').eq('id', 1).maybeSingle(),
    db.from('stats').select('*').eq('id', 1).maybeSingle(),
    db.from('vote_rounds').select('id, number, closes_at, winner_id, round_challenges(challenge_id, votes, position, challenges(title))').order('number', { ascending: false }).limit(1),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'pool').eq('votable', true).order('id'),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'scheduled').order('id'),
    db.from('suggestions').select('id, body, created_at, viewers(login, display_name)').eq('status', 'pending').order('created_at'),
    anyDb.rpc('mod_prizes_due'),
    db.from('viewers').select('login, display_name').eq('is_moderator', true).order('login'),
    db.from('goals').select('title, threshold, unlocked_at, sponsor, done_at, clip_url, scheduled_for').order('position'),
    ]),
    Promise.all([
      db.from('prizes').select('short_label, full_label, win_label, sponsor, is_win, weight').order('position'),
      db.rpc('mod_codes'), db.rpc('mod_overlay_key'), db.rpc('mod_sponsor_report'), anyDb.rpc('mod_raffles'),
    ]),
    anyDb.rpc('mod_health'), anyDb.rpc('mod_autopilot'), anyDb.rpc('mod_sponsors'),
    anyDb.rpc('public_state', { p_have: {} }), anyDb.rpc('mod_chat_status'),
    Promise.all([
      db.from('bingo_items').select('id, label, happened_at, auto_rule').order('position'),
      db.from('bingo_settings').select('opens_at, closes_at, prize, prize_sponsor').eq('id', 1).maybeSingle(),
      db.rpc('mod_bingo_status'),
    ]),
  ]);
  if (meRes) {
    S.me = meRes.data;
    if (!S.me?.is_moderator) return render();
  }
  S.health = health.data ?? null;
  S.auto = auto.data ?? null;
  S.sponsors = (sponsors.data as any[]) ?? [];
  const ps = psRes.data?.parts ?? {};
  S.now = ps.now ?? null; S.test = ps.test?.on ? ps.test : null;
  S.sceneBg = ps.scene?.bg ?? null;
  S.tasks = ps.tasks ? { menu: (ps.tasks.menu ?? []).map((m: any) => ({ price: Number(m.price), title: String(m.title) })), queue: (ps.tasks.queue ?? []).map((q: any) => ({ id: Number(q.id), price: Number(q.price), title: String(q.title), name: String(q.name), at: Date.parse(q.at) })), pending: Number(ps.tasks.pending) || 0 } : null;
  S.lines = ps.lines?.groups ?? {}; S.smallDonation = Number(ps.lines?.smallDonation) || 10;
  S.chat = (chat.data as typeof S.chat) ?? null;
  S.wheel = (wheel.data ?? []) as typeof S.wheel;
  S.codes = (codes.data ?? []) as typeof S.codes;
  S.overlayKey = (okey.data as string | null) ?? null;
  S.report = report.data ?? null;
  S.goals = (goals.data ?? []) as typeof S.goals;
  S.bingo = {
    opens_at: (bSet.data as any)?.opens_at ?? null, closes_at: bSet.data?.closes_at ?? null, prize: bSet.data?.prize ?? '', prize_sponsor: bSet.data?.prize_sponsor ?? null,
    items: (bItems.data ?? []) as any,
    status: (bStatus.data ?? { players: 0, winners: [], draws: [] }) as any,
  };
  S.status = status.data;
  S.timer = timer.data;
  S.stats = stats.data;
  const r = rounds.data?.[0] as any;
  S.round = r ? {
    id: r.id, number: r.number, closes_at: r.closes_at, winner_id: r.winner_id,
    items: [...r.round_challenges].sort((a: any, b: any) => a.position - b.position)
      .map((x: any) => ({ challenge_id: x.challenge_id, votes: x.votes, title: x.challenges?.title ?? '' })),
  } : null;
  S.pool = (pool.data ?? []) as Challenge[];
  S.scheduled = (scheduled.data ?? []) as Challenge[];
  S.suggestions = (suggestions.data ?? []) as any;
  S.due = (due.data as typeof S.due) ?? { due: [], given: [] };
  S.raffles = (raffles.data as Raffle[]) ?? [];
  S.mods = (mods.data ?? []) as any;
  if (draftStale()) autoDraft();
  render();
}


// ---- «Replicile lui Iceman» ----
/** Sample event per group, for the bubble preview (same shape as on the site). */
const lineSamples: Record<LineGroup, { nume: string; timp: string; suma: string; subs: string; what: string; time: string }> = {
  sub: { nume: 'kxtrin', timp: '+6 min', suma: '', subs: '', what: 'sub Prime', time: '+6:00' },
  sub23: { nume: 'Rares1337', timp: '+18 min', suma: '', subs: '', what: 'sub Tier 3', time: '+18:00' },
  gift: { nume: 'vladutz97', timp: '+30 min', suma: '', subs: '5', what: 'a dăruit 5 subs', time: '+30:00' },
  donSmall: { nume: 'dianaplays', timp: '+30 min', suma: '5 €', subs: '', what: 'donație 5 €', time: '+30:00' },
  donBig: { nume: 'andreiGG', timp: '+2 h', suma: '20 €', subs: '', what: 'donație 20 €', time: '+2:00:00' },
  bits: { nume: 'teo_mid', timp: '+4 min', suma: '400 de biți', subs: '', what: '400 de biți', time: '+4:00' },
};
const lineText = (g: LineGroup) => S.linesDraft?.[g] ?? (S.lines[g] ?? []).join('\n');
const linesOf = (g: LineGroup) => lineText(g).split('\n').map((l) => l.trim()).filter(Boolean);
function lineInfo(g: LineGroup) {
  const list = linesOf(g);
  const long = list.filter((l) => l.length > MAX_LINE).length;
  const ok = list.length >= MIN_LINES;
  const x = lineSamples[g];
  const fill = (t: string) => t.replace(/\{(nume|timp|suma|subs)\}/g, (_, k: keyof typeof x) => x[k] ?? '');
  return {
    list, long, ok,
    count: long ? `${long} prea ${long === 1 ? 'lungă' : 'lungi'}` : ok ? `${list.length} replici ✓` : `${list.length} din ${MIN_LINES}`,
    color: long ? '#FF8A95' : ok ? '#3FD0FF' : '#E6C46A',
    border: long ? '#7A2A33' : ok ? '#1C2230' : '#6B5A2A',
    who: ok ? `Mersi, ${x.nume}!` : `${x.time} · ${x.what}`,
    preview: fill(ok ? list[0] : FALLBACK_LINE),
  };
}
function chatHtml(): string {
  const C = S.chat;
  const sample = lineInfo('donBig');
  const preview = `${sample.ok ? linesOf('donBig')[0].replace(/\{nume\}/g, '@andreigg').replace(/\{suma\}/g, '20 €').replace(/\{timp\}/g, '+2 h') : 'Mersi, @andreigg!'}${sample.ok && linesOf('donBig')[0].includes('{timp}') ? '' : ' (+2 h pe ceas)'}`;
  const state = !C ? '<span class="pill off">Indisponibil</span> <span class="muted">Are nevoie de actualizarea bazei de date (migrarea layout v2).</span>'
    : !C.connected ? '<span class="pill bad">Streamer neconectat</span> <span class="muted">Conectează contul de streamer (la Stare).</span>'
    : !C.canWrite ? '<span class="pill warn">Lipsește permisiunea</span> <span class="muted">Iceman reconectează contul de streamer.</span>'
    : C.on ? `<span class="pill ok">Pornit</span> <span class="muted">Scrie din contul lui Iceman.${C.lastAt ? ` Ultimul mesaj: ${when(C.lastAt)}.` : ''}</span>`
    : '<span class="pill off">Oprit</span>';
  return `<div class="panel">
        <label class="opt"><input type="checkbox" class="sw" data-act="chatToggle" ${C?.on ? 'checked' : ''} ${C && C.canWrite ? '' : 'disabled'} aria-describedby="chat-state chat-warn"><span><strong class="opt-t">Trimite replica și în chatul Twitch</strong><span class="opt-d">Replica din balon, scrisă de contul lui Iceman. Maxim un mesaj la 5 secunde.</span></span></label>
        <p id="chat-state" style="margin:8px 0 0;font-size:14px">${state}</p>
        <p id="chat-warn" class="warn-t">Dacă un bot mulțumește deja în chat, oamenii primesc două mulțumiri.</p>
        <p style="margin:8px 0 0;font-size:13px;color:#8C97A8">În chat: <span style="color:#EFEFF1"><strong style="color:#9147FF">icemanlucky</strong>: ${esc(preview)}</span></p>
      </div>`;
}

function linesHtml(): string {
  const groups = lineGroups.map((g) => {
    const L = lineInfo(g.id);
    return `<div class="line-group panel" data-lg="${g.id}" style="border-color:${L.border}">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <label for="lines-${g.id}" style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-style:italic;font-size:24px;line-height:1;text-transform:uppercase">${esc(g.name)}</label>
        <span data-lg-count style="flex:none;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:15px;color:${L.color}">${esc(L.count)}</span>
      </div>
      <p class="muted" style="margin:4px 0 0;font-size:13px">${esc(g.id === 'donSmall' ? `Donație sub ${S.smallDonation} €.` : g.id === 'donBig' ? `Donație de ${S.smallDonation} € sau mai mult.` : g.when)}</p>
      <textarea class="field" id="lines-${g.id}" data-lines="${g.id}" rows="6" placeholder="O replică pe rând" style="margin-top:10px;width:100%;padding:10px;font:14px/1.6 Barlow,sans-serif;resize:vertical">${esc(lineText(g.id))}</textarea>
      <p style="margin:10px 0 6px;font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:12px;letter-spacing:.12em;color:#8C97A8">PREVIZUALIZARE</p>
      <div aria-live="polite" style="display:inline-block;max-width:100%;padding:8px 12px;background:#F2F5FA;color:#04101A;transform:rotate(-2deg);font-family:'Barlow Condensed',sans-serif;font-weight:900;font-style:italic;font-size:18px;line-height:1.05;text-transform:uppercase;overflow-wrap:anywhere"><span data-lg-who style="display:block;margin-bottom:2px;font-size:11px;font-style:normal;letter-spacing:.1em;color:#245A78">${esc(L.who)}</span><span data-lg-preview>${esc(L.preview)}</span></div>
    </div>`;
  }).join('');
  return `<section class="card wide" id="replici">
    <h2>Replicile lui Iceman ${tip(`O replică pe rând, minim ${MIN_LINES} pe grup, maxim ${MAX_LINE} de caractere.\nÎn replică poți scrie «{nume}», «{timp}», «{suma}» și «{subs}»: pe stream se înlocuiesc cu numele, timpul adăugat, suma și numărul de subs.\nUn grup cu mai puțin de ${MIN_LINES} replici e galben, iar balonul spune «${FALLBACK_LINE}» în loc.`)}</h2>
    <div class="panels">
      ${chatHtml()}
      <div class="panel">
        <label class="inline">Donație mare de la (€)<input class="field" type="number" inputmode="decimal" min="1" max="10000" id="smallDonation" value="${esc(S.smallDonation)}" style="width:120px"></label>
        <p class="hint">Sub prag e «Donație mică».</p>
      </div>
    </div>
    <div class="panels lg-grid">${groups}</div>
    <div class="row">
      <button class="btn-primary" data-act="linesSave">Salvează tot</button>
      ${S.linesDraft ? '<button class="btn-ghost" data-act="linesCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}
    </div>
  </section>`;
}

// ---- Rendering ----
// Don't wipe a field the moderator is typing in; re-render when they leave it.
let deferred = false;
app.addEventListener('focusout', () => { if (deferred) { deferred = false; setTimeout(render, 0); } });
// ---- Health: turn mod_health() into green / amber / red lines. ----
function demoHealth() {
  const now = new Date().toISOString();
  return { now, timer: { status: S.timer?.status, online: S.timer?.stream_online }, tipeee: { lastRun: now, lastCount: 0, error: null },
    watch: { lastRun: now, chatters: 412 }, twitch: { lastEvent: now }, donation: { lastEvent: now },
    jobs: ['icemaraton-minute', 'icemaraton-state', 'icemaraton-tipeee', 'icemaraton-watch-time'].map((job) => ({ job, status: 'succeeded', at: now, message: '' })),
    skipped: [], httpErrors: [], httpCalls: 120, resubs: { canRead: true, tracked: 186, lastSeen: now, found: 4 } };
}
function healthHtml(h: any): string {
  if (!h) return '<p class="muted">Nu pot citi starea acum.</p>';
  const now = Date.parse(h.now);
  const age = (iso: string | null) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);
  const ago = (s: number | null) => s === null ? 'niciodată' : s < 5 ? 'chiar acum' : s < 90 ? `acum ${s} s` : s < 5400 ? `acum ${Math.round(s / 60)} min` : `acum ${Math.round(s / 3600)} h`;
  const live = h.timer?.status === 'live', online = !!h.timer?.online;
  const rows: [string, string, string][] = [];
  // TipeeeStream donations (every 15 s)
  const tAge = age(h.tipeee?.lastRun ?? null);
  rows.push(h.tipeee?.error ? ['bad', 'Donații (TipeeeStream)', `Eroare: ${h.tipeee.error}. Ultima verificare ${ago(tAge)}.`]
    : tAge === null || tAge > 90 ? ['bad', 'Donații (TipeeeStream)', `Nu a mai verificat ${ago(tAge)} (ar trebui la 15 s).`]
    : ['ok', 'Donații (TipeeeStream)', `Verificat ${ago(tAge)}. Ultima donație: ${ago(age(h.donation?.lastEvent ?? null))}.`]);
  // Watch time (every 5 min, only live + online)
  const wAge = age(h.watch?.lastRun ?? null);
  rows.push(!live || !online ? ['off', 'Timp privit (chat)', 'Se numără doar cât ești live și pe stream.']
    : wAge === null || wAge > 720 ? ['bad', 'Timp privit (chat)', `Ultima numărare ${ago(wAge)} (ar trebui la 5 min). Verifică dacă streamerul e conectat.`]
    : ['ok', 'Timp privit (chat)', `Numărat ${ago(wAge)}: ${h.watch?.chatters ?? 0} în chat.`]);
  // Twitch EventSub
  const eAge = age(h.twitch?.lastEvent ?? null);
  rows.push(live && online && (eAge === null || eAge > 3600) ? ['warn', 'Subs și biți (Twitch)', `Nicio notificare ${ago(eAge)}. Normal dacă nu a venit niciun sub.`]
    : ['ok', 'Subs și biți (Twitch)', `Ultima notificare: ${ago(eAge)}.`]);
  // Resubs nobody shared, read from the subscriber badge in chat
  const R = h.resubs;
  if (R) rows.push(!R.canRead ? ['warn', 'Resubs din chat', 'Lipsește permisiunea. Iceman reconectează contul de streamer.']
    : ['ok', 'Resubs din chat', `${R.tracked ?? 0} abonați văzuți în chat · ${R.found ?? 0} resubs numărate fără share. Ultima actualizare: ${ago(age(R.lastSeen ?? null))}.`]);
  // Scheduled jobs
  const failed = (h.jobs ?? []).filter((j: any) => j.status === 'failed');
  rows.push(failed.length ? ['bad', 'Joburi programate', failed.map((j: any) => `${j.job}: ${j.message || 'eșuat'}`).join(' · ')]
    : ['ok', 'Joburi programate', `Toate ${(h.jobs ?? []).length} merg.`]);
  // Calls to the Edge Functions (last 30 min)
  const errs = (h.httpErrors ?? []).length, calls = h.httpCalls ?? 0;
  rows.push(!errs ? ['ok', 'Funcții (ultimele 30 min)', `${calls} apeluri, fără erori.`]
    : errs / Math.max(calls, 1) > 0.2 ? ['bad', 'Funcții (ultimele 30 min)', `${errs} erori din ${calls} apeluri. Ultima: ${h.httpErrors[0].status ?? 'fără răspuns'} ${ago(age(h.httpErrors[0].at))}.`]
    : ['warn', 'Funcții (ultimele 30 min)', `${errs} erori trecătoare din ${calls} apeluri (se reîncearcă singure).`]);
  const label: Record<string, string> = { ok: 'OK', warn: 'Atenție', bad: 'Problemă', off: 'Oprit' };
  return rows.map(([c, name, text]) => `<div class="ci" title="${esc(text)}"><span class="dot ${c}" role="img" aria-label="${label[c]}"></span><span class="ci-n">${esc(name)}</span><span class="ci-t">${esc(text)}</span></div>`).join('');
}

// ---- Layout: grouped by job (status bar on top, prism menu on the left) ----
const ICONS: Record<string, string> = {
  acum: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  activitati: 'M6 12h4M8 10v4M15 13h.01M18 11h.01M7 6h10a4 4 0 0 1 4 4v5a3 3 0 0 1-5.4 1.8L14.5 15h-5l-1.1 1.8A3 3 0 0 1 3 15v-5a4 4 0 0 1 4-4z',
  premii: 'M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C10.5 4 6 4 6 6.5S9 8 12 8c3 0 6 0 6-1.5S13.5 4 12 8',
  sponsori: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z',
  setari: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  streamer: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
};
/** HH:MM, Romania time. */
const hmRo = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' }) : '—');
// ---- Autopilot helpers ----
/** The preparation checklist (shared between moderators; some items the site checks by itself). */
const CHECK: { key: string; label: string; card?: string; auto?: () => boolean }[] = [
  { key: 'mods', label: 'Cei 3 moderatori sunt adăugați', card: 'moderatori' },
  { key: 'streamer', label: 'Iceman a reconectat contul de streamer', card: 'cronometru', auto: () => !!S.status?.broadcaster_connected && !!S.chat?.canWrite && !!S.health?.resubs?.canRead },
  { key: 'reward', label: 'Recompensa «Check-in ICEMARATON» pe Twitch' },
  { key: 'obs', label: 'Overlay-ul așezat în OBS și testat', card: 'overlay-piese' },
  { key: 'schedule', label: 'Start și final verificate', card: 'cronometru' },
  { key: 'start', label: 'Pornirea: automată sau manuală', card: 'cronometru', auto: () => !!S.auto?.autoStart },
  { key: 'lines', label: 'Replicile lui Iceman: minim 5 pe grup', card: 'replici', auto: () => lineGroups.every((g) => lineInfo(g.id).ok) },
  { key: 'chatline', label: 'Replicile în chat: da sau nu', card: 'replici' },
  { key: 'milestones', label: 'Milestone-urile finale', card: 'milestones' },
  { key: 'bingo', label: 'Bingo: cartonașul complet și premiul', card: 'bingo', auto: () => [9, 16, 25].includes(S.bingo?.items.length ?? 0) && !!S.bingo?.prize && !S.bingo.prize.startsWith('[') },
  { key: 'wheel', label: 'Roata: cele 8 premii', card: 'roata-premii' },
  { key: 'vote', label: 'Votul: lista verificată cu Iceman', card: 'pilot' },
  { key: 'plan', label: 'Program: înghețul 20–25 dec', card: 'plan', auto: () => (S.auto?.plan ?? []).some((x: any) => x.kind === 'freeze') },
  { key: 'alerts', label: 'Alerte în Discord', card: 'alerte', auto: () => !!S.auto?.hasWebhook },
  { key: 'sponsors', label: 'Sponsorii trimiși pentru site' },
  { key: 'tipeee', label: 'TipeeeStream doar în euro' },
  { key: 'pro', label: 'Supabase Pro (până pe 15 dec)' },
];
function checkState(c: (typeof CHECK)[number]): { done: boolean; auto: boolean; by?: string; at?: string } {
  if (c.auto?.()) return { done: true, auto: true };
  const m = S.auto?.checklist?.[c.key];
  return m ? { done: true, auto: false, by: m.by, at: m.at } : { done: false, auto: false };
}
const RULES: [string, string, string][] = [
  ['', 'Bifez eu', ''], ['milestone', 'Milestone nr.', 'n'], ['double', 'Prima Oră dublă', ''], ['donation', 'Donație de minim (€)', 'eur'],
  ['gift', 'Val de minim (subs cadou)', 'n'], ['hours', 'Cronometrul trece de (ore rămase)', 'h'], ['code', 'Primul cod secret', ''], ['raised', 'Strâns în total (€)', 'eur'],
];
function ruleText(r: { t: string; n?: number; eur?: number; h?: number } | null | undefined): string {
  if (!r) return '';
  switch (r.t) {
    case 'milestone': return `automat: la milestone-ul ${r.n}`;
    case 'double': return 'automat: la prima Oră dublă';
    case 'donation': return `automat: o donație de minim ${r.eur} €`;
    case 'gift': return `automat: un val de minim ${r.n} subs cadou`;
    case 'hours': return `automat: când rămân peste ${r.h} ore`;
    case 'code': return 'automat: la primul cod secret';
    case 'raised': return `automat: la ${r.eur} € strânși`;
    default: return '';
  }
}
const planKind: Record<string, string> = { double: 'Ora dublă', code: 'Cod secret', freeze: 'Îngheț' };
function planLine(x: any): string {
  const what = x.kind === 'freeze' ? `până la ${when(x.until)}` : x.kind === 'double' ? `${x.minutes} min` : `${x.minutes} min pe stream`;
  return `<strong>${planKind[x.kind] ?? x.kind}</strong> · ${when(x.at)} · ${what}${x.sponsor ? ` · <span style="color:#E6C46A">${esc(x.sponsor)}</span>` : ''}`;
}
const mainSponsor = () => (S.sponsors.length ? (S.sponsors.find((x: any) => x.tier === 'main')?.name ?? '') : site.sponsor.name && !site.sponsor.name.startsWith('[') ? site.sponsor.name : '');
/** A Twitch clip of the last ~30 s (make-clip), or null when it can't be made (offline, demo, no permission). */
async function clipNow(): Promise<string | null> {
  if (demoApi || S.test || !S.timer?.stream_online) return null;   // no real clips during a test
  try {
    const { data } = await db.functions.invoke('make-clip', { body: {} });
    if (data?.url) return String(data.url);
    if (data?.error === 'no_scope') say('Pentru clipuri automate, Iceman reconectează o dată contul de streamer.', true);
  } catch { /* no clip; the moderator can paste one */ }
  return null;
}

// The menu (owner, 25 Nov 2026: «make it make sense, so I know where everything is»). One home per thing,
// grouped by what it is: what happens on stream now, what viewers play (each activity with all its
// options), what they can win, who sponsors it, the internal settings, and what only the streamer does.
// Generic words only (owner: /mod becomes a template).
const GROUPS: { id: string; name: string; title: string; lead: string; items: [string, string][] }[] = [
  { id: 'acum', name: 'ACUM', title: 'Acum', lead: 'Ce se întâmplă pe stream și ce urmează.',
    items: [['rapid', 'Stream acum'], ['plan', 'Programate']] },
  { id: 'activitati', name: 'ACTIVITĂȚI', title: 'Activități', lead: 'Ce joacă spectatorii. Fiecare cu toate setările ei.',
    items: [['vot', 'Vot'], ['roata-premii', 'Roata'], ['bingo', 'Bingo'], ['sarcini', 'Donează și alegi'], ['milestones', 'Milestones']] },
  { id: 'premii', name: 'PREMII', title: 'Premii', lead: 'Tot ce pot câștiga spectatorii.',
    items: [['premii', 'De dat'], ['tombola', 'Tombole'], ['unde', 'Unde se câștigă']] },
  { id: 'sponsori', name: 'SPONSORI', title: 'Sponsori', lead: 'Cine susține subathonul.',
    items: [['sponsori', 'Sponsori'], ['raport', 'Raport']] },
  { id: 'setari', name: 'SETĂRI', title: 'Setări', lead: 'Pregătire și lucruri interne.',
    items: [['checklist', 'Checklist'], ['replici', 'Replici'], ['overlay-piese', 'Overlay OBS'], ['alerte', 'Alerte Discord'], ['moderatori', 'Moderatori'], ['test', 'Mod test']] },
  // Everything only the broadcaster's login can do, in one place (owner, 25 Nov 2026). Moderators see it
  // greyed out (the database refuses them too); during «Mod test» everyone may.
  { id: 'streamer', name: 'STREAMER', title: 'Streamer', lead: 'Doar contul streamerului apasă aici.',
    items: [['cronometru', 'Start'], ['prelungire', 'Prelungește'], ['zona', 'Încheiere']] },
];
/** Cards shown together with a menu item (an anchor of a bundled card opens its item). */
const BUNDLE: Record<string, string[]> = { vot: ['vot', 'provocari', 'propuneri', 'pilot'], cronometru: ['streamer', 'cronometru'] };
/** Old anchors (links in the guide, bookmarks) and the page they open now. */
const ALIAS: Record<string, string> = { parteneri: 'sponsori', 'bingo-bife': 'bingo', roata: 'roata-premii', tombole: 'tombola', stare: 'cronometru', inghetare: 'rapid', 'ora-dubla': 'rapid', acum: 'rapid', cod: 'rapid', overlay: 'overlay-piese', azi: 'rapid', program: 'plan', pregatire: 'checklist' };
/** Only Iceman (the broadcaster login) starts and ends the marathon; the database enforces it too. */
// During «Mod test» every moderator may (the database allows it too: it all goes back).
const isStreamer = () => !!S.test || (!!S.me && !!S.status?.broadcaster_login && S.me.login.toLowerCase() === S.status.broadcaster_login.trim().toLowerCase());
const onlyStreamer = () => `<span class="muted">Doar streamerul${S.status?.broadcaster_login ? ` (${esc(S.status.broadcaster_login)})` : ''} poate porni, prelungi sau încheia subathonul.</span>`;

/** The menu item that shows an anchor: the item itself, the card bundled under it, or an old anchor. */
function viewOf(raw: string): string | null {
  const id = ALIAS[raw] ?? raw;
  if (['todo', 'sanatate', 'control', 'urmeaza'].includes(id)) return 'rapid';
  for (const g of GROUPS) for (const [i] of g.items) if (i === id || (BUNDLE[i] ?? []).includes(id)) return i;
  return null;
}
const groupOf = (raw: string) => {
  const id = ALIAS[raw] ?? raw;
  if (['todo', 'sanatate', 'control', 'urmeaza'].includes(id)) return GROUPS[0];
  const v = viewOf(id);
  return GROUPS.find((g) => g.items.some(([i]) => i === v)) ?? GROUPS.find((g) => g.id === id);
};

/** How many things wait on each menu item (badges). */
function waiting(id: string): { n: number; warn?: boolean } {
  const raised = Number(S.stats?.raised ?? 0);
  switch (id) {
    case 'replici': return { n: lineGroups.filter((g) => !lineInfo(g.id).ok).length, warn: true };
    case 'milestones': return { n: S.goals.filter((g) => raised >= g.threshold && !g.done_at).length };
    case 'vot': return { n: S.suggestions.length };
    case 'premii': return { n: S.due.due.length };
    case 'sarcini': return { n: S.tasks?.pending ?? 0 };
    case 'bingo': return { n: S.bingo?.status.winners.length && !S.bingo.status.draws.length ? S.bingo.status.winners.length : 0 };
    case 'cronometru': return { n: S.status && !S.status.broadcaster_connected ? 1 : 0, warn: true };
    case 'checklist': return { n: CHECK.filter((c) => !checkState(c).done).length };
    default: return { n: 0 };
  }
}

function navHtml(): string {
  const cur = S.view;
  return GROUPS.map((g) => {
    const on = g.id === S.page;
    // Shown on a folded group's header: what waits inside it.
    const ws = g.items.map(([id]) => waiting(id));
    const sum = ws.reduce((a, w) => a + w.n, 0), warn = ws.some((w) => w.n && w.warn);
    return `<div class="ng${on ? ' on' : ''}">
      <a class="ng-head" href="#${g.items[0][0]}" ${on ? 'aria-current="true"' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[g.id]}"></path></svg><span>${esc(g.name)}</span>${sum ? `<span class="nb ng-sum${warn ? ' warn' : ''}" aria-label="${sum} de rezolvat">${sum}</span>` : ''}<svg class="ng-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></a>
      <div class="ng-items">${g.items.map(([id, label], i) => {
        const w = waiting(id);
        return `<a href="#${id}" data-nav="${id}" style="--i:${i}"${id === cur ? ' class="cur" aria-current="location"' : ''}>${esc(label)}${w.n ? `<span class="nb${w.warn ? ' warn' : ''}">${w.n}</span>` : ''}</a>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

/** The menu is one Tab stop: ↑/↓ (←/→ on phones), Home and End move inside it (M5).
    A live refresh re-draws it without taking the focus away. */
// Desktop: the menu column scrolls on its own; keep the open item in view (without moving the page).
function keepCurVisible(): boolean {
  const cur = nav.querySelector<HTMLElement>('.ng-items a.cur');
  if (!cur || nav.hidden || !cur.offsetParent) return false;   // not drawn yet: try again later
  // Offsets, not screen rectangles: on zoomed big screens rectangles are in zoomed pixels while
  // scrollTop is not, so mixing them scrolls too little.
  let top = 0;
  for (let el: HTMLElement | null = cur; el && el !== nav; el = el.offsetParent as HTMLElement | null) top += el.offsetTop;
  const bottom = top + cur.offsetHeight;
  if (top < nav.scrollTop + 8) nav.scrollTop = Math.max(0, top - 48);
  else if (bottom > nav.scrollTop + nav.clientHeight - 8) nav.scrollTop = bottom - nav.clientHeight + 48;
  return true;
}
// Once per page change: reveal the open item when the menu is drawn, and keep trying for 2 s
// while the layout settles (zoom on big screens, the top bar's real height). After that the
// menu stays wherever the moderator scrolled it.
let navCur = '';
let revealUntil = 0;
function revealCur() {
  if (navCur !== S.view) { navCur = S.view; revealUntil = Date.now() + 2000; }
  if (Date.now() < revealUntil) keepCurVisible();
}
new ResizeObserver(() => { fitNav(); if (!nav.hidden && Date.now() < revealUntil) keepCurVisible(); }).observe(nav);
// No scroll in the menu: show every group open if it fits, else only the open group (fold),
// then shorter rows with a mouse (tight); scrolling only as a last resort on tiny windows.
function fitNav() {
  // Mid-animation the group is shorter than it will be: keep the current fit until it ends.
  if (nav.querySelector('.ng.opening')) return;
  nav.classList.remove('fold', 'tight', 'overflow');
  if (nav.hidden || getComputedStyle(nav).flexDirection === 'row') return;
  const fits = () => nav.scrollHeight <= nav.clientHeight + 1;
  if (fits()) return;
  nav.classList.add('fold');
  if (fits()) return;
  if (matchMedia('(pointer: fine)').matches) { nav.classList.add('tight'); if (fits()) return; }
  nav.classList.add('overflow');
}
// A folded group that opens slides open, its items fade in one after another (reduced motion: no motion).
let navPage = '';
function animateOpen() {
  const changed = navPage && navPage !== S.page;
  navPage = S.page;
  if (!changed || !nav.classList.contains('fold') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const g = nav.querySelector<HTMLElement>('.ng.on');
  const box = g?.querySelector<HTMLElement>('.ng-items');
  if (!g || !box) return;
  box.style.setProperty('--h', `${box.scrollHeight}px`);
  g.classList.add('opening');
  window.setTimeout(() => { g.classList.remove('opening'); fitNav(); }, 900);
}
window.addEventListener('resize', () => fitNav());
function setNav() {
  const had = nav.contains(document.activeElement) ? (document.activeElement as HTMLAnchorElement).getAttribute('href') : null;
  nav.innerHTML = navHtml();
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
  const home = links.find((a) => a.classList.contains('cur')) ?? links.find((a) => a.closest('.ng.on')) ?? links[0];
  links.forEach((a) => { a.tabIndex = a === home ? 0 : -1; });
  if (had) (links.find((a) => a.getAttribute('href') === had) ?? home)?.focus({ preventScroll: true });
  // Only when the open item changed (live refreshes redraw the menu too and must not move it).
  fitNav();
  animateOpen();
  if (!nav.hidden) { revealCur(); requestAnimationFrame(() => { fitNav(); if (Date.now() < revealUntil) keepCurVisible(); }); }
}
nav.addEventListener('keydown', (e) => {
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')].filter((a) => a.offsetParent !== null);
  const i = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (i < 0) return;
  const to = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? Math.min(links.length - 1, i + 1)
    : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? Math.max(0, i - 1)
    : e.key === 'Home' ? 0 : e.key === 'End' ? links.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  links.forEach((a, j) => { a.tabIndex = j === to ? 0 : -1; });
  links[to].focus();
});

/** Health rows → short status dots for the bar. */
function healthDots(): string {
  const h = S.health;
  if (!h) return '';
  const now = Date.parse(h.now);
  const age = (iso: string | null) => (iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 1000)) : null);
  const short = (sec: number | null) => sec === null ? '—' : sec < 90 ? `${sec} s` : sec < 5400 ? `${Math.round(sec / 60)} min` : `${Math.round(sec / 3600)} h`;
  const live = h.timer?.status === 'live', online = !!h.timer?.online;
  const tA = age(h.tipeee?.lastRun ?? null), wA = age(h.watch?.lastRun ?? null), eA = age(h.twitch?.lastEvent ?? null);
  const failed = (h.jobs ?? []).some((j: any) => j.status === 'failed');
  const dots: [string, string, string][] = [
    [live && online && (eA === null || eA > 3600) ? 'warn' : 'ok', 'Subs și biți', short(eA)],
    [!live || !online ? 'off' : wA === null || wA > 720 ? 'bad' : 'ok', 'Timp privit', live && online ? short(wA) : 'oprit'],
    [h.tipeee?.error || tA === null || tA > 90 ? 'bad' : (h.skipped ?? []).length ? 'warn' : 'ok', 'Donații', (h.skipped ?? []).length ? `${(h.skipped ?? []).length} în altă monedă` : short(tA)],
    [failed ? 'bad' : 'ok', 'Joburi', failed ? 'eroare' : 'OK'],
  ];
  // Phones show one labelled chip instead of the dots (M4).
  const bad = dots.filter(([c]) => c === 'bad'), warn = dots.filter(([c]) => c === 'warn');
  const issues = [...bad, ...warn];
  const [cls, text] = !navigator.onLine ? ['bad', 'Fără conexiune']
    : issues.length ? [bad.length ? 'bad' : 'warn', `${issues.length} ${issues.length === 1 ? 'problemă' : 'probleme'} · ${issues.map(([, n]) => n).join(', ')}`]
    : ['ok', 'Totul merge'];
  // The colour of each dot is also said in words for screen readers; only one of dots / chip is displayed.
  const state = (c: string) => (c === 'ok' ? 'merge' : c === 'off' ? 'oprit' : c === 'warn' ? 'de verificat' : 'problemă');
  return `<a class="hdots" href="#rapid">${dots.map(([c, n, v]) => `<span class="hd"><span class="dot ${c}"></span><span class="hd-n">${n}</span><span class="sr-only">: ${state(c)},</span> <span class="muted">${v}</span></span>`).join('')}<span class="hsum ${cls}">${esc(text)}</span></a>`;
}

function barHtml(): string {
  const brand = '<a class="brand" href="#rapid">ICE<span>MARATON</span> <small>/MOD</small></a>';
  if (!S.me) return brand;
  const who = `<span class="who">${demo ? '<span class="pill ok">Demo</span>' : ''}<span class="avatar" aria-hidden="true">${esc((S.me.login || '?').charAt(0).toUpperCase())}</span><span class="who-n">${esc(S.me.login)}</span><button class="btn-ghost" data-act="logout">Ieși</button></span>`;
  if (!S.me.is_moderator) return brand + '<span class="grow"></span>' + who;
  const t = S.timer ?? {};
  const now = Date.now();
  const frozen = t.paused_until && Date.parse(t.paused_until) > now;
  // B-08: at zero the marathon is over, even before the server's minute tick marks it.
  const live = t.status === 'live' && !(t.ends_at && Date.parse(t.ends_at) <= now && !frozen);
  const dbl = t.double_from && t.double_until && Date.parse(t.double_until) > now;
  const dblNow = dbl && Date.parse(t.double_from) <= now;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });
  return `${brand}<span class="sep"></span>
    <span class="pill ${live ? 'bad' : 'off'} skew">${live ? 'LIVE' : t.status === 'ended' || t.status === 'live' ? 'ÎNCHEIAT' : 'CURÂND'}</span>
    <span class="bar-clock" data-left>${live ? left(Date.parse(t.ends_at) - (frozen ? Date.parse(t.paused_until) : now)) : '—'}</span>
    ${live && frozen ? `<span class="chip frost">ÎNGHEȚAT PÂNĂ LA ${esc(when(t.paused_until))}</span>` : ''}
    ${dbl ? `<span class="chip dbl">ORA DUBLĂ ${dblNow ? `×2 PÂNĂ LA ${hm(t.double_until)}` : esc(when(t.double_from))}${t.double_sponsor ? ` · ${esc(String(t.double_sponsor).toUpperCase())}` : ''}</span>` : ''}
    ${(() => { const c = S.codes.find((x) => x.expires_at && Date.parse(x.expires_at) > now); return c ? `<span class="chip run">COD ${esc(c.code)} · ${c.claims}</span>` : ''; })()}
    <span class="grow"></span>${healthDots()}${who}`;
}

// ---- «Stream acum»: the dashboard (numbers strip, Control live, inbox, timeline, connections) ----
const LIVE_TABS: [S_tab: 'timp' | 'freeze' | 'double' | 'code' | 'note', label: string][] = [
  ['timp', 'Timp'], ['freeze', 'Îngheață'], ['double', 'Ora dublă'], ['code', 'Cod secret'], ['note', 'Notă pe site'],
];
const shortWhen = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const day = d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Bucharest' });
  const today = new Date().toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Bucharest' });
  return day === today ? hmRo(iso) : `${day} ${hmRo(iso)}`;
};
function dashHtml(t: Record<string, any>, live: boolean, remaining: number, now: number): string {
  const raised = Number(S.stats?.raised ?? 0);
  const next = S.goals.find((g) => raised < g.threshold) ?? null;
  const prev = [...S.goals].reverse().find((g) => raised >= g.threshold)?.threshold ?? 0;
  const pct = next ? Math.max(0, Math.min(100, ((raised - prev) / Math.max(1, next.threshold - prev)) * 100)) : 100;
  const frozen = !!t.paused_until && Date.parse(t.paused_until) > now;
  const dblNow = !!t.double_from && Date.parse(t.double_from) <= now && Date.parse(t.double_until) > now;
  const cur = S.codes.find((c) => c.expires_at && Date.parse(c.expires_at) > now);
  const chatters = S.health?.watch?.chatters;
  const kpi = (k: string, v: string, sub: string, extra = '') => `<div class="kpi"><div class="kl">${k}</div><div class="kv"${k === 'TIMP RĂMAS' && live ? ' data-left' : ''}>${v}</div>${extra}<div class="ks">${sub}</div></div>`;
  const kpis = `<section class="kpis" aria-label="Pe scurt">
    ${kpi('TIMP RĂMAS', live ? left(remaining) : t.status === 'ended' ? 'Încheiat' : '—', live ? `Final programat ${esc(shortWhen(t.scheduled_end))}` : `Start ${esc(when(t.starts_at))}`)}
    ${kpi('STRÂNS', `${fmtInt(raised)} €`, next ? `Următorul milestone la ${fmtInt(next.threshold)} €` : 'Toate milestone-urile deblocate', `<div class="kbar"><span style="width:${pct.toFixed(1)}%"></span></div>`)}
    ${kpi('SUBS', fmtInt(Number(S.stats?.subs ?? 0)), `${fmtInt(Number(S.stats?.bits ?? 0))} biți`)}
    ${kpi('ÎN CHAT', chatters !== undefined && chatters !== null ? fmtInt(Number(chatters)) : '—', 'numărat la 5 minute')}
  </section>`;

  const on = { timp: false, freeze: frozen, double: dblNow, code: !!cur, note: !!S.now?.note } as Record<string, boolean>;
  const states = [
    frozen ? `<span class="pill-s">ÎNGHEȚAT PÂNĂ LA ${hmRo(t.paused_until)}</span>` : '',
    dblNow ? `<span class="pill-s">ORA DUBLĂ ×2 PÂNĂ LA ${hmRo(t.double_until)}${t.double_sponsor ? ` · ${esc(String(t.double_sponsor).toUpperCase())}` : ''}</span>` : '',
    cur ? `<span class="pill-s">COD ${esc(cur.code)} · ${cur.claims} REVENDICĂRI</span>` : '',
    S.now?.note ? `<span class="pill-s">NOTĂ: ${esc(S.now.note)}</span>` : '',
  ].join('');
  const needsLive = '<p class="muted" style="margin:0">Merge după ce pornește cronometrul.</p>';
  const panel: Record<string, string> = {
    timp: !live ? needsLive : `<div class="quick">
        <button class="btn-ghost" data-act="add" data-min="1">+1 min</button><button class="btn-ghost" data-act="add" data-min="5">+5 min</button>
        <button class="btn-ghost" data-act="add" data-min="10">+10 min</button><button class="btn-ghost" data-act="add" data-min="-5">−5 min</button></div>
      <div class="row"><label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="addMin" placeholder="ex: 15"></label><button class="btn-primary" data-act="addCustom">Adaugă</button>${tip(TIME_BY_HAND)}</div>`,
    freeze: !live ? needsLive : `<div class="row"><label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="freezeMin" value="10"></label>
        <button class="btn-primary" data-act="freeze">Îngheață</button>${frozen ? '<button class="btn-ghost" data-act="unfreeze">Dezgheață</button>' : ''}${tip('Subs și donațiile adaugă timp și cât e înghețat.\nPentru 20–25 decembrie: ACUM → Programate.')}</div>
      `,
    double: !live ? needsLive : `<div class="row"><label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="dblMin" value="60"></label>
        <label class="inline" style="flex:1 1 200px">Oferită de<input class="field" id="dblSponsor" list="sponsorNames" placeholder="opțional"></label>
        <button class="btn-primary" data-act="doubleNow">Pornește acum</button></div>`,
    code: !live ? needsLive : `<div class="row"><label class="inline" style="flex:1 1 200px">Oferit de<input class="field" id="codeSponsor" list="sponsorNames" value="${esc(mainSponsor())}" maxlength="60"></label>
        <label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="codeMin" value="10" min="1" max="60"></label>
        <button class="btn-primary" data-act="codeShow">Arată pe stream</button>${cur ? '<button class="btn-ghost" data-act="codeEnd">Oprește</button>' : ''}</div>`,
    note: `<p class="muted" style="margin:0">Twitch: ${esc(S.now?.title ?? '—')}</p>
      <div class="row"><input class="field" id="nowNote" placeholder="ex: Pauză de masă, revin în 15 min" maxlength="140" aria-label="Notă pe site" style="flex:1 1 260px;min-width:0">
        <label class="inline">Minute<input class="field" type="number" id="nowMin" value="30" min="1" max="1440"></label>
        <button class="btn-primary" data-act="noteSet">Arată</button>${S.now?.note ? '<button class="btn-ghost" data-act="noteClear">Scoate</button>' : ''}</div>`,
  };
  const control = `<section class="card flush" id="control"><h2>Control live ${tip('Ce schimbi aici apare pe site și pe stream în câteva secunde.')}</h2>
    <div class="tabs" role="tablist" aria-label="Control live">${LIVE_TABS.map(([k, l]) => `<button type="button" role="tab" class="tab${S.liveTab === k ? ' on' : ''}" aria-selected="${S.liveTab === k}" data-act="liveTab" data-tab="${k}">${l}${on[k] ? '<span class="pip" aria-label="activ"></span>' : ''}</button>`).join('')}</div>
    <div class="tab-body" role="tabpanel">${states ? `<div class="states">${states}</div>` : ''}${panel[S.liveTab]}</div>
  </section>`;

  const A = S.auto;
  const items = (A?.plan ?? []).filter((x: any) => !x.done).slice(0, 4);
  const planRows = [
    ...items.map((x: any) => `<div class="tli"><time>${esc(shortWhen(x.at))}</time><span class="tlm"></span><span>${planLine(x)}</span></div>`),
    A?.voteOn ? `<div class="tli"><time>${esc(A.voteAt)}</time><span class="tlm"></span><span><strong>Vot automat</strong> · runda de azi, când Iceman e live</span></div>` : '',
  ].join('');
  const plan = `<section class="card flush" id="urmeaza"><div class="card-head"><h2>Urmează din program</h2><a class="btn btn-ghost btn-s" href="#plan">Programează</a></div>
    ${planRows || '<p class="muted flush-p">Nimic programat.</p>'}</section>`;
  const conn = `<section class="card flush" id="sanatate"><h2>Conexiuni <span class="h2-note">la un minut</span></h2>${healthHtml(S.health)}</section>`;
  return `${kpis}<div class="dash">${control}${todoHtml()}</div><div class="dash">${plan}${conn}</div>`;
}

// «Mod test»: the whole site on fake data; «Oprește testul» puts everything back (see the
// migration 20261209100000_test_session.sql). The strip sits on top of every /mod page while it runs.
function testBtn(a: string, label: string, p: Record<string, unknown> = {}, ok = 'Gata.') {
  return `<button class="btn-ghost" data-act="testDo" data-a="${a}" data-p='${esc(JSON.stringify(p))}' data-ok="${esc(ok)}">${esc(label)}</button>`;
}
function testStripHtml(): string {
  const T = S.test;
  if (!T) return '';
  const online = !!S.timer?.stream_online;
  const sub = !!S.me?.is_subscriber;
  // The site says LIVE and time is added only while the (test) marathon runs, exactly like the real one.
  const st = S.timer?.status ?? 'upcoming';
  const hrs = Number(S.auto?.startHours) || 24;
  const marathon = st === 'live'
    ? `<span class="pill-s">LIVE PE SITE · SE TERMINĂ LA ${hmRo(S.timer?.ends_at ?? null)}</span><button class="btn-ghost" data-act="testEnd">Încheie maratonul de test</button>`
    : st === 'ended'
      ? `<span class="pill-s">ÎNCHEIAT</span>${tip('«De la capăt» îl aduce înapoi la start.')}`
      : `<button class="btn-primary" data-act="testGoLive" data-h="${hrs}">Pornește maratonul de test (${hrs} h)</button>${tip('Până atunci site-ul arată «Începe curând», iar donațiile umplu doar «Strâns», fără timp (ca în realitate).')}`;
  return `<section class="test-strip" aria-label="Mod test">
    <p class="ts-head"><span class="ts-tag">TEST</span><strong>Mod test</strong><span>pornit de ${esc(T.by ?? 'un moderator')} · se oprește singur la ${hmRo(T.until)}</span>${tip('Tot ce se schimbă acum, și pe /mod, se șterge la oprire.\nPregătirea reală (sponsori, premii, provocări) o faci după test.')}</p>
    <div class="ts-rows">
      <div class="ts-row"><span>Maraton</span>${marathon}</div>
      <div class="ts-row"><span>Twitch</span>${testBtn('sub', 'Sub', {}, 'Sub de test.')}${testBtn('sub', 'Sub Tier 3', { tier: '3000' }, 'Sub Tier 3 de test.')}${testBtn('gift', '10 subs cadou', { n: 10 }, '10 subs cadou de test.')}${testBtn('bits', '400 biți', { n: 400 }, '400 de biți de test.')}${testBtn('stream', online ? 'Iceman iese de pe Twitch' : 'Iceman intră pe Twitch', { on: !online }, online ? 'Iceman apare offline pe Twitch: timpul privit nu se mai numără.' : 'Iceman apare live pe Twitch: se numără timpul privit, votul automat merge.')}</div>
      <div class="ts-row"><span>Donații</span>${testBtn('donation', '5 €', { n: 5 }, 'Donație de test, 5 €.')}${testBtn('donation', '50 €', { n: 50 }, 'Donație de test, 50 €.')}${testBtn('donation', '250 €', { n: 250 }, 'Donație de test, 250 €.')}</div>
      <div class="ts-row"><span>Spectatori</span>${testBtn('crowd', '+25 de test', { n: 25 }, '25 de spectatori de test: privesc, votează, aleg bingo.')}${testBtn('me_sub', sub ? 'Eu: neabonat' : 'Eu: abonat', { on: !sub }, sub ? 'Pe site apari neabonat.' : 'Pe site apari abonat.')}${testBtn('me_watch', 'Eu: +2 h privit', { minutes: 120 }, 'Ai 2 ore privite azi: roata e deblocată.')}</div>
      <div class="ts-row"><span>Ceas</span>${clockTestHtml()}</div>
      <div class="ts-row"><span>Alegeri</span>${(S.tasks?.menu ?? []).map((m) => testBtn('donation', `${euroTxt(m.price)} · ${m.title}`, { n: m.price }, `Donație de test ${euroTxt(m.price)}: «${m.title}» e în coadă (Donează și alegi).`)).join('') || '<span class="ts-note">Lista e goală: completeaz-o în ACTIVITĂȚI → Donează și alegi.</span>'}${st === 'upcoming' ? tip('Primul buton pornește și maratonul de test.') : ''}</div>
      <div class="ts-row"><span>Sponsori</span><button class="btn-ghost" data-act="testSponsors">Sponsori de test (10)</button>${tip('Mărci inventate, cu logo, pe site și pe overlay. La oprire revin sponsorii reali.')}</div>
      <div class="ts-row"><span>Testul</span>${testBtn('extend', '+1 oră', {}, 'Testul merge încă o oră.')}<button class="btn-ghost" data-act="testRedo">De la capăt</button><button class="btn-primary" data-act="testStop">Oprește testul</button></div>
    </div>
  </section>`;
}
// «Ceas» in the test strip: freeze and Ora dublă (plain or sponsored) on the test marathon.
function clockTestHtml(): string {
  const t = S.timer ?? {};
  const now = Date.now();
  const frozen = !!t.paused_until && Date.parse(t.paused_until) > now;
  const dbl = !!t.double_from && !!t.double_until && Date.parse(t.double_from) <= now && Date.parse(t.double_until) > now;
  const main = S.sponsors.find((x: any) => x.tier === 'main')?.name ?? '';
  const b = (a: string, label: string) => `<button class="btn-ghost" data-act="testClock" data-a="${a}">${esc(label)}</button>`;
  return (frozen ? b('unfreeze', 'Dezgheață') : b('freeze', 'Îngheață 5 min'))
    + (dbl ? b('nodouble', 'Oprește Ora dublă') : b('double', 'Ora dublă 10 min') + (main ? b('doubleSp', `Ora dublă de la ${main}`) : ''));
}
function testCardHtml(): string {
  const upcoming = (S.timer?.status ?? 'upcoming') === 'upcoming';
  const body = S.test
    ? `<p style="margin:0">Testul merge până la <strong>${hmRo(S.test.until)}</strong>. Comenzile sunt în banda galbenă de sus, pe orice pagină.</p>
       <div class="row"><button class="btn-primary" data-act="testStop">Oprește testul</button></div>`
    : !upcoming
      ? '<p class="muted" style="margin:0">Doar înainte de start: maratonul real a pornit.</p>'
      : `<div class="row"><label class="inline">Cât ține<select class="field" id="testHours">${[1, 2, 3, 4, 6].map((h) => `<option value="${h}"${h === 3 ? ' selected' : ''}>${h} ${h === 1 ? 'oră' : 'ore'}</option>`).join('')}</select></label>
         <button class="btn-primary" data-act="testStart">Pornește testul</button></div>`;
  return `<section class="card wide" id="test">
    <h2>Mod test ${tip('Pe site apare o bandă galbenă «TEST», în overlay eticheta TEST.\nOrice moderator poate porni și încheia maratonul de test.\nChatul Twitch nu primește mesaje, clipurile nu se fac, alertele Discord au «TEST».\nRămân neatinse: moderatorii, checklistul de pregătire, conturile spectatorilor.\nSe oprește singur la ora aleasă, cel târziu cu 30 de minute înainte de start.')}</h2>
    <p class="lead">Tot site-ul, /mod și overlay-ul merg pe date de probă: subs, donații, spectatori, vot, roată, bingo. La oprire totul revine exact cum era.</p>
    ${body}
  </section>`;
}

// «Prelungește» (owner, 25 Nov): while LIVE, Iceman moves the planned end later as often as he wants;
// the clock gets the same extra time (mod_extend, migration 20261214100000). Nothing ends or restarts.
/** Shown next to «Prelungește» and the manual «+ min» (owner, 25 Nov). */
const TIME_BY_HAND = 'Fiecare apăsare în /mod e o acțiune separată: dacă doi moderatori apasă «+5 min» pentru același lucru, ceasul primește +10. La fel și la «Prelungește». Stabiliți cine adaugă timp de mână.';
const EXTEND_HELP = 'Muți finalul programat mai târziu, de câte ori vrei, fără să oprești subathonul.\nCronometrul primește exact diferența: mutat de la 17 la 25 ianuarie, ceasul primește 8 zile în plus, chiar dacă subs l-au împins deja mai departe.\nSe poate doar înainte să ajungă ceasul la zero.\n\n' + TIME_BY_HAND;
const durRo = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} ${d === 1 ? 'zi' : 'zile'}${h ? ` ${h} h` : ''}` : h ? `${h} h${mm ? ` ${mm} min` : ''}` : `${mm} min`;
};
/** From where an extension counts: the planned end, or now if that already passed. */
const extendBase = (t: Record<string, any>) => Math.max(t.scheduled_end ? Date.parse(t.scheduled_end) : 0, Date.now());
// The date field has whole minutes; the planned end may have seconds. Count from its minute and send the
// new end with the same seconds, so «+1 zi» is exactly 24 h on the clock (not 23 h 59 min 30 s).
const extendSecs = (t: Record<string, any>) => extendBase(t) % 60_000;
function extendPreview(t: Record<string, any>, to: string): string {
  const v = to ? Date.parse(to) : NaN;
  if (!Number.isFinite(v)) return 'Alege data nouă.';
  const add = v + extendSecs(t) - extendBase(t);
  if (add < 60_000) return 'Data nouă trebuie să fie după finalul programat de acum.';
  const now = Date.now();
  const clock = Date.parse(t.ends_at) - (t.paused_until && Date.parse(t.paused_until) > now ? Date.parse(t.paused_until) : now);
  return `Cronometrul primește +${durRo(add)}: va arăta ${left(clock + add)}. Nimic nu se oprește.`;
}
function extendHtml(t: Record<string, any>): string {
  const base = extendBase(t);
  const def = toLocal(new Date(base + 86_400_000).toISOString());
  const ice = isStreamer();
  return `<div class="ext">
        <div class="ext-now"><span>Final programat</span><strong>${esc(when(t.scheduled_end))}</strong></div>
        <div class="quick ext-quick">${[1, 3, 7, 14].map((d) => `<button class="btn-ghost" data-act="extendBy" data-days="${d}"${ice ? '' : ' disabled'}>+${d} ${d === 1 ? 'zi' : 'zile'}</button>`).join('')}</div>
        <div class="fgrid">
          <label class="inline">Final nou<input class="field" type="datetime-local" id="extendTo" value="${def}"${ice ? '' : ' disabled'}></label>
          <button class="btn-primary" data-act="extend"${ice ? '' : ' disabled'}>Prelungește</button>
        </div>
        <p class="hint" id="extendPrev" aria-live="polite">${ice ? esc(extendPreview(t, def)) : onlyStreamer()}</p>
      </div>`;
}

// «Donează și alegi»: one donation of exactly a listed amount = that task, with the donor's name.
// The requests wait here until a moderator ticks «Făcută»; the list is edited below them.
const euroTxt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
function tasksHtml(): string {
  const T = S.tasks;
  const queue = T?.queue ?? [];
  const list = T?.menu ?? [];
  const draft = S.tasksDraft ?? list.map((m) => `${String(m.price).replace('.', ',')} | ${m.title}`).join('\n');
  const rows = queue.map((q) => `<li><span class="grow"><strong>${euroTxt(q.price)} · ${esc(q.title)}</strong><br><span class="muted">${esc(q.name)} · ${hmRo(new Date(q.at).toISOString())}</span></span>
      <button class="btn-primary" data-act="taskDone" data-id="${q.id}">Făcută</button></li>`).join('');
  return `<section class="card wide" id="sarcini">
    <h2>Donează și alegi ${tip('O donație de exact suma din listă (în euro, cât maratonul e LIVE) pune sarcina în coadă, cu numele donatorului. Alte sume adaugă doar timp.\nBifați «Făcută» când Iceman a făcut-o.')}${T?.pending ? `<span class="h2-note">${T.pending} de făcut</span>` : ''}</h2>
    ${queue.length ? `<ul class="list">${rows}</ul>${T && T.pending > queue.length ? `<p class="muted">+${T.pending - queue.length} mai vechi după acestea.</p>` : ''}` : '<p class="empty">Nimic de făcut acum.</p>'}
    <h3 class="h3s">Lista de pe overlay ${tip('Câte una pe rând: suma, o bară verticală, apoi sarcina. De exemplu «10 | Alege un campion».\nCel mult 8, fiecare cu altă sumă.')}</h3>
    <textarea class="field" id="tasksList" rows="6" aria-label="Lista: câte una pe rând, suma | sarcina" placeholder="10 | Alege un campion" style="width:100%">${esc(draft)}</textarea>
    <div class="row"><button class="btn-primary" data-act="tasksSave">Salvează lista</button></div>
  </section>`;
}

// ---- Sponsori: every field a sponsor may need, logos uploaded to Storage --------------------
const SP_TIERS: [string, string][] = [['main', 'Partener principal'], ['partner', 'Partener'], ['supporter', 'Susținător']];
const SP_SOCIALS: [string, string][] = [['website', 'Site'], ['instagram', 'Instagram'], ['tiktok', 'TikTok'], ['youtube', 'YouTube'], ['facebook', 'Facebook'], ['discord', 'Discord']];
const spShownNow = (x: any) => {
  const now = Date.now();
  const from = x.visible_from ? Date.parse(x.visible_from) : null, until = x.visible_until ? Date.parse(x.visible_until) : null;
  return (from === null || from <= now) && (until === null || until > now);
};
function spLogo(src: string | null, name: string, big = false) {
  return `<span class="sp-logo${big ? ' big' : ''}">${src ? `<img src="${esc(src)}" alt="">` : `<span>${esc(name ? name.toUpperCase() : 'LOGO')}</span>`}</span>`;
}
function sponsorsHtml(): string {
  const list = S.sponsors;
  const row = (x: any) => {
    const same = list.filter((y) => y.tier === x.tier);
    const i = same.indexOf(x);
    const flags = [
      !x.show_site && !x.show_overlay ? '<span class="pill off">ASCUNS</span>' : '',
      x.show_site && !x.show_overlay ? '<span class="pill off">DOAR SITE</span>' : '',
      !x.show_site && x.show_overlay ? '<span class="pill off">DOAR OVERLAY</span>' : '',
      !spShownNow(x) ? '<span class="pill warn">ÎN AFARA PERIOADEI</span>' : '',
      x.code ? `<span class="pill next">COD ${esc(x.code)}</span>` : '',
      !x.url ? '<span class="pill warn">FĂRĂ LINK</span>' : '',
      !x.logo_url ? '<span class="pill warn">FĂRĂ LOGO</span>' : '',
    ].join('');
    return `<li class="sp-row${S.spEdit === x.id ? ' on' : ''}">
      ${spLogo(x.logo_url, x.name)}
      <span class="grow"><strong style="color:#F2F5FA">${esc(x.name)}</strong>${x.role ? ` <span class="muted">· ${esc(x.role)}</span>` : ''}<br><span class="sp-flags">${flags || '<span class="pill ok">Complet</span>'}</span></span>
      <span class="pair">
        <button class="btn-ghost sp-mv" data-act="spMove" data-id="${x.id}" data-dir="-1" aria-label="Mută ${esc(x.name)} mai sus" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn-ghost sp-mv" data-act="spMove" data-id="${x.id}" data-dir="1" aria-label="Mută ${esc(x.name)} mai jos" ${i === same.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="${S.spEdit === x.id ? 'btn-primary' : 'btn-ghost'}" data-act="spEdit" data-id="${x.id}">Editează</button>
      </span></li>`;
  };
  const groups = SP_TIERS.map(([t, label]) => {
    const items = list.filter((x) => x.tier === t);
    return `<h3 class="h3s">${label}${t === 'main' ? '' : ` · ${items.length}`}</h3>${items.length ? `<ul class="list sp-list">${items.map(row).join('')}</ul>` : `<p class="muted" style="margin:4px 0 0">${t === 'main' ? 'Niciunul încă.' : 'Niciunul încă. Locurile goale apar pe site ca «LOGO».'}</p>`}`;
  }).join('');
  const editing = S.spEdit === 'new' ? {} as any : list.find((x) => x.id === S.spEdit);
  return `<section class="card wide" id="sponsori">
    <div class="card-head"><h2>Sponsori ${tip('Apar pe site (sub titlu, la ofertă și în peretele de parteneri) și pe overlay (linia partenerului). Se actualizează în câteva secunde.')}</h2><button class="btn-primary btn-s" data-act="spNew">+ Adaugă sponsor</button></div>
    ${S.spEdit !== null && editing ? spFormHtml(editing) : ''}
    ${groups}
  </section>`;
}
function spFormHtml(x: any): string {
  const v = (k: string) => esc(x[k] ?? '');
  const isNew = !x.id;
  const field = (id: string, label: string, value: string, attrs = '') => `<label class="inline sp-f">${label}<input class="field" id="${id}" value="${value}" ${attrs}></label>`;
  const area = (id: string, label: string, value: string, max: number, rows = 3) => `<label class="inline sp-f sp-wide"><span>${label} <span class="lbl-note">· max ${max}</span></span><textarea class="field" id="${id}" rows="${rows}" maxlength="${max}">${value}</textarea></label>`;
  const check = (id: string, label: string, on: boolean) => `<label class="sp-check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}> ${label}</label>`;
  return `<div class="sp-form" id="sp-form">
    <h3 class="h3s" style="margin-top:0">${isNew ? 'Sponsor nou' : `Editezi: ${esc(x.name)}`}</h3>
    <div class="sp-grid">
      <label class="inline sp-f">Nivel<select class="field" id="sp_tier">${SP_TIERS.map(([t, l]) => `<option value="${t}"${(x.tier ?? 'partner') === t ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      ${field('sp_name', 'Nume *', v('name'), 'maxlength="60" required')}
      ${field('sp_role', 'Ce susține (ex: Premii roată)', v('role'), 'maxlength="40"')}
      ${area('sp_desc', 'Descriere scurtă, pentru vizitatori', v('description'), 280)}
    </div>
    <h3 class="h3s">Logo ${tip('SVG sau PNG, ideal alb pe fundal transparent, max 2 MB. Previzualizarea arată cum iese pe fundalul închis al site-ului.')}</h3>
    <div class="sp-logo-row">
      <div class="sp-prev" id="sp_prev">${spLogo(x.logo_url ?? null, x.name ?? '', true)}</div>
      <div class="sp-logo-ctl">
        <label class="btn btn-ghost sp-upload">Încarcă logo<input type="file" id="sp_file" accept="image/png,image/svg+xml,image/webp,image/jpeg" hidden></label>
        <button class="btn-ghost" data-act="spLogoClear">Scoate logo</button>
        ${field('sp_logo', 'sau link spre logo', v('logo_url'), 'placeholder="https://…" inputmode="url"')}
      </div>
    </div>
    <h3 class="h3s">Link și ofertă</h3>
    <div class="sp-grid">
      ${field('sp_url', 'Linkul unde vrea sponsorul vizitatorii', v('url'), 'placeholder="https://…" inputmode="url"')}
      ${field('sp_cta', 'Textul butonului', v('cta'), 'placeholder="Vezi oferta" maxlength="30"')}
      ${field('sp_code', 'Cod de reducere', v('code'), 'maxlength="30" style="text-transform:uppercase"')}
      ${field('sp_code_note', 'Ce oferă codul (ex: 10% la periferice)', v('code_note'), 'maxlength="80"')}
      <label class="inline sp-f">Oferta e valabilă până la<input class="field" type="datetime-local" id="sp_offer_until" value="${toLocal(x.offer_until ?? null)}"></label>
      <div class="sp-f sp-wide">${check('sp_utm', 'Adaugă etichete UTM la link (sponsorul vede în statisticile lui vizitele venite de la noi)', x.utm !== false)}</div>
    </div>
    <h3 class="h3s">Pe stream</h3>
    <div class="sp-grid">
      ${field('sp_overlay_line', 'Linia de pe overlay (după «Cu sprijinul NUME ·»)', v('overlay_line'), 'maxlength="90" placeholder="ex: periferice cu 10% reducere, codul ICEMAN10"')}
      ${area('sp_talk', 'Ce spune Iceman pe stream (doar moderatorii văd)', v('talking_points'), 600, 3)}
    </div>
    <h3 class="h3s">Rețele</h3>
    <div class="sp-grid">${SP_SOCIALS.map(([k, l]) => field(`sp_soc_${k}`, l, esc(x.socials?.[k] ?? ''), 'placeholder="https://…" inputmode="url"')).join('')}</div>
    <h3 class="h3s">Unde și când apare</h3>
    <div class="sp-grid">
      <div class="sp-f sp-wide">${check('sp_site', 'Pe site', x.show_site !== false)} ${check('sp_overlay', 'Pe overlay (linia partenerului)', x.show_overlay !== false)}</div>
      <label class="inline sp-f">De la (gol = imediat)<input class="field" type="datetime-local" id="sp_from" value="${toLocal(x.visible_from ?? null)}"></label>
      <label class="inline sp-f">Până la (gol = tot maratonul)<input class="field" type="datetime-local" id="sp_until" value="${toLocal(x.visible_until ?? null)}"></label>
    </div>
    <h3 class="h3s">Intern · doar moderatorii</h3>
    <div class="sp-grid">
      ${field('sp_contact_name', 'Persoană de contact', v('contact_name'), 'maxlength="80"')}
      ${field('sp_contact_email', 'Email', v('contact_email'), 'type="email" maxlength="120"')}
      ${field('sp_contact_phone', 'Telefon', v('contact_phone'), 'type="tel" maxlength="40"')}
      ${area('sp_notes', 'Ce am promis (ore duble, coduri, mențiuni…)', v('notes'), 1000, 3)}
    </div>
    <div class="row"><button class="btn-primary" data-act="spSave" data-id="${x.id ?? ''}">Salvează</button><button class="btn-ghost" data-act="spCancel">Anulează</button>${isNew ? '' : `<button class="btn-ghost btn-danger" data-act="spDelete" data-id="${x.id}">Șterge sponsorul</button>`}</div>
  </div>`;
}
// «Camera de control» background: Storage bucket 'scene' (moderators only), then mod_scene_set.
async function sceneUpload(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { say('Fotografia trebuie să fie JPG, PNG sau WEBP.', true); return; }
  if (file.size > 10 * 1024 * 1024) { say('Fotografia are peste 10 MB. Salveaz-o ca JPG de calitate 85.', true); return; }
  if (demoApi) {
    if (file.size > 1.5 * 1024 * 1024) { say('În demo, fotografia trebuie să aibă sub 1,5 MB.', true); return; }
    const url = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
    await call('mod_scene_set', { p_background: url }, 'Fotografia e pe scenă.');
    return;
  }
  const ext = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' } as Record<string, string>)[file.type];
  say('Se încarcă fotografia…');
  const path = `fundal-${Date.now()}.${ext}`;
  const { error } = await (db as any).storage.from('scene').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
  if (error) { say(`Fotografia nu s-a încărcat: ${error.message}`, true); return; }
  const url = (db as any).storage.from('scene').getPublicUrl(path).data.publicUrl;
  await call('mod_scene_set', { p_background: url }, 'Fotografia e pe scenă. Overlay-ul o arată în câteva secunde.');
}

// Logo upload: Storage bucket 'sponsors' (moderators only); the demo keeps a small data URL.
async function spUpload(file: File) {
  const okType = ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'].includes(file.type);
  if (!okType) { say('Logo-ul trebuie să fie SVG, PNG, WEBP sau JPG.', true); return; }
  if (file.size > 2 * 1024 * 1024) { say('Logo-ul are peste 2 MB. Încearcă un fișier mai mic (ideal SVG).', true); return; }
  let url: string;
  if (demoApi) {
    if (file.size > 400 * 1024) { say('În demo, logo-ul trebuie să aibă sub 400 KB.', true); return; }
    url = await new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
  } else {
    const ext = ({ 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg' } as Record<string, string>)[file.type];
    const slug = (val('sp_name') || 'sponsor').normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 40) || 'sponsor';
    const path = `${slug}-${Date.now()}.${ext}`;
    say('Se încarcă logo-ul…');
    const { error } = await (db as any).storage.from('sponsors').upload(path, file, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (error) { say(`Logo-ul nu s-a încărcat: ${error.message}`, true); return; }
    url = (db as any).storage.from('sponsors').getPublicUrl(path).data.publicUrl;
  }
  const input = document.getElementById('sp_logo') as HTMLInputElement | null;
  if (input) { input.value = url; input.dispatchEvent(new Event('input', { bubbles: true })); }
  const prev = document.getElementById('sp_prev');
  if (prev) prev.innerHTML = spLogo(url, val('sp_name'), true);
  say('Logo încărcat. Apasă «Salvează» ca să apară pe site.');
}
function spPayload(id: string) {
  const checked = (k: string) => (document.getElementById(k) as HTMLInputElement | null)?.checked ?? false;
  return {
    id: id || null, tier: val('sp_tier'), name: val('sp_name'), role: val('sp_role'), description: val('sp_desc'), logo: val('sp_logo'),
    url: val('sp_url'), cta: val('sp_cta'), code: val('sp_code'), codeNote: val('sp_code_note'), offerUntil: fromLocal(val('sp_offer_until')),
    utm: checked('sp_utm'), overlayLine: val('sp_overlay_line'), talkingPoints: val('sp_talk'),
    socials: Object.fromEntries(SP_SOCIALS.map(([k]) => [k, val(`sp_soc_${k}`)])),
    site: checked('sp_site'), overlay: checked('sp_overlay'), from: fromLocal(val('sp_from')), until: fromLocal(val('sp_until')),
    contactName: val('sp_contact_name'), contactEmail: val('sp_contact_email'), contactPhone: val('sp_contact_phone'), notes: val('sp_notes'),
  };
}

// ---- PREMII: one list of wins, raffles, and where viewers can win (owner, 25 Nov 2026) ----
const KIND_NAME: Record<string, string> = { roata: 'Roata', bingo: 'Bingo', tombola: 'Tombolă' };
const KIND_WHERE: Record<string, string> = { roata: 'Câștigat la roată', bingo: 'Câștigat la bingo', tombola: 'Câștigat la tombolă' };
const kindPill = (k: string) => `<span class="pill ${k === 'roata' ? 'ok' : k === 'bingo' ? 'white' : 'off'}">${KIND_NAME[k] ?? esc(k)}</span>`;
function dueRow(p: DueItem): string {
  return `<li>${kindPill(p.kind)}<span class="grow"><strong>${esc(p.login)}</strong> · ${esc(p.prize ?? '')}${p.sponsor ? ` <span class="muted">de la ${esc(p.sponsor)}</span>` : ''}<br><span class="muted">${KIND_WHERE[p.kind]} ${when(p.at)}</span></span>
    <button class="btn-primary" data-act="given" data-kind="${p.kind}" data-id="${p.id}">Dat</button></li>`;
}
const fmtHours = (h: number | null) => (h === null ? '' : String(h).replace('.', ','));
function ruleLabel(rule: string, h: number | null): string {
  const n = Number(h), de = Number.isInteger(n) && (n % 100 === 0 || n % 100 >= 20) ? 'de ' : '';
  return rule === 'subs' ? 'Abonații conectați pe site' : rule === 'hours' ? `Cine a privit cel puțin ${fmtHours(h)} ${n === 1 ? 'oră' : de + 'ore'}` : 'Toți cei conectați pe site cu Twitch';
}
const RAFFLE_HELP = 'Intrarea e mereu gratuită: lista se face singură după regula aleasă, spectatorii nu fac nimic. Donațiile nu dau șanse în plus.\nModeratorii și streamerul nu sunt pe listă.\n«Trage la sorți»: serverul alege câștigătorul, apoi sursa OBS «Tragerea la sorți» arată ruleta cu numele de pe listă. Câștigătorul vede «Ai câștigat» pe site și intră în PREMII → De dat.\nCine a câștigat o dată nu mai poate ieși la aceeași tombolă.';
function raffleRuleFields(prefix: string, rule: string, hours: number | null, locked: boolean): string {
  return `<label class="inline">Cine intră<select class="field" id="${prefix}Rule" data-raffle-rule="${prefix}"${locked ? ' disabled' : ''}>
      <option value="all"${rule === 'all' ? ' selected' : ''}>Toți cei conectați pe site cu Twitch</option>
      <option value="subs"${rule === 'subs' ? ' selected' : ''}>Doar abonații conectați pe site</option>
      <option value="hours"${rule === 'hours' ? ' selected' : ''}>Cine a privit cel puțin … ore</option></select></label>
    <label class="inline rf-hours"${rule === 'hours' ? '' : ' hidden'}>Ore privite (în total)<input class="field" type="number" inputmode="decimal" id="${prefix}Hours" data-raffle-rule="${prefix}" min="0.5" max="2000" step="0.5" value="${esc(hours ?? 5)}"${locked ? ' disabled' : ''}></label>`;
}
function tombolaHtml(): string {
  const P = S.rafflePreview;
  const form = `<div class="fgrid">
      <label class="inline" style="flex:1 1 260px">Premiul<input class="field" id="rfPrize" maxlength="120" placeholder="ex: Căști de gaming"></label>
      <label class="inline" style="flex:1 1 200px">Premiul e de la<input class="field" id="rfSponsor" list="sponsorNames" maxlength="60" placeholder="sponsor (opțional)"></label>
      ${raffleRuleFields('rf', 'all', 5, false)}
      <button class="btn-primary" data-act="raffleAdd">Adaugă tombola</button>
    </div>
    <p class="hint" id="rfCount">${P && P.key.startsWith('rf:') && P.n !== null ? `Pe listă acum: <strong>${fmtInt(P.n)}</strong>` : 'Pe listă acum: se numără…'}</p>`;
  const rows = S.raffles.map((r) => {
    const drawn = r.draws.length > 0;
    const last = r.draws[r.draws.length - 1];
    return `<li class="rf-item" style="display:block">
      <div class="fgrid">
        <label class="inline" style="flex:1 1 260px">Premiul<input class="field" id="rf${r.id}Prize" maxlength="120" value="${esc(r.prize)}"></label>
        <label class="inline" style="flex:1 1 200px">Premiul e de la<input class="field" id="rf${r.id}Sponsor" list="sponsorNames" maxlength="60" value="${esc(r.sponsor ?? '')}" placeholder="sponsor (opțional)"></label>
        ${raffleRuleFields(`rf${r.id}`, r.rule, r.min_hours, drawn)}
        <button class="btn-ghost" data-act="raffleSave" data-id="${r.id}">Salvează</button>
      </div>
      <p class="hint" style="margin:8px 0 0">${esc(ruleLabel(r.rule, r.min_hours))} · pe listă acum <strong>${fmtInt(r.pool)}</strong>${drawn ? ' care n-au câștigat încă' : ''}${r.created_by ? ` · adăugată de ${esc(r.created_by)}` : ''}${drawn ? ' · regula nu se mai schimbă după prima tragere' : ''}</p>
      ${drawn ? `<p style="margin:10px 0 0">Câștigători: ${r.draws.map((d) => `<strong>${esc(d.login)}</strong> <span class="muted">(${when(d.drawn_at)}${d.given_at ? ', dat' : ''})</span>`).join(' · ')}</p>` : ''}
      <div class="row">
        <button class="btn-primary" data-act="raffleDraw" data-id="${r.id}"${r.pool ? '' : ' disabled'}>${drawn ? 'Trage încă un câștigător' : 'Trage la sorți'}</button>
        ${last ? `<button class="btn-ghost" data-act="raffleReplay" data-id="${last.id}">Arată din nou pe stream</button>` : `<button class="btn-ghost btn-danger" data-act="raffleDel" data-id="${r.id}">Șterge</button>`}
      </div></li>`;
  }).join('');
  return `<section class="card wide" id="tombola">
    <h2>Tombole ${tip(RAFFLE_HELP)}</h2>
    <p class="lead">Un premiu, cine intră pe listă, apoi «Trage la sorți» pe stream.</p>
    <h3 class="h3s">Tombolă nouă</h3>
    ${form}
    <h3 class="h3s">Tombolele (${S.raffles.length})</h3>
    ${rows ? `<ul class="list">${rows}</ul>` : '<p class="empty">Nicio tombolă încă.</p>'}
  </section>`;
}
function undeHtml(): string {
  const arrow = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  const panel = (title: string, href: string, how: string, body: string) => `<div class="panel">
      <div class="card-head" style="margin:0 0 8px"><strong style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-style:italic;font-size:24px;line-height:1;text-transform:uppercase">${title}</strong><a class="btn btn-link" href="#${href}">Setează${arrow}</a></div>
      <p class="muted" style="margin:0 0 10px">${how}</p>${body}</div>`;
  const wins = S.wheel.filter((p) => p.is_win);
  const wheel = wins.length ? `<ul class="list">${wins.map((p) => `<li><span class="grow">${esc(p.full_label)}${p.sponsor ? ` <span class="muted">de la ${esc(p.sponsor)}</span>` : ''}</span><span class="muted">șansa ${esc(p.weight)}</span></li>`).join('')}</ul>` : '<p class="empty">Nicio felie cu premiu.</p>';
  const B = S.bingo;
  const bprize = B?.prize && !B.prize.startsWith('[') ? B.prize : '';
  const bingo = bprize ? `<p style="margin:0"><strong>${esc(bprize)}</strong>${B?.prize_sponsor ? ` <span class="muted">de la ${esc(B.prize_sponsor)}</span>` : ''}</p>` : '<p class="callout bad" style="margin:0">Premiul de bingo nu e scris încă.</p>';
  const raffles = S.raffles.length ? `<ul class="list">${S.raffles.map((r) => `<li><span class="grow">${esc(r.prize)}${r.sponsor ? ` <span class="muted">de la ${esc(r.sponsor)}</span>` : ''}<br><span class="muted">${esc(ruleLabel(r.rule, r.min_hours))}</span></span>${r.draws.length ? `<span class="pill ok">${r.draws.length === 1 ? 'tras' : `${r.draws.length} trageri`}</span>` : '<span class="pill off">netras</span>'}</li>`).join('')}</ul>` : '<p class="empty">Nicio tombolă încă.</p>';
  return `<section class="card wide" id="unde">
    <h2>Unde se câștigă ${tip('Tot ce pot câștiga spectatorii, din ce ați scris voi. «Setează» duce la pagina fiecăruia.\nCâștigătorii de peste tot ajung în PREMII → De dat.')}</h2>
    <div class="panels">
      ${panel('Roata', 'roata-premii', 'Abonații: o rotire pe zi după 2 ore privite, plus rotiri din codurile secrete.', wheel)}
      ${panel('Bingo', 'bingo', 'Cine are toată linia bifată intră la tragerea la sorți.', bingo)}
      ${panel('Tombole', 'tombola', 'Lista se face singură după regula fiecărei tombole. Intrarea e gratuită.', raffles)}
      ${panel('Coduri secrete', 'rapid', 'Un cod arătat pe stream dă o rotire în plus la roată celor care îl scriu la timp.', `<p style="margin:0" class="muted">${S.codes.length ? `${S.codes.length} ${S.codes.length === 1 ? 'cod arătat' : 'coduri arătate'} până acum.` : 'Niciun cod arătat încă.'}</p>`)}
    </div>
  </section>`;
}

/** «De făcut acum»: what needs a moderator, from data /mod already has. */
function todoHtml(): string {
  const raised = Number(S.stats?.raised ?? 0);
  const items: { tag: string; cls: string; t: string; d: string; btn: string }[] = [];
  if (S.status && !S.status.broadcaster_connected) items.push({ tag: 'STREAMER', cls: 'bad', t: 'Contul de streamer nu e conectat', d: 'Fără el nu ajung subs, biții și statusul live.', btn: `<a class="btn btn-twitch" href="${esc(S.status.connect_url ?? '#')}">Conectează</a>` });
  // Euros only (B-09): a donation in another currency added nothing; a moderator decides.
  for (const d of (S.health?.skipped ?? []) as { id: string; user: string; amount: number; currency: string; at: string }[]) {
    items.push({ tag: 'DONAȚIE', cls: 'warn', t: `${d.user} · ${d.amount} ${d.currency}`, d: `Nu e în euro: nu a adăugat timp (${when(d.at)}). Adăugați minutele de mână, dacă vreți.`, btn: `<button class="btn-ghost" data-act="skipDone" data-id="${esc(d.id)}">Am rezolvat</button>` });
  }
  const due = S.due.due;
  for (const p of due.slice(0, 3)) items.push({ tag: 'PREMIU', cls: 'ok', t: `${p.login} · ${p.prize ?? ''}`, d: `${KIND_WHERE[p.kind]} ${when(p.at)}`, btn: `<button class="btn-primary" data-act="given" data-kind="${p.kind}" data-id="${p.id}">Am dat premiul</button>` });
  if (due.length > 3) items.push({ tag: 'PREMII', cls: 'ok', t: `Încă ${due.length - 3} premii de dat`, d: '', btn: '<a class="btn btn-ghost" href="#premii">Vezi toate</a>' });
  for (const c of S.scheduled) items.push({ tag: 'PROVOCARE', cls: 'white', t: c.title, d: `A câștigat votul${c.scheduled_for ? ` · ${c.scheduled_for}` : ''}. După ce o face streamerul: linkul clipului și «Făcută».`, btn: '<a class="btn btn-ghost" href="#provocari">Marchează făcută</a>' });
  S.goals.forEach((g, i) => { if (raised >= g.threshold && !g.done_at) items.push({ tag: 'MILESTONE', cls: 'white', t: `${pad(i + 1)} · ${g.title}`, d: 'Deblocat. Când s-a făcut live, pune linkul clipului.', btn: '<a class="btn btn-ghost" href="#milestones">Marchează făcut</a>' }); });
  const lg = lineGroups.filter((g) => !lineInfo(g.id).ok).length;
  if (lg) items.push({ tag: 'REPLICI', cls: 'warn', t: `${lg} ${lg === 1 ? 'grup are' : 'grupuri au'} sub ${MIN_LINES} replici`, d: `Balonul folosește «${FALLBACK_LINE}» până le completați.`, btn: '<a class="btn btn-ghost" href="#replici">Completează</a>' });
  if (S.suggestions.length) items.push({ tag: 'PROPUNERI', cls: 'off', t: `${S.suggestions.length} ${S.suggestions.length === 1 ? 'propunere nouă' : 'propuneri noi'} de la abonați`, d: '', btn: '<a class="btn btn-ghost" href="#vot">Vezi propunerile</a>' });
  const bw = S.bingo?.status.winners.length ?? 0;
  if (bw && !S.bingo?.status.draws.length) items.push({ tag: 'BINGO', cls: 'ok', t: `${bw} cu bingo, gata de tragere`, d: '', btn: '<a class="btn btn-ghost" href="#bingo">Trage la sorți</a>' });
  return `<section class="card flush" id="todo"><h2>De făcut acum${items.length ? ` · ${items.length}` : ''}</h2>
    ${items.length ? items.map((x) => `<div class="ib"><span class="pill ${x.cls} ib-tag">${x.tag}</span><span class="ib-t"><b>${esc(x.t)}</b>${x.d ? `<small>${esc(x.d)}</small>` : ''}</span><span class="ib-a">${x.btn}</span></div>`).join('') : '<p class="muted flush-p">Nimic nu așteaptă acum.</p>'}
  </section>`;
}


// ---- Milestones: state, when, clip ----
function milestonesHtml(): string {
  const raised = Number(S.stats?.raised ?? 0);
  const rows = goalRows();
  let nextFound = false;
  return `<section class="card wide" id="milestones">
    <div class="card-head"><h2>Milestone Maraton ${tip('Se deblochează când suma strânsă în euro ajunge la prag.\nApăsați «Marchează făcut» și puneți linkul clipului: clipul apare pe site.')}</h2><span class="head-stat">Strâns acum <strong>${fmtInt(raised)} €</strong></span></div>
    <div class="ms-headrow" aria-hidden="true"><span>NR.</span><span>SUMA (€)</span><span>PROVOCAREA</span><span>PREZENTAT DE</span><span>STARE</span><span>CÂND SE FACE</span><span>CLIPUL (DUPĂ LIVE)</span><span></span><span></span></div>
    <ul class="list ms-list">${rows.map((g, i) => {
      const reached = g.threshold !== '' && raised >= Number(g.threshold);
      const isNext = !reached && !nextFound && g.threshold !== '';
      if (isNext) nextFound = true;
      const state = g.done ? ['FĂCUT ✓', 'ok'] : reached ? ['DEBLOCAT', 'white'] : isNext ? ['URMĂTORUL', 'next'] : ['BLOCAT', 'off'];
      return `<li class="${reached && !g.done ? 'pending' : ''}">
        <span class="ms-no">${pad(i + 1)}</span>
        <input class="field" type="number" inputmode="numeric" min="1" step="1" data-goal-amt="${i}" value="${esc(g.threshold)}" placeholder="€" aria-label="Suma în euro, milestone ${i + 1}">
        <input class="field" data-goal-title="${i}" value="${esc(g.title)}" placeholder="Provocarea" aria-label="Provocarea ${i + 1}" maxlength="140">
        <input class="field" data-goal-sponsor="${i}" value="${esc(g.sponsor)}" list="sponsorNames" placeholder="opțional" aria-label="Sponsorul milestone-ului ${i + 1}" maxlength="60">
        <span><span class="pill ${state[1]}">${state[0]}</span></span>
        ${reached ? `<input class="field" data-goal-when="${i}" value="${esc(g.when)}" placeholder="ex: vineri seara" aria-label="Când se face milestone-ul ${i + 1}" maxlength="60">
        <input class="field" type="url" data-goal-clip="${i}" value="${esc(g.clip)}" placeholder="https://clips.twitch.tv/…" aria-label="Linkul clipului, milestone ${i + 1}">
        <button class="${g.done ? 'btn-primary' : 'btn-ghost'}" data-act="goalDone" data-i="${i}" aria-pressed="${g.done}">${g.done ? 'Făcut ✓' : 'Marchează făcut'}</button>` : '<span class="ms-na">—</span><span class="ms-na">—</span><span></span>'}
        <button class="btn-ghost" data-act="goalDel" data-i="${i}" aria-label="Șterge milestone-ul ${i + 1}">Șterge</button></li>`;
    }).join('')}</ul>
    <div class="row">
      <button class="btn-ghost" data-act="goalAdd">Adaugă milestone</button>
      <button class="btn-primary" data-act="goalSave">Salvează lista</button>
      ${S.goalsDraft ? '<button class="btn-ghost" data-act="goalCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}
    </div>
  </section>`;
}

// ---- Overlay OBS ----
function overlayHtml(): string {
  const base = location.origin + '/overlay/';
  const key = S.overlayKey;
  const control = base + '?scene=control';
  const piece = (id: string, withKey: boolean) => base + '?' + [withKey && key ? `key=${key}` : '', `part=${id}`].filter(Boolean).join('&');
  const pieces = `<section class="card wide" id="overlay-piese">
    <h2>Piesele overlay-ului, una câte una ${tip('Fiecare piesă e un Browser Source separat în OBS, la mărimea scrisă (pentru canvas 2K, 2560×1440; în paranteză, pentru 1920×1080). Piesa se potrivește singură mărimii sursei.\nO așezi unde vrei în scena fiecărui joc; în alte scene: «Add Existing».\nButonul «De așezat» arată piesa conturată, cu date de exemplu.\nOpțional, adăugați la finalul linkului «&scale=1.2» ca piesa să fie mai mare, sau «&calm=1» ca să meargă fără ninsoare și animații.\nCa să le vedeți în acțiune: «SETĂRI → Mod test».')}</h2>
    <ul class="list">${overlayPieces.map((x, i) => `<li style="align-items:flex-start"><span class="grow"><strong>${esc(x.label)}</strong> <span class="pill off">${Math.round(x.w * 4 / 3)} × ${Math.round(x.h * 4 / 3)}</span> <span class="muted">(${x.w} × ${x.h})</span>${x.key ? ' <span class="pill warn">cheie privată</span>' : ''}<br><span class="muted">${esc(x.what)}</span>
      <input class="field" readonly value="${esc(piece(x.id, !!x.key))}" id="ovp${i}" aria-label="Linkul pentru ${esc(x.label)}" style="width:100%;margin-top:6px"></span>
      <span class="pair" style="flex-direction:column;align-items:stretch"><button class="btn-ghost" data-act="copyOvp" data-i="${i}">Copiază</button><a class="btn btn-ghost" href="${esc(base + '?demo&frame=1&part=' + x.id)}" target="_blank" rel="noopener">De așezat</a></span></li>`).join('')}</ul>
  </section>`;
  const bg = S.sceneBg;
  return pieces + `<section class="card wide" id="overlay">
    <h2>Overlay OBS: scena întreagă ${tip('«Camera de control»: un singur Browser Source 2560×1440 (2K), deasupra jocului și a camerei. Merge și la 1920×1080: se potrivește singură.')}</h2>
    <ul class="list"><li><span class="grow"><strong>Camera de control</strong> <span class="pill off">2560 × 1440</span> ${tip('În OBS (2K), sub acest source: jocul 1536×864 la x 77, y 72 și camera 691×388 la x 1767, y 72.\nLa 1920×1080: jocul 1152×648 la x 58, y 54, camera 518×291 la x 1325, y 54.\nAdăugați «&frame=1» la finalul linkului ca să vedeți locurile, cu mărimile.')}
      <input class="field" readonly value="${esc(control)}" id="ov0" aria-label="Linkul scenei Camera de control" style="width:100%;margin-top:6px"></span><button class="btn-ghost" data-act="copyOv" data-i="0">Copiază</button></li></ul>
    <h3 class="h3s">Fotografia de fundal ${tip('Overlay-ul o desenează singur, cu locurile jocului și camerei decupate. Nu o mai pune separat în OBS.\nJPG, PNG sau WEBP, cel mult 10 MB, ideal 2560×1440 sau 3840×2160.')}</h3>
    ${bg ? `<p style="margin:10px 0 0"><img class="scene-img" src="${esc(bg)}" alt="Fotografia de fundal"></p>` : '<p class="empty">Nicio fotografie: scena rămâne transparentă.</p>'}
    <div class="row"><label class="btn btn-primary">${bg ? 'Schimbă fotografia' : 'Încarcă fotografia'}<input type="file" id="scene_file" accept="image/jpeg,image/png,image/webp" hidden></label>${bg ? '<button class="btn-ghost" data-act="sceneClear">Scoate fotografia</button>' : ''}</div>
  </section>`;
}

/** Values the moderator changed in this page's own fields (by id), not yet sent. */
function typedValues(): Map<string, string> {
  const out = new Map<string, string>();
  app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[id], textarea[id], select[id]').forEach((el) => {
    if ((el as HTMLInputElement).readOnly) return;
    // Switches with an id (pilot automat) are kept too; checklist boxes have no id and save at once.
    if ((el as HTMLInputElement).type === 'checkbox') {
      const c = el as HTMLInputElement;
      if (c.checked !== c.defaultChecked) out.set(el.id, c.checked ? '\u0001on' : '\u0001off');
      return;
    }
    const dirty = el instanceof HTMLSelectElement ? selectChanged(el) : el.value !== el.defaultValue;
    if (dirty) out.set(el.id, el.value);
  });
  return out;
}
/** Set after an action succeeded: the next render starts the forms afresh. */
let resetTyped = false;

// ---- M3: unsaved changes. A card is «NESALVAT» while it holds a list draft or a field
// whose value differs from what was loaded; leaving the page then asks first. ----
const draftCards = (): Record<string, unknown> => ({ replici: S.linesDraft, milestones: S.goalsDraft, bingo: S.bingoDraft, 'roata-premii': S.wheelDraft });
function fieldChanged(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if ((el as HTMLInputElement).readOnly || el.disabled || el.closest('dialog')) return false;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return false;
  return el instanceof HTMLSelectElement ? selectChanged(el) : el.value !== el.defaultValue;
}
/** A list with no option marked «selected» starts on its first one: that isn't a change. */
function selectChanged(el: HTMLSelectElement): boolean {
  const start = Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
  return el.selectedIndex !== start;
}
function markUnsaved() {
  const drafts = draftCards();
  app.querySelectorAll<HTMLElement>('section.card[id]').forEach((card) => {
    const on = !!drafts[card.id] || [...card.querySelectorAll<HTMLInputElement>('input, textarea, select')].some(fieldChanged);
    card.classList.toggle('dirty', on);
    const h = card.querySelector('h2');
    const tag = h?.querySelector('.unsaved');
    if (on && h && !tag) h.insertAdjacentHTML('beforeend', ' <span class="pill unsaved">Nesalvat</span>');
    else if (!on) tag?.remove();
  });
}
app.addEventListener('input', markUnsaved);
app.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id !== 'extendTo') return;
  const p = document.getElementById('extendPrev');
  if (p) p.textContent = extendPreview(S.timer ?? {}, t.value);
});
// Narrow windows: the menu groups and the item chips are rows that scroll sideways; a mouse wheel
// only scrolls up and down, so turn it sideways there (trackpads and touch already work).
const sideways = (e: WheelEvent) => {
  const row = (e.target as Element).closest<HTMLElement>('.mnav, .subnav');
  if (!row || Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth + 1) return;
  if (getComputedStyle(row).flexDirection !== 'row') return;
  const before = row.scrollLeft;
  row.scrollLeft += e.deltaY;
  if (row.scrollLeft !== before) e.preventDefault();
};
nav.addEventListener('wheel', sideways, { passive: false });
app.addEventListener('wheel', sideways, { passive: false });
app.addEventListener('change', markUnsaved);
app.addEventListener('change', (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.id !== 'bingoSizeSel') return;
  if (!resizeBingo(Number(t.value))) { t.value = String(bingoN()); return; }
  t.blur();   // the page waits for a focused field; the new card should show at once
  render();
});
// Tombole: the hours field shows only for «Cine a privit…»; the new-raffle form counts its list as you pick.
let rfTimer = 0;
async function raffleCount() {
  const rule = val('rfRule');
  if (!rule) return;
  const hours = rule === 'hours' ? Number(val('rfHours')) || null : null;
  const key = `rf:${rule}:${hours ?? ''}`;
  const out = () => { const el = document.getElementById('rfCount'); if (el && S.rafflePreview?.key === key) el.innerHTML = S.rafflePreview.n === null ? 'Pe listă acum: —' : `Pe listă acum: <strong>${fmtInt(S.rafflePreview.n)}</strong>`; };
  if (S.rafflePreview?.key === key) return out();
  S.rafflePreview = { key, n: null };
  try {
    const n = demoApi ? demoApi.rpc('mod_raffle_count', { p_rule: rule, p_min_hours: hours }) : (await (db as any).rpc('mod_raffle_count', { p_rule: rule, p_min_hours: hours })).data;
    if (S.rafflePreview?.key === key) S.rafflePreview.n = typeof n === 'number' ? n : null;
  } catch { /* stays «—» */ }
  out();
}
function raffleRuleChanged(t: HTMLElement) {
  const prefix = t.dataset.raffleRule!;
  const hrs = document.getElementById(`${prefix}Hours`)?.closest('label');
  if (hrs) hrs.hidden = val(`${prefix}Rule`) !== 'hours';
  if (prefix === 'rf') { clearTimeout(rfTimer); rfTimer = window.setTimeout(() => void raffleCount(), 250); }
}
app.addEventListener('change', (e) => { const t = e.target as HTMLElement; if (t.dataset?.raffleRule) raffleRuleChanged(t); });
app.addEventListener('input', (e) => { const t = e.target as HTMLElement; if (t.dataset?.raffleRule) raffleRuleChanged(t); });
app.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'sp_file' && t.files?.[0]) void spUpload(t.files[0]).finally(() => { t.value = ''; }); });
app.addEventListener('change', (e) => { const t = e.target as HTMLInputElement; if (t.id === 'scene_file' && t.files?.[0]) void sceneUpload(t.files[0]).catch(() => {}).finally(() => { t.value = ''; }); });
window.addEventListener('beforeunload', (e) => {
  if (!app.querySelector('.card.dirty') && !Object.values(draftCards()).some(Boolean)) return;
  e.preventDefault();
  e.returnValue = '';
});

function render() {
  const active = document.activeElement;
  if (active && app.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) { deferred = true; return; }
  const isMod = !!S.me?.is_moderator;
  if (shownView === S.view) { app.classList.remove('pg-in'); clearTimeout(enterTimer); }   // same page redrawn: no entrance again
  nav.hidden = !isMod;
  bar.innerHTML = barHtml();
  if (!S.me) {
    app.innerHTML = `<div class="card" style="margin-top:20px"><h2>Conectează-te</h2>
      <p>Pagina e pentru moderatorii ICEMARATON. Intră cu contul de Twitch.</p>
      ${site.supabase.twitchLogin
        ? '<button class="btn-twitch" data-act="login">Conectează-te cu Twitch</button>'
        : '<p class="muted">Conectarea cu Twitch nu e activată încă (twitchLogin în src/data/site.ts).</p>'}</div>`;
    return;
  }
  if (!S.me.is_moderator) {
    app.innerHTML = `<div class="card" style="margin-top:20px"><h2>Fără acces</h2><p>Contul <strong>${esc(S.me.login)}</strong> nu e moderator. Roagă un moderator să te adauge.</p></div>`;
    return;
  }

  const t = S.timer ?? {};
  const now = Date.now();
  const live = t.status === 'live';
  const remaining = live && t.ends_at ? Date.parse(t.ends_at) - (t.paused_until && Date.parse(t.paused_until) > now ? Date.parse(t.paused_until) : now) : 0;
  const st = S.status;
  const roundOpen = S.round && Date.parse(S.round.closes_at) > now;
  const totalVotes = S.round?.items.reduce((a, x) => a + x.votes, 0) ?? 0;
  const poolOptions = (sel: number, level?: string) => S.pool.filter((c) => !level || c.level === level || c.id === sel).map((c) =>
    `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.level)} · ${esc(c.title)}</option>`).join('');

  setNav();
  const sec: Record<string, () => string> = {
    'pilot': () => {
      const A = S.auto ?? {};
      return `
    <section class="card wide" id="pilot">
      <h2>Votul automat</h2>
      <div class="opt-row"><label class="opt"><input type="checkbox" class="sw" id="apVoteOn" ${A.voteOn ? 'checked' : ''}><span class="opt-t">O rundă de vot pe zi, deschisă singură</span></label>${tip('Se deschide singură când streamerul e live după ora aleasă, cu 5 provocări din nivelul ales, și ține cât ați ales (de obicei 24 de ore). Voi doar dați veto.\nDacă nu mai sunt 5 provocări libere din nivelul ales, runda nu se deschide și vine mesaj pe Discord.')}</div>
      <div class="row">
        <label class="inline">După ora (România)<input class="field" type="time" id="apVoteAt" value="${esc(A.voteAt ?? '20:00')}"></label>
        <label class="inline">Nivelul<select class="field" id="apVoteLevel">${LEVELS.map(([k, l]) => `<option value="${k}"${(A.voteLevel ?? 'mediu') === k ? ' selected' : ''}>${l} (${S.pool.filter((c) => c.level === k).length} libere)</option>`).join('')}</select></label>
        <label class="inline">Cât durează (ore)<input class="field" type="number" inputmode="numeric" id="apVoteHours" min="1" max="48" value="${esc(Math.round((A.voteMinutes ?? 1440) / 60))}"></label>
      </div>
      ${A.lastVoteDay ? `<p class="hint">Ultima rundă automată: ${esc(A.lastVoteDay)}.</p>` : ''}
      <div class="row"><button class="btn-primary" data-act="autoSave">Salvează</button>${A.updatedBy ? `<span class="hint">Ultima schimbare: ${esc(A.updatedBy)}, ${when(A.updatedAt)}</span>` : ''}</div>
    </section>`;
    },
    'plan': () => {
      const list = (S.auto?.plan ?? []) as any[];
      const todo = list.filter((x) => !x.done), past = list.filter((x) => x.done);
      const res = (r: string) => (r === 'done' ? '<span class="pill ok">făcut</span>' : r === 'missed' ? '<span class="pill warn">ratat</span>' : `<span class="pill bad">${esc(r)}</span>`);
      return `
    <section class="card wide" id="plan">
      <h2>Programate ${tip('Ora dublă, codurile secrete și înghețurile pornesc singure la ora lor, cât timp cronometrul merge.')}</h2>
      <div class="fgrid plan-form">
        <label class="inline">Ce<select class="field" id="planKind"><option value="double" selected>Ora dublă</option><option value="code">Cod secret</option><option value="freeze">Îngheț</option></select></label>
        <label class="inline">Când<input class="field" type="datetime-local" id="planAt"></label>
        <label class="inline pf-min">Minute<input class="field" type="number" inputmode="numeric" id="planMin" value="60" min="1" max="720"></label>
        <label class="inline pf-until">Până la<input class="field" type="datetime-local" id="planUntil"></label>
        <label class="inline pf-sp">Oferit de<input class="field" id="planSponsor" list="sponsorNames" maxlength="60" placeholder="sponsor (opțional)"></label>
        <button class="btn-primary" data-act="planAdd">Programează</button>
      </div>
      <h3 class="h3s">Programate (${todo.length})</h3>
      ${todo.length ? `<ul class="list">${todo.map((x) => `<li><span class="grow">${planLine(x)}<br><span class="muted">pus de ${esc(x.by ?? '')}</span></span><button class="btn-ghost" data-act="planDel" data-id="${x.id}">Șterge</button></li>`).join('')}</ul>` : '<p class="empty">Nimic programat.</p>'}
      ${past.length ? `<h3 class="h3s">Ultimele 2 zile</h3><ul class="list">${past.map((x) => `<li><span class="grow">${planLine(x)}</span>${res(x.result)}</li>`).join('')}</ul>` : ''}
    </section>`;
    },
    'alerte': () => `
    <section class="card wide" id="alerte">
      <h2>Alerte în Discord ${tip('Site-ul vă scrie pe Discord când ceva cere un om.\nLinkul: Discord → Setările serverului → Integrări → Webhook-uri → Webhook nou → Copiază URL-ul. Rămâne privat.')}</h2>
      <p style="margin:0">${S.auto?.hasWebhook ? '<span class="pill ok">Pornite</span> Webhook-ul e salvat (nu se mai afișează).' : '<span class="pill off">Oprite</span>'}</p>
      <div class="row">
        <input class="field" type="password" id="hookUrl" autocomplete="off" placeholder="https://discord.com/api/webhooks/…" aria-label="Linkul webhook-ului de Discord" style="flex:1 1 320px;min-width:0">
        <button class="btn-primary" data-act="hookSave">Salvează</button>
        ${S.auto?.hasWebhook ? '<button class="btn-ghost" data-act="hookTest">Trimite un test</button><button class="btn-ghost" data-act="hookClear">Oprește alertele</button>' : ''}
      </div>
    </section>`,
    'checklist': () => {
      const done = CHECK.filter((c) => checkState(c).done).length;
      return `
    <section class="card wide" id="checklist">
      <div class="card-head"><h2>Checklist de pregătire ${tip('Bifele se văd la toți moderatorii. Cele marcate «automat» se bifează singure când sunt gata.')}</h2><span class="head-stat"><strong>${done} din ${CHECK.length}</strong> gata</span></div>
      <div class="kbar head-bar"><span style="width:${Math.round((done / Math.max(1, CHECK.length)) * 100)}%"></span></div>
      <ul class="list">${CHECK.map((c) => {
        const st = checkState(c);
        return `<li><label style="display:flex;align-items:center;gap:12px;min-height:44px;flex:1 1 auto">${st.auto
          ? '<span class="ck-mark"><span class="pill ok">automat</span></span>'
          : `<span class="ck-mark"><input type="checkbox" data-act="check" data-key="${c.key}" ${st.done ? 'checked' : ''}></span>`}
          <span class="grow"${st.done ? ' style="color:#8C97A8"' : ''}>${esc(c.label)}${st.by ? `<br><span class="muted">bifat de ${esc(st.by)}, ${when(st.at ?? null)}</span>` : ''}</span></label>
          ${c.card ? `<a class="btn btn-link" href="#${c.card}">Deschide<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg></a>` : ''}</li>`;
      }).join('')}</ul>
    </section>`;
    },
    'streamer': () => `
    <section class="card wide" id="streamer">
      <h2>Contul de streamer ${tip('O dată, înainte de start: streamerul apasă butonul și aprobă tot. Fără el nu ajung subs, biții și statusul live, nu se fac clipurile și replicile nu ajung în chat.')}</h2>
      <div class="row" style="margin-top:0">
        <span class="pill ${st?.broadcaster_connected ? 'ok' : 'bad'}">Streamer ${st?.broadcaster_connected ? 'conectat' : 'neconectat'}</span>
        <a class="btn btn-${st?.broadcaster_connected ? 'ghost' : 'twitch'}" href="${esc(st?.connect_url ?? '#')}">${st?.broadcaster_connected ? 'Reconectează' : 'Conectează'} contul de streamer</a>
        <span class="muted">doar ${esc(st?.broadcaster_login ?? 'streamerul')}</span>
      </div>
    </section>`,
    'cronometru': () => {
      const A = S.auto ?? {};
      const ice = isStreamer();
      if (live || t.status === 'ended') return `
    <section class="card wide" id="cronometru">
      <h2>Pornirea</h2>
      <p class="lead" style="margin:0">Pornit la <strong>${when(t.starts_at)}</strong> · final programat <strong>${when(t.scheduled_end)}</strong>.</p>
      ${live ? '<div class="row"><a class="btn btn-ghost" href="#prelungire">Prelungește</a><a class="btn btn-ghost btn-danger" href="#zona">Încheiere</a></div>' : ''}
    </section>`;
      return `
    <section class="card wide" id="cronometru">
      <h2>Pornirea ${tip('Startul și finalul programat le pot schimba și moderatorii, cât pornirea automată e oprită. Pornirea automată, mutarea startului cât ea e pornită și «Pornește acum» sunt doar ale streamerului.')}</h2>
      <h3 class="h3s" style="margin-top:0">Când</h3>
      <div class="fgrid">
        <label class="inline">Start<input class="field" type="datetime-local" id="startAt" value="${toLocal(t.starts_at)}"${A.autoStart && !ice ? ' disabled title="Pornire automată: doar streamerul mută startul"' : ''}></label>
        <label class="inline">Final programat<input class="field" type="datetime-local" id="endAt" value="${toLocal(t.scheduled_end)}"></label>
        <button class="btn-ghost" data-act="schedule">Salvează datele</button>
      </div>
      <h3 class="h3s">Cum pornește</h3>
      <div class="opt-row"><label class="opt"><input type="checkbox" class="sw" id="apAutoStart" ${A.autoStart ? 'checked' : ''}${ice ? '' : ' disabled'}><span class="opt-t">Cronometrul pornește singur la ora de start (${when(t.starts_at)})</span></label>${tip('Pornit: la ora de start cronometrul pornește singur cu orele de mai jos, iar mutarea startului rămâne doar a streamerului.\nOprit: streamerul apasă «Pornește acum».')}</div>
      <div class="fgrid" style="margin-top:12px">
        <label class="inline">Ore pe cronometru la start<input class="field" type="number" id="startHours" value="${esc(A.startHours ?? 24)}" step="0.5" min="0.5"${ice ? '' : ' disabled'}></label>
        <button class="btn-ghost" data-act="startSave"${ice ? '' : ' disabled'}>Salvează pornirea</button>
      </div>
      <h3 class="h3s">Acum, de mână</h3>
      <div class="row" style="margin-top:0">${ice ? '<button class="btn-primary" data-act="start">Pornește acum</button>' : '<button class="btn-primary" disabled>Pornește acum</button>'}</div>
      ${ice ? '' : `<p class="hint">${onlyStreamer()}</p>`}
    </section>`;
    },
    'prelungire': () => `
    <section class="card wide" id="prelungire">
      <h2>Prelungește ${tip(EXTEND_HELP)}</h2>
      ${live ? extendHtml(t)
        : `<p class="empty">${t.status === 'ended' ? 'Maratonul s-a încheiat: nu se mai poate prelungi.' : 'Merge după ce pornește cronometrul.'}</p>`}
    </section>`,
    // M2: ending is irreversible, so it lives apart from the time buttons and asks for a typed word.
    'sponsori': () => sponsorsHtml(),
    'test': () => testCardHtml(),
    'sarcini': () => tasksHtml(),
    'zona': () => `
    <section class="card wide danger" id="zona">
      <h2>Încheiere</h2>
      ${live
        ? `<p style="margin:0">Oprește cronometrul pentru totdeauna. Nu se poate anula.</p>
           <div class="row">${isStreamer() ? '<button class="btn-ghost btn-danger" data-act="end">Încheie subathonul…</button>' : `<button class="btn-ghost btn-danger" disabled>Încheie subathonul…</button>${onlyStreamer()}`}</div>`
        : `<p class="empty">Butonul de încheiere apare aici doar cât timp cronometrul merge.</p>`}
    </section>`,
    'replici': () => `
    ${linesHtml()}`,
    'bingo': () => `
    ${S.bingo ? (() => {
      const B = S.bingo!;
      const open = bingoPicksOpen();
      const happened = (id?: number) => !!B.items.find((i) => i.id === id)?.happened_at;
      return `<section class="card wide" id="bingo">
      <h2>Bingo</h2>
      ${bingoNowHtml()}
      <h3 class="h3s">Cartonașul · ${open ? 'bifele vin după închidere' : 'bifează când se întâmplă'} ${tip('Scrieți voi evenimentele, în ordine, rând cu rând. Alegeți mărimea: 3 × 3 (9 evenimente), 4 × 4 (16) sau 5 × 5 (25). Spectatorii aleg o linie: un rând, o coloană sau o diagonală.\nDupă ce a ales cineva o linie, evenimentele se mai pot doar redenumi: nu se mai mută, nu se scot și mărimea rămâne.')}</h3>
      ${(() => {
        const n = bingoN(), rows = bingoRows(), locked = (B.status.players ?? 0) > 0;
        const empty = rows.filter((r) => !r.label.trim()).length;
        return `<div class="fgrid bingo-size">
          <label class="inline">Mărimea cartonașului<select class="field" id="bingoSizeSel"${locked ? ' disabled' : ''}>${BINGO_SIZES.map((k) => `<option value="${k}"${k === n ? ' selected' : ''}>${k} × ${k} · ${k * k} evenimente</option>`).join('')}</select></label>
          ${locked ? '' : '<button class="btn-ghost" data-act="bingoClear">Golește cartonașul</button>'}
        </div>
        ${locked ? '<p class="hint">Cineva a ales deja o linie: mărimea și ordinea rămân, evenimentele se pot doar redenumi.</p>' : ''}
        ${rows.length !== n * n ? `<p class="callout bad">Acum sunt ${rows.length} evenimente; cartonașul ${n} × ${n} are nevoie de exact ${n * n}.</p>` : empty ? `<p class="callout bad">Mai sunt ${empty} ${empty === 1 ? 'pătrat gol' : 'pătrate goale'}: completați-le înainte să salvați.</p>` : ''}`;
      })()}
      <ul class="list bingo-list">${bingoRows().map((r, i) => `<li>
        <span class="d-no" title="Rândul ${Math.floor(i / bingoN()) + 1}, coloana ${(i % bingoN()) + 1}">${i + 1}</span>
        ${r.id !== undefined ? tickBtn(r.id, happened(r.id)) : '<span class="pill off">nou</span>'}
        <input class="field grow" data-bingo-label="${i}" value="${esc(r.label)}" maxlength="80" placeholder="Scrie evenimentul" aria-label="Evenimentul ${i + 1}, rândul ${Math.floor(i / bingoN()) + 1}, coloana ${(i % bingoN()) + 1}" style="flex:1 1 200px;min-width:0">
        <button class="btn-ghost" data-act="bingoDel" data-i="${i}"${r.label.trim() ? '' : ' disabled'}>Golește</button>
        ${r.id !== undefined && !S.bingoDraft ? (() => {
          const cur = B.items.find((x) => x.id === r.id)?.auto_rule ?? null;
          const v = cur ? (cur.n ?? cur.eur ?? cur.h ?? '') : '';
          return `<span class="pair" style="flex:1 1 100%"><select class="field" id="rule-t-${r.id}" aria-label="Se bifează singur, evenimentul ${i + 1}">${RULES.map(([k, l]) => `<option value="${k}"${(cur?.t ?? '') === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <input class="field" type="number" min="1" id="rule-v-${r.id}" value="${esc(v)}" aria-label="Numărul pentru regulă" style="width:110px">
            <button class="btn-ghost" data-act="ruleSave" data-id="${r.id}">Salvează regula</button></span>`;
        })() : ''}</li>`).join('')}</ul>
      <div class="row">
        <button class="btn-primary" data-act="bingoSaveList">Salvează cartonașul</button>
        ${S.bingoDraft ? '<button class="btn-ghost" data-act="bingoCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}
      </div>
      <h3 class="h3s">Tragerea la sorți ${tip('Pe stream se vede în sursa OBS «Tragerea la sorți»: o ruletă cu toți cei cu bingo, care se oprește pe câștigător.\nCâștigătorul e ales de server înainte de animație și intră în PREMII → De dat.')}</h3>
      <p class="muted" style="margin:0">${B.status.winners.length ? `${B.status.winners.length} cu bingo: ${B.status.winners.map((w) => esc(w.login)).join(', ')}` : 'Nimeni nu are încă toată linia bifată.'}</p>
      <div class="row"><button class="btn-primary" data-act="bingoDraw" ${B.status.winners.length && !bingoPicksOpen() ? '' : 'disabled'}>Trage la sorți</button>${B.status.draws.length ? '<button class="btn-ghost" data-act="bingoReplay">Arată din nou pe stream</button>' : ''}</div>
      ${B.status.draws.length ? `<p style="margin:10px 0 0">Extrași: ${B.status.draws.map((d) => `<strong>${esc(d.login)}</strong>${d.drawn_at ? ` <span class="muted">(${when(d.drawn_at)})</span>` : ''}`).join(' · ')}</p>` : ''}
      <h3 class="h3s">Ore și premiu ${tip('Opțional: cu orele planificate, bingo se deschide și se închide singur.')}</h3>
      <div class="fgrid">
        <label class="inline">Se deschide la<input class="field" type="datetime-local" id="bingoOpenAt" value="${toLocal(B.opens_at)}"></label>
        <label class="inline">Se închide la<input class="field" type="datetime-local" id="bingoClose" value="${toLocal(B.closes_at)}"></label>
        <label class="inline" style="flex:1 1 220px">Premiul<input class="field" id="bingoPrize" value="${esc(B.prize)}" maxlength="120"></label>
        <label class="inline" style="flex:1 1 180px">Premiul e de la<input class="field" id="bingoPrizeSponsor" list="sponsorNames" value="${esc(B.prize_sponsor ?? '')}" maxlength="60" placeholder="sponsor (opțional)"></label>
        <button class="btn-ghost" data-act="bingoSettings">Salvează</button>
      </div>
    </section>`;
    })() : ''}`,
    'roata-premii': () => `
    <section class="card wide" id="roata-premii">
      <h2>Premiile roții ${tip('8 felii. Textul de pe roată are cel mult 16 caractere.\nCu șansa 0, felia nu iese niciodată.')}</h2>
      <ul class="list">${wheelRows().map((p, i) => `<li>
        <span class="d-no">${i + 1}</span>
        <input class="field" data-wheel="short_label" data-i="${i}" value="${esc(p.short_label)}" maxlength="16" aria-label="Pe roată, felia ${i + 1}" style="flex:0 1 130px;min-width:0">
        <input class="field" data-wheel="full_label" data-i="${i}" value="${esc(p.full_label)}" maxlength="80" aria-label="Premiul, felia ${i + 1}" style="flex:1 1 200px;min-width:0">
        <input class="field" data-wheel="sponsor" data-i="${i}" value="${esc(p.sponsor)}" list="sponsorNames" maxlength="60" placeholder="de la (sponsor)" aria-label="Sponsorul, felia ${i + 1}" style="flex:0 1 170px;min-width:0">
        <label class="opt opt-s"><input type="checkbox" data-wheel="is_win" data-i="${i}" ${p.is_win ? 'checked' : ''}> câștig</label>
        <label class="opt opt-s">șansa<input class="field" type="number" min="0" max="9999" data-wheel="weight" data-i="${i}" value="${esc(p.weight)}" style="width:80px"></label>
      </li>`).join('')}</ul>
      <div class="row"><button class="btn-primary" data-act="wheelSave">Salvează premiile</button>${S.wheelDraft ? '<button class="btn-ghost" data-act="wheelCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}</div>
    </section>`,
    'raport': () => `
    <section class="card wide" id="raport">
      <h2>Raport pentru sponsori</h2>
      ${(() => {
        const R = S.report;
        if (!R) return '<div class="m-loader small" role="status"><span class="sr-only">Se încarcă</span><span class="ml-flake" aria-hidden="true"></span></div>';
        const fmt = (n: any) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ro-RO'));
        return `<p class="muted" style="margin-top:0">Vârf de viewers în chat: <strong style="color:#F2F5FA">${fmt(R.peak_chatters)}</strong> · ore privite în total: <strong style="color:#F2F5FA">${fmt(R.watch_hours)}</strong> · strâns: <strong style="color:#F2F5FA">${fmt(R.raised)} €</strong>.</p>
        ${(R.sponsors ?? []).length ? `<ul class="list">${R.sponsors.map((x: any, i: number) => `<li style="align-items:flex-start">
          <span class="grow"><strong style="font-size:18px">${esc(x.sponsor)}</strong><br>
          <span class="muted">Click-uri pe link: <strong style="color:#F2F5FA">${fmt(x.clicks)}</strong> · cod de reducere copiat: <strong style="color:#F2F5FA">${fmt(x.code_copies)}</strong> · coduri secrete: ${fmt(x.codes_shown)} afișate, <strong style="color:#F2F5FA">${fmt(x.code_claims)}</strong> revendicări · ore duble: ${fmt(x.double_hours)} (donat în ele: <strong style="color:#F2F5FA">${fmt(x.donated_in_hours)} €</strong>, vârf ${fmt(x.peak_in_hours)} viewers) · premii câștigate: ${fmt(x.wins)} · milestones: ${fmt(x.milestones_unlocked)} / ${fmt(x.milestones)}</span></span>
          <button class="btn-ghost" data-act="copyReport" data-i="${i}">Copiază</button></li>`).join('')}</ul>` : '<p class="muted">Încă nimic de raportat.</p>'}`;
      })()}
    </section>`,
    'vot': () => `
    <section class="card wide" id="vot">
      <h2>Runda de vot</h2>
      ${S.round ? `
        <p class="muted" style="margin-top:0">Runda ${S.round.number} · ${roundOpen ? `se închide la ${when(S.round.closes_at)}` : 'închisă'} · ${totalVotes} voturi</p>
        <ul class="list r-list">${S.round.items.map((x) => `<li><span class="grow">${esc(x.title)}${S.round!.winner_id === x.challenge_id ? ' <span class="pill ok">câștigă</span>' : ''}</span><strong>${x.votes}</strong><span class="muted r-pct">${totalVotes ? Math.round((x.votes / totalVotes) * 100) : 0}%</span>${roundOpen ? `<span class="pair"><button class="btn-ghost" data-act="rSwap" data-id="${x.challenge_id}" aria-expanded="${S.rSwap === x.challenge_id}">Schimbă</button></span>` : ''}
          ${roundOpen && S.rSwap === x.challenge_id ? `<div class="r-swap"><label class="inline" style="flex:1 1 320px">Înlocuiește cu<select class="field" id="rSwapSel">${poolOptions(0)}</select></label><button class="btn-primary" data-act="rSwapSave" data-id="${x.challenge_id}">Salvează</button><button class="btn-ghost" data-act="rSwapCancel">Anulează</button><span class="muted" style="flex-basis:100%">Voturile ei (${x.votes}) se pierd; cei care au votat pot vota din nou.</span></div>` : ''}</li>`).join('')}</ul>
        ${roundOpen ? `
        ${newChallengeRow('round')}
        <div class="row"><button class="btn-primary" data-act="closeRound" data-id="${S.round.id}">Închide runda acum</button>${tip('Se închide singură la final și alege câștigătoarea.')}</div>` : ''}
      ` : '<p class="muted" style="margin-top:0">Nicio rundă încă.</p>'}
      ${!roundOpen && S.auto?.voteOn ? `<p style="margin:14px 0 0"><span class="pill ok">Vot automat</span> Următoarea rundă se deschide singură${S.auto.lastVoteDay === new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Bucharest' }) ? ' mâine' : ' azi'}, după ${esc(S.auto.voteAt)}, când Iceman e live.</p>` : ''}
      ${!roundOpen ? `
        <details class="more"${S.auto?.voteOn ? '' : ' open'} style="margin-top:14px"><summary>Deschide o rundă acum, de mână</summary>
        <div class="row lv-row" role="group" aria-label="Nivelul rundei"><span class="lv-label">Nivelul rundei</span>${LEVELS.map(([k, l]) => `<button type="button" class="btn-ghost lv-btn${draftLevel() === k ? ' on' : ''}" aria-pressed="${draftLevel() === k}" data-act="voteLevel" data-l="${k}">${l} <span class="lv-n">${S.pool.filter((c) => c.level === k).length}</span></button>`).join('')}${tip('Alegeți nivelul: runda are 5 provocări doar din nivelul ăsta, din categorii diferite când se poate.\nNumărul de pe buton: câte provocări libere mai sunt din nivelul respectiv.\n«Alege altele» trage alte 5 din același nivel.')}</div>
        ${S.draft.map((id, i) => `<div class="row d-row"><span class="d-no">${i + 1}</span><select class="field" data-draft="${i}" aria-label="Provocarea ${i + 1}">${poolOptions(id, draftLevel())}</select></div>`).join('')}
        ${S.draft.length < ROUND_SIZE ? `<p class="callout bad">${S.draft.length === 1 ? `Mai e doar o provocare ${draftLevel() === 'ușor' ? 'ușoară' : draftLevel() === 'greu' ? 'grea' : 'medie'} liberă` : S.draft.length ? `Mai sunt doar ${S.draft.length} provocări ${levelPlural(draftLevel())} libere` : `Nu mai e nicio provocare ${draftLevel() === 'ușor' ? 'ușoară' : draftLevel() === 'greu' ? 'grea' : 'medie'} liberă`}; o rundă are nevoie de ${ROUND_SIZE}. Alegeți alt nivel, scrieți provocări noi mai jos sau aprobați propuneri.</p>` : ''}
        ${newChallengeRow('draft')}
        <div class="row">
          <button class="btn-ghost" data-act="reroll">Alege altele</button>
          <label class="inline">Cât durează (ore)<input class="field" type="number" inputmode="numeric" id="roundHours" value="24" min="1" max="48"></label>
          <button class="btn-primary" data-act="openRound">Deschide runda</button>
        </div></details>` : ''}
    </section>`,
    'provocari': () => `
    <section class="card wide" id="provocari">
      <h2>Provocări câștigătoare ${tip('Câștigătoarea fiecărei runde ajunge aici și în «De făcut acum» de pe Stream acum.\nStreamerul o face pe stream; apoi lipiți linkul clipului și apăsați «Făcută». Fără link, cât streamerul e live, clipul se face singur din ultimele 30 de secunde.\n«Când» apare pe site, ca spectatorii să știe când o vadă.')}</h2>
      ${S.scheduled.length ? `<ul class="list">${S.scheduled.map((c) => `<li>
        <span class="grow">${esc(c.title)}</span>
        <span class="pair"><input class="field" data-when="${c.id}" value="${esc(c.scheduled_for ?? '')}" placeholder="ex: Diseară, 22:00" aria-label="Când">
        <button class="btn-ghost" data-act="setWhen" data-id="${c.id}">Salvează</button></span>
        <span class="pair"><input class="field" type="url" data-clip="${c.id}" placeholder="Link clip (Twitch, YouTube)" aria-label="Link clip">
        <button class="btn-primary" data-act="done" data-id="${c.id}">Făcută</button>
        <button class="btn-ghost" data-act="veto" data-id="${c.id}">Veto</button></span></li>`).join('')}</ul>`
        : '<p class="empty">Nicio provocare câștigătoare de făcut.</p>'}
    </section>`,
    'propuneri': () => `
    <section class="card wide" id="propuneri">
      <h2>Propuneri (${S.suggestions.length}) ${tip('Spam-ul, linkurile și dublurile sunt refuzate automat.')}</h2>
      ${S.suggestions.length > 1 ? '<div class="row"><button class="btn-primary" data-act="approveAll">Aprobă tot</button><button class="btn-ghost" data-act="rejectAll">Respinge tot</button></div>' : ''}
      ${S.suggestions.length ? `<ul class="list">${S.suggestions.map((s) => `<li class="acts-row">
        <span class="grow">${esc(s.body)}<br><span class="muted">${esc(s.viewers?.display_name ?? s.viewers?.login ?? '')} · ${when(s.created_at)}</span></span>
        <button class="btn-primary" data-act="approve" data-id="${s.id}">Aprobă</button>
        <button class="btn-ghost" data-act="reject" data-id="${s.id}">Respinge</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Nicio propunere nouă.</p>'}
    </section>`,
    'premii': () => {
      const D = S.due;
      return `
    <section class="card wide" id="premii">
      <div class="card-head"><h2>Premii de dat ${tip('Toți câștigătorii, din toate locurile: roata, bingo și tombolele, cel mai vechi primul.\nApăsați «Dat» după ce câștigătorul a primit premiul.')}</h2><span class="head-stat"><strong>${D.due.length}</strong> de dat</span></div>
      ${D.due.length ? `<ul class="list">${D.due.map(dueRow).join('')}</ul>` : '<p class="empty">Toate premiile au fost date.</p>'}
      ${D.given.length ? `<details class="more" style="margin-top:14px"><summary>Date recent (${D.given.length})</summary><ul class="list">${D.given.map((g) => `<li>${kindPill(g.kind)}<span class="grow"><strong>${esc(g.login)}</strong> · ${esc(g.prize ?? '')}<br><span class="muted">dat ${when(g.given_at)}${g.by ? `, de ${esc(g.by)}` : ''}</span></span></li>`).join('')}</ul></details>` : ''}
    </section>`;
    },
    'tombola': () => tombolaHtml(),
    'unde': () => undeHtml(),
    'moderatori': () => `
    <section class="card wide" id="moderatori">
      <h2>Moderatori ${tip('Merge și înainte ca persoana să se fi conectat pe site.')}</h2>
      <ul class="list">${S.mods.map((m) => `<li><span class="grow">${esc(m.display_name ?? m.login)}</span>${m.login === S.me!.login ? '<span class="muted">tu</span>' : m.login === site.channel ? '<span class="muted">streamer</span>' : `<button class="btn-ghost" data-act="unmod" data-login="${esc(m.login)}">Scoate</button>`}</li>`).join('')}</ul>
      <div class="row">
        <div class="pair">
          <input class="field" id="newMod" placeholder="login Twitch" aria-label="Login Twitch" autocapitalize="none" autocorrect="off" spellcheck="false">
          <button class="btn-primary" data-act="mod">Adaugă</button>
        </div>
      </div>
    </section>`,
    milestones: milestonesHtml,
    'overlay-piese': overlayHtml,
  };
  const page = groupOf(S.view) ?? GROUPS[0];
  const label = page.items.find(([i]) => i === S.view)?.[1] ?? page.title;
  const cards = (BUNDLE[S.view] ?? [S.view]).map((id) => sec[id]?.() ?? '').join('\n');
  // A live refresh (every sub re-draws the page) must not undo what a moderator
  // typed but hasn't sent yet: «Îngheață 120 min» would quietly become the default 5.
  const typed = resetTyped ? new Map<string, string>() : typedValues();
  resetTyped = false;
  app.innerHTML = `${testStripHtml()}
  <datalist id="sponsorNames">${sponsorNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
  <div class="crumb"><h1 tabindex="-1">${esc(label)}</h1><span>${esc(page.name)} · ${esc(page.lead)}</span></div>
  <nav class="subnav" aria-label="${esc(page.name)}">${page.items.map(([i, l]) => `<a href="#${i}"${i === S.view ? ' class="cur" aria-current="page"' : ''}>${esc(l)}${(({ n, warn }) => (n ? `<span class="nb${warn ? ' warn' : ''}">${n}</span>` : ''))(waiting(i))}</a>`).join('')}</nav>
  ${S.view === 'rapid' ? dashHtml(t, live, remaining, now) : `<div class="grid">${cards}</div>`}`;
  for (const [id, v] of typed) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el || !app.contains(el)) continue;
    if (v === '\u0001on' || v === '\u0001off') (el as HTMLInputElement).checked = v === '\u0001on';
    else el.value = v;
  }
  markUnsaved();
  // Opened with #section in the address: scroll there once the page exists.
  if (scrollTo) { const el = document.getElementById(scrollTo); scrollTo = ''; el?.scrollIntoView({ block: 'start' }); }
  afterRender();
}

// ---- Motion (owner, 24 Nov: «more motion»). Only on a page change or a changed number, never on
// every live refresh; nothing moves under prefers-reduced-motion. ---------------------------------
const calmMod = matchMedia('(prefers-reduced-motion: reduce)');
let shownView = '';
let enterTimer = 0;
let tipHintTimer = 0;
const lastKpi: string[] = [];
let inkFrom: { left: number; width: number } | null = null;
function afterRender() {
  boldQuotes(app);
  // A live refresh redrew the page under an open explanation: keep it on the new (i), or close it.
  if (tipFor && !tipFor.isConnected) {
    const again = [...app.querySelectorAll<HTMLElement>('.tip')].find((b) => b.dataset.tip === tipFor!.dataset.tip);
    if (again) tipShow(again); else tipHide();
  }
  if (!S.me?.is_moderator) return;
  // Tombole: a live refresh keeps a typed rule (typedValues); show the hours field to match it.
  app.querySelectorAll<HTMLSelectElement>('select[data-raffle-rule]').forEach((el) => {
    const hrs = document.getElementById(`${el.dataset.raffleRule}Hours`)?.closest('label');
    if (hrs) hrs.hidden = el.value !== 'hours';
  });
  if (document.getElementById('rfRule')) void raffleCount();
  const firstDraw = shownView === '';
  const pageChanged = shownView !== S.view;
  shownView = S.view;
  // 1. A new page comes in: title, then the cards one after another, then their rows.
  //    Not on the first draw after a reload (the loader just went away: content simply appears).
  if (pageChanged && !firstDraw && !calmMod.matches) {
    app.querySelectorAll<HTMLElement>('.kpi, .mmain > .grid > .card, .dash > .card, .mmain > .card').forEach((c, i) => c.style.setProperty('--d', String(Math.min(i, 8))));
    app.classList.remove('pg-in'); void app.offsetWidth; app.classList.add('pg-in');
    clearTimeout(enterTimer);
    enterTimer = window.setTimeout(() => app.classList.remove('pg-in'), 1200);
  }
  // 1b. Every (i) on a newly opened page glows twice (CSS .tip-hint; nothing under reduced motion).
  if (pageChanged && !calmMod.matches) {
    clearTimeout(tipHintTimer);
    app.classList.remove('tip-hint'); void app.offsetWidth; app.classList.add('tip-hint');
    tipHintTimer = window.setTimeout(() => app.classList.remove('tip-hint'), 3200);
  }
  // 2. A number in the strip changed (a sub, a donation): it bumps once.
  const kv = [...app.querySelectorAll<HTMLElement>('.kpi .kv')];
  kv.forEach((el, i) => {
    const t = el.hasAttribute('data-left') ? '' : el.textContent ?? '';
    if (!pageChanged && lastKpi[i] !== undefined && t && lastKpi[i] !== t && !calmMod.matches) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
    lastKpi[i] = t;
  });
  if (pageChanged) lastKpi.length = kv.length;
  // 3. «Control live» tabs: the ice underline slides from the old tab to the new one.
  const tabs = app.querySelector<HTMLElement>('.tabs');
  const on = tabs?.querySelector<HTMLElement>('.tab.on');
  if (tabs && on) {
    let ink = tabs.querySelector<HTMLElement>('.tab-ink');
    if (!ink) { ink = document.createElement('span'); ink.className = 'tab-ink'; ink.setAttribute('aria-hidden', 'true'); tabs.append(ink); }
    const to = { left: on.offsetLeft, width: on.offsetWidth };
    const from = !pageChanged && inkFrom && (inkFrom.left !== to.left || inkFrom.width !== to.width) && !calmMod.matches ? inkFrom : to;
    ink.style.transition = 'none';
    ink.style.transform = `translateX(${from.left}px)`; ink.style.width = `${from.width}px`;
    void ink.offsetWidth;
    ink.style.transition = '';
    ink.style.transform = `translateX(${to.left}px)`; ink.style.width = `${to.width}px`;
    inkFrom = to;
  } else inkFrom = null;
}

// ---- Actions ----
const val = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? '';
const num = (id: string) => Number(val(id));

const acts: Record<string, (el: HTMLElement) => unknown> = {
  login: () => db.auth.signInWithOAuth({ provider: 'twitch', options: { redirectTo: location.origin + location.pathname } }),
  logout: async () => {
    if (demoApi) { say('În demo ești conectat ca icemanlucky (moderator).'); return; }
    await db.auth.signOut(); void load();
  },
  // A locked start field (auto start on, not Iceman) sends the stored start unchanged, to the second.
  schedule: () => call('mod_set_schedule', { p_starts_at: (document.getElementById('startAt') as HTMLInputElement | null)?.disabled ? S.timer?.starts_at ?? null : fromLocal(val('startAt')), p_scheduled_end: fromLocal(val('endAt')) }, 'Programul a fost salvat.'),
  start: () => ask(`Pornești cronometrul acum cu ${num('startHours')} ore?`) &&
    call('mod_start_timer', { p_hours: num('startHours'), p_scheduled_end: S.timer?.scheduled_end ?? null }, 'Subathonul a pornit!'),
  add: (el) => call('mod_add_time', { p_minutes: Number(el.dataset.min) }, `${el.dataset.min} min adăugate.`),
  extendBy: (el) => {
    const input = document.getElementById('extendTo') as HTMLInputElement | null;
    if (!input) return;
    input.value = toLocal(new Date(extendBase(S.timer ?? {}) + Number(el.dataset.days) * 86_400_000).toISOString());
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  },
  extend: async () => {
    const to = val('extendTo');
    const v = to ? Date.parse(to) : NaN;
    const T = S.timer ?? {};
    const add = Number.isFinite(v) ? v + extendSecs(T) - extendBase(T) : 0;
    if (add < 60_000) { say('Finalul nou trebuie să fie după finalul programat de acum.', true); return; }
    if (!ask(`Prelungești subathonul până la ${when(new Date(v).toISOString())}?\n\nCronometrul primește +${durRo(add)}. Nu se poate anula din buton.`)) return;
    await call('mod_extend', { p_new_end: new Date(v + extendSecs(T)).toISOString() }, `Prelungit până la ${when(new Date(v).toISOString())}: +${durRo(add)} pe cronometru.`);
  },
  addCustom: () => num('addMin') && call('mod_add_time', { p_minutes: num('addMin') }, `${num('addMin')} min adăugate.`),
  freeze: () => call('mod_freeze', { p_minutes: num('freezeMin') }, 'Cronometrul e înghețat.'),
  freezeUntil: () => val('freezeUntil') && call('mod_freeze_until', { p_until: fromLocal(val('freezeUntil')) }, 'Cronometrul e înghețat până atunci.'),
  unfreeze: () => ask('Dezgheți cronometrul acum?') && call('mod_unfreeze', {}, 'Cronometrul merge din nou.'),
  bingoOpen: () => ask('Deschizi bingo acum? Spectatorii își pot alege linia de acum.') && call('mod_bingo_open', {}, 'Bingo e deschis: spectatorii își aleg linia.'),
  bingoClose: () => ask('Închizi alegerile de bingo acum? Nimeni nu mai poate alege sau schimba linia; de acum se pot bifa evenimentele.') && call('mod_bingo_close', {}, 'Alegerile s-au închis. Acum se pot bifa evenimentele.'),
  bingoSettings: () => call('mod_bingo_settings', { p_opens_at: fromLocal(val('bingoOpenAt')), p_closes_at: fromLocal(val('bingoClose')), p_prize: val('bingoPrize'), p_prize_sponsor: val('bingoPrizeSponsor') }, 'Setările de bingo au fost salvate.'),
  wheelSave: async () => {
    const list = wheelRows().map((p) => ({ short_label: p.short_label.trim(), full_label: p.full_label.trim(), sponsor: p.sponsor.trim(), is_win: p.is_win, weight: Number(p.weight) || 0 }));
    await call('mod_set_prizes', { p_prizes: list }, 'Premiile roții au fost salvate.');
    S.wheelDraft = null;
  },
  wheelCancel: () => { S.wheelDraft = null; render(); },
  codeShow: async () => {
    const r: any = await call('mod_code_show', { p_sponsor: val('codeSponsor'), p_minutes: num('codeMin') || 10 }, 'Cod nou pe stream.');
    if (r?.code) say(`Codul pe stream: ${r.code}`);
  },
  codeEnd: () => call('mod_code_end', {}, 'Codul a fost oprit.'),
  copyReport: (el) => {
    const R = S.report; const x = R?.sponsors?.[Number(el.dataset.i)];
    if (!x) return;
    const n = (v: any) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('ro-RO'));
    const text = [`ICEMARATON · raport pentru ${x.sponsor}`, '',
      `Click-uri pe linkul vostru: ${n(x.clicks)}`, `Cod de reducere copiat: ${n(x.code_copies)}`,
      `Coduri secrete afișate pe stream: ${n(x.codes_shown)} · revendicate: ${n(x.code_claims)}`,
      `Ore duble oferite de voi: ${n(x.double_hours)} · donații în timpul lor: ${n(x.donated_in_hours)} € · vârf: ${n(x.peak_in_hours)} viewers în chat`,
      `Premii câștigate pe roată de la voi: ${n(x.wins)}`, `Milestones prezentate: ${n(x.milestones_unlocked)} deblocate din ${n(x.milestones)}`,
      '', `Maratonul în total: vârf ${n(R.peak_chatters)} viewers în chat, ${n(R.watch_hours)} ore privite, ${n(R.raised)} € strânși.`].join('\n');
    void navigator.clipboard?.writeText(text).then(() => say('Raportul a fost copiat.'));
  },
  bingoTick: (el) => call('mod_bingo_tick', { p_id: Number(el.dataset.id), p_happened: el.dataset.on === '1' }, el.dataset.on === '1' ? 'Bifat: s-a întâmplat.' : 'Debifat.'),
  // A square keeps its place: «Golește» empties it (to write another event there).
  bingoDel: (el) => { const r = editBingo()[Number(el.dataset.i)]; if (r) r.label = ''; render(); },
  bingoCancel: () => { S.bingoDraft = null; S.bingoSize = null; render(); },
  bingoSaveList: async () => {
    const rows = bingoRows(), n = bingoN();
    if (rows.length !== n * n) { say(`Cartonașul ${n} × ${n} are nevoie de exact ${n * n} evenimente (acum sunt ${rows.length}).`, true); return; }
    const empty = rows.filter((r) => !r.label.trim()).length;
    if (empty) { say(`Completați toate cele ${n * n} pătrate: ${empty} ${empty === 1 ? 'e gol' : 'sunt goale'}.`, true); return; }
    const list = rows.map((r) => (r.id !== undefined ? { id: r.id, label: r.label.trim() } : { label: r.label.trim() }));
    await call('mod_bingo_set_items', { p_items: list }, 'Cartonașul de bingo a fost salvat.');
    S.bingoDraft = null; S.bingoSize = null;
  },
  bingoClear: () => {
    const n = bingoN();
    if (!ask(`Golești cartonașul? Rămân ${n * n} pătrate goale, pe care le scrieți voi. Se salvează abia când apăsați «Salvează cartonașul».`)) return;
    S.bingoDraft = Array.from({ length: n * n }, () => ({ label: '' }));
    S.bingoSize = n;
    render();
  },
  bingoDraw: async () => {
    if (!ask('Tragi la sorți un câștigător dintre cei cu bingo?')) return;
    const won = await call('mod_bingo_draw', {}, 'Tragere făcută.');
    if (won) alert(`Câștigătorul: ${won}. Pe stream, ruleta se oprește pe el în câteva secunde.`);
  },
  bingoReplay: () => call('mod_bingo_replay', {}, 'Tragerea se vede din nou pe stream.'),
  double: () => call('mod_double_hour', { p_from: fromLocal(val('dblFrom')), p_minutes: num('dblMin'), p_sponsor: val('dblSponsor') }, 'Ora dublă programată.'),
  doubleNow: () => call('mod_double_hour', { p_from: new Date().toISOString(), p_minutes: num('dblMin') || 60, p_sponsor: val('dblSponsor') }, 'Ora dublă a început.'),
  end: () => openEndDialog(),
  endConfirm: () => {
    if (!endWordOk()) return;
    endDlg.close();
    return call('mod_end_timer', {}, 'Subathonul s-a încheiat.');
  },
  closeRound: (el) => call('mod_close_round', { p_round: Number(el.dataset.id) }, 'Runda s-a închis.'),
  reroll: () => { autoDraft(); resetTyped = true; render(); },
  voteLevel: (el) => { S.voteLevel = el.dataset.l ?? null; autoDraft(); resetTyped = true; render(); },
  newChallenge: async (el) => {
    const to = el.dataset.to as 'round' | 'draft';
    const title = val(`newCh_${to}`).trim();
    if (!title) { say('Scrie textul provocării.', true); document.getElementById(`newCh_${to}`)?.focus(); return; }
    // Read the chosen place first: saving the challenge refreshes the page.
    const old = to === 'round' ? S.round?.items.find((x) => x.challenge_id === Number(val('newChFor_round'))) : undefined;
    const slot = Math.max(0, Math.min(Number(val('newChFor_draft')) || 0, S.draft.length - 1));
    if (to === 'round' && !old) return;
    if (old?.votes && !ask(`Provocarea nouă ia locul «${old.title}». Cele ${old.votes} voturi ale ei se pierd; cei care au votat pot vota din nou. Continui?`)) return;
    const id = Number(await call('mod_challenge_add', { p_title: title, p_level: to === 'draft' ? draftLevel() : val('newChLvl_round') }, 'Provocare adăugată.'));
    if (!id) return;
    if (to === 'round' && S.round && old) {
      await call('mod_round_edit', { p_round: S.round.id, p_action: 'replace', p_challenge: old.challenge_id, p_new: id }, 'Provocarea nouă e în rundă.');
    } else if (to === 'draft') {
      if (S.draft.length < ROUND_SIZE) S.draft.push(id); else S.draft[slot] = id;
      resetTyped = true; render();
    }
  },
  rSwap: (el) => { const id = Number(el.dataset.id); S.rSwap = S.rSwap === id ? null : id; render(); document.getElementById('rSwapSel')?.focus(); },
  rSwapCancel: () => { S.rSwap = null; render(); },
  rSwapSave: async (el) => {
    if (!S.round) return;
    const nid = Number(val('rSwapSel'));
    if (!nid) { say('Alege provocarea nouă.', true); return; }
    await call('mod_round_edit', { p_round: S.round.id, p_action: 'replace', p_challenge: Number(el.dataset.id), p_new: nid }, 'Provocarea a fost schimbată.');
    S.rSwap = null;
  },
  openRound: () => {
    const ids = [...document.querySelectorAll<HTMLSelectElement>('[data-draft]')].map((s) => Number(s.value));
    if (ids.length !== ROUND_SIZE) { say(`O rundă are nevoie de exact ${ROUND_SIZE} provocări.`, true); return; }
    if (new Set(ids).size !== ids.length) { say('Ai ales aceeași provocare de două ori.', true); return; }
    const hours = Number(val('roundHours')) || 24;
    if (hours < 1 || hours > 48) { say('O rundă ține între 1 și 48 de ore.', true); return; }
    return call('mod_open_round', { p_challenges: ids, p_minutes: Math.round(hours * 60) }, 'Runda e deschisă.');
  },
  setWhen: (el) => call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'scheduled', p_scheduled_for: (document.querySelector<HTMLInputElement>(`[data-when="${el.dataset.id}"]`)?.value ?? '') || null }, 'Salvat.'),
  done: async (el) => {
    let clip = (document.querySelector<HTMLInputElement>(`[data-clip="${el.dataset.id}"]`)?.value ?? '').trim();
    if (clip && !/^https:\/\//.test(clip) && !(demo && clip === '#')) { say('Linkul clipului trebuie să înceapă cu https://', true); return; }
    // No link typed: clip the last ~30 seconds on Twitch (only while Iceman is live).
    if (!clip) clip = (await clipNow()) ?? '';
    return call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'done', p_clip: clip || null }, clip ? 'Marcată ca făcută, cu clip.' : 'Marcată ca făcută.');
  },
  veto: (el) => ask('Veto pe provocarea asta?') && call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'vetoed' }, 'Veto.'),
  approve: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: true }, 'Aprobată: e acum în lista de provocări.'),
  reject: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: false }, 'Respinsă.'),
  given: (el) => call('mod_prize_given', { p_kind: el.dataset.kind, p_id: Number(el.dataset.id) }, 'Premiu marcat ca dat.'),
  raffleAdd: () => {
    const rule = val('rfRule');
    if (!val('rfPrize').trim()) return say('Scrie premiul.', true);
    return call('mod_raffle_save', { p_id: null, p_prize: val('rfPrize'), p_sponsor: val('rfSponsor'), p_rule: rule, p_min_hours: rule === 'hours' ? Number(val('rfHours')) || null : null }, 'Tombola a fost adăugată.');
  },
  raffleSave: (el) => {
    const id = el.dataset.id!, rule = val(`rf${id}Rule`);
    return call('mod_raffle_save', { p_id: Number(id), p_prize: val(`rf${id}Prize`), p_sponsor: val(`rf${id}Sponsor`), p_rule: rule, p_min_hours: rule === 'hours' ? Number(val(`rf${id}Hours`)) || null : null }, 'Tombola a fost salvată.');
  },
  raffleDel: (el) => ask('Ștergi tombola?') && call('mod_raffle_delete', { p_id: Number(el.dataset.id) }, 'Tombola a fost ștearsă.'),
  raffleDraw: (el) => {
    const r = S.raffles.find((x) => x.id === Number(el.dataset.id));
    if (!r) return;
    return ask(`Tragi la sorți «${r.prize}» acum? Ruleta pornește pe stream (sursa «Tragerea la sorți»).`) &&
      call('mod_raffle_draw', { p_id: r.id }, 'Câștigătorul a fost ales. Ruleta merge pe stream.');
  },
  raffleReplay: (el) => call('mod_raffle_replay', { p_draw: Number(el.dataset.id) }, 'Tragerea se vede din nou pe stream.'),
  goalAdd: () => { editGoals().push({ title: '', threshold: '', sponsor: '', done: false, clip: '', when: '' }); render(); },
  goalDone: async (el) => {
    const g = editGoals()[Number(el.dataset.i)];
    g.done = !g.done;
    if (g.done && !g.clip) {
      const url = await clipNow();
      if (url) { g.clip = url; say('Clip făcut. Apasă «Salvează» ca să rămână.'); }
    }
    render();
  },
  liveTab: (el) => { S.liveTab = (el.dataset.tab as typeof S.liveTab) || 'timp'; render(); app.querySelector<HTMLElement>(`[data-tab="${S.liveTab}"]`)?.focus(); },
  spNew: () => { S.spEdit = 'new'; resetTyped = true; render(); document.getElementById('sp_name')?.focus(); },
  spEdit: (el) => { const id = Number(el.dataset.id); S.spEdit = S.spEdit === id ? null : id; resetTyped = true; render(); if (S.spEdit !== null) document.getElementById('sp-form')?.scrollIntoView({ block: 'start' }); },
  spCancel: () => { S.spEdit = null; resetTyped = true; render(); },
  spLogoClear: () => { const i = document.getElementById('sp_logo') as HTMLInputElement | null; if (i) { i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); } const p = document.getElementById('sp_prev'); if (p) p.innerHTML = spLogo(null, val('sp_name'), true); },
  spSave: async (el) => {
    if (!val('sp_name').trim()) { say('Sponsorul are nevoie de un nume.', true); document.getElementById('sp_name')?.focus(); return; }
    await call('mod_sponsor_save', { p: spPayload(el.dataset.id ?? '') }, 'Sponsor salvat. Apare pe site în câteva secunde.');
    S.spEdit = null;
  },
  spDelete: async (el) => {
    const x = S.sponsors.find((y) => y.id === Number(el.dataset.id));
    if (!x || !ask(`Ștergi sponsorul «${x.name}»? Dispare de pe site și de pe overlay.`)) return;
    await call('mod_sponsor_delete', { p_id: x.id }, 'Sponsor șters.');
    S.spEdit = null;
  },
  spMove: (el) => call('mod_sponsor_move', { p_id: Number(el.dataset.id), p_dir: Number(el.dataset.dir) }, 'Ordinea s-a schimbat.'),
  testStart: () => ask(`Pornești modul test pentru ${num('testHours') || 3} ore? Tot site-ul, /mod și overlay-ul trec pe date de probă; la oprire totul revine exact cum e acum.`) &&
    call('mod_test', { p_action: 'start', p: { hours: num('testHours') || 3 } }, 'Testul a pornit. Comenzile sunt în banda galbenă de sus.'),
  testStop: () => ask('Oprești testul? Tot ce s-a făcut în test se șterge și site-ul revine la normal.') &&
    call('mod_test', { p_action: 'stop' }, 'Testul s-a oprit. Site-ul e din nou cel real.'),
  testRedo: () => ask('Iei testul de la capăt? Datele de test se șterg, testul merge în continuare.') &&
    call('mod_test', { p_action: 'redo' }, 'De la capăt: totul e ca la pornirea testului.'),
  // Starts the test marathon (any moderator may during a test) and puts Iceman «on Twitch».
  testGoLive: async (el) => {
    await call('mod_start_timer', { p_hours: Number(el.dataset.h) || 24, p_scheduled_end: S.timer?.scheduled_end ?? null }, 'Maratonul de test a pornit: site-ul arată LIVE, donațiile adaugă timp.');
    if (!S.timer?.stream_online) await call('mod_test', { p_action: 'stream', p: { on: true } }, 'Maratonul de test a pornit: site-ul arată LIVE, donațiile adaugă timp.');
  },
  testEnd: () => ask('Închei maratonul de test? Vezi ecranul de final; «De la capăt» îl aduce înapoi.') &&
    call('mod_end_timer', {}, 'Maratonul de test s-a încheiat.'),
  testSponsors: () => call('mod_test_sponsors', {}, 'Sponsori de test pe site și pe overlay (1 principal, 5 parteneri, 4 susținători).'),
  testClock: async (el) => {
    const a = el.dataset.a;
    // Freeze and Ora dublă act on the running clock: start the test marathon first if needed.
    if ((S.timer?.status ?? 'upcoming') === 'upcoming') {
      await call('mod_start_timer', { p_hours: Number(S.auto?.startHours) || 24, p_scheduled_end: S.timer?.scheduled_end ?? null }, 'Maratonul de test a pornit.');
    }
    const now = new Date().toISOString();
    const main = S.sponsors.find((x: any) => x.tier === 'main')?.name ?? '';
    if (a === 'freeze') return call('mod_freeze', { p_minutes: 5 }, 'Test: cronometrul e înghețat 5 minute.');
    if (a === 'unfreeze') return call('mod_unfreeze', {}, 'Test: cronometrul merge din nou.');
    if (a === 'double') return call('mod_double_hour', { p_from: now, p_minutes: 10, p_sponsor: '' }, 'Test: Ora dublă 10 minute.');
    if (a === 'doubleSp') return call('mod_double_hour', { p_from: now, p_minutes: 10, p_sponsor: main }, `Test: Ora dublă de la ${main}, 10 minute.`);
    if (a === 'nodouble') return call('mod_double_hour', { p_from: now, p_minutes: 0, p_sponsor: '' }, 'Test: Ora dublă s-a oprit.');
  },
  // Subs, bits and donations only count while the (test) marathon runs, as for real. In a test that
  // is never what you want to check, so the first such button starts the test marathon by itself.
  testDo: async (el) => {
    const a = el.dataset.a ?? '';
    if (['sub', 'resub', 'gift', 'bits', 'donation'].includes(a) && (S.timer?.status ?? 'upcoming') === 'upcoming') {
      await call('mod_start_timer', { p_hours: Number(S.auto?.startHours) || 24, p_scheduled_end: S.timer?.scheduled_end ?? null }, 'Maratonul de test a pornit.');
      if (!S.timer?.stream_online) await call('mod_test', { p_action: 'stream', p: { on: true } }, 'Maratonul de test a pornit.');
    }
    return call('mod_test', { p_action: a, p: JSON.parse(el.dataset.p || '{}') }, el.dataset.ok || 'Gata.');
  },
  copyOvp: (el) => { const v = val(`ovp${el.dataset.i}`); void navigator.clipboard?.writeText(v).then(() => say('Link copiat.')); },
  sceneClear: () => ask('Scoți fotografia de fundal? Scena rămâne transparentă.') && call('mod_scene_set', { p_background: null }, 'Fotografia a fost scoasă.'),
  copyOv: (el) => { const v = val(`ov${el.dataset.i}`); void navigator.clipboard?.writeText(v).then(() => say('Link copiat. Pune-l în OBS ca Browser Source, 1920×1080.')); },
  goalDel: (el) => { editGoals().splice(Number(el.dataset.i), 1); render(); },
  goalCancel: () => { S.goalsDraft = null; render(); },
  goalSave: async () => {
    const list = goalRows().filter((g) => g.title.trim() || g.threshold !== '')
      .map((g) => ({ title: g.title.trim(), threshold: Number(g.threshold), sponsor: g.sponsor.trim(), done: g.done, clip: g.clip.trim(), when: g.when.trim() }));
    if (list.some((g) => g.clip && !/^https:\/\//.test(g.clip) && !(demo && g.clip === '#'))) { say('Linkul clipului trebuie să înceapă cu https://', true); return; }
    await call('mod_set_goals', { p_goals: list }, 'Lista de milestone-uri a fost salvată.');
    S.goalsDraft = null;
  },
  linesSave: async () => {
    const out: Partial<Record<LineGroup, string[]>> = {};
    for (const g of lineGroups) {
      const list = linesOf(g.id);
      if (list.some((l) => l.length > MAX_LINE)) { say(errors.line_too_long, true); document.getElementById(`lines-${g.id}`)?.focus(); return; }
      out[g.id] = list;
    }
    const threshold = Number(val('smallDonation'));
    await call('mod_set_lines', { p_lines: out, p_small_donation: threshold > 0 ? threshold : null }, 'Replicile au fost salvate. Apar pe site în câteva secunde.');
    S.linesDraft = null;
  },
  linesCancel: () => { S.linesDraft = null; render(); },
  chatToggle: (el) => {
    const on = (el as HTMLInputElement).checked;
    if (on && !ask('Pornești replicile în chatul Twitch, din contul lui Iceman?')) { (el as HTMLInputElement).checked = false; return; }
    return call('mod_set_chat_echo', { p_on: on }, on ? 'Replicile apar și în chatul Twitch.' : 'Replicile nu mai apar în chat.');
  },
  noteSet: () => val('nowNote').trim() && call('mod_set_note', { p_note: val('nowNote'), p_minutes: Number(val('nowMin')) || 30 }, 'Nota apare pe site.'),
  noteClear: () => call('mod_set_note', { p_note: '', p_minutes: 1 }, 'Nota a fost scoasă.'),
  taskDone: (el) => call('mod_task_done', { p_id: Number(el.dataset.id), p_done: true }, 'Bifat: Iceman a făcut-o.'),
  tasksSave: () => {
    const lines = val('tasksList').split('\n').map((l) => l.trim()).filter(Boolean);
    const items = lines.map((l) => { const [p, ...t] = l.split('|'); return { price: (p ?? '').replace('€', '').trim(), title: t.join('|').trim() }; });
    if (items.some((x) => !x.price || !x.title)) { say('Câte una pe rând: suma | sarcina (de exemplu «10 | Alege un campion»).', true); return; }
    S.tasksDraft = null;
    return call('mod_tasks_set', { p_items: items }, 'Lista a fost salvată. Overlay-ul o arată în câteva secunde.');
  },
  mod: () => val('newMod').trim() && call('mod_set_moderator', { p_login: val('newMod'), p_on: true }, 'Moderator adăugat.'),
  skipDone: (el) => call('mod_skipped_done', { p_id: el.dataset.id }, 'Gata.'),
  autoSave: () => call('mod_autopilot_set', { p: {
    voteOn: (document.getElementById('apVoteOn') as HTMLInputElement)?.checked ?? false, voteAt: val('apVoteAt') || '20:00',
    voteMinutes: Math.round((num('apVoteHours') || 24) * 60), voteLevel: val('apVoteLevel') || 'mediu',
  } }, 'Votul automat a fost salvat.'),
  // STREAMER → Start: auto start and the hours on the clock at the start (only these keys; the rest stays).
  startSave: () => call('mod_autopilot_set', { p: {
    autoStart: (document.getElementById('apAutoStart') as HTMLInputElement)?.checked ?? false, startHours: num('startHours') || 24,
  } }, 'Pornirea a fost salvată.'),
  planAdd: () => {
    const kind = val('planKind');
    if (!val('planAt')) { say('Alege ziua și ora.', true); return; }
    return call('mod_plan_add', { p_kind: kind, p_at: fromLocal(val('planAt')), p_minutes: kind === 'freeze' ? null : num('planMin') || null,
      p_until: kind === 'freeze' ? fromLocal(val('planUntil')) : null, p_sponsor: val('planSponsor') }, `${planKind[kind] ?? 'Programul'}: programat.`);
  },
  planDel: (el) => ask('Ștergi din program?') && call('mod_plan_del', { p_id: Number(el.dataset.id) }, 'Șters din program.'),
  hookSave: () => val('hookUrl').trim() ? call('mod_autopilot_set', { p: { discordWebhook: val('hookUrl').trim() } }, 'Webhook salvat. Apasă «Trimite un test».') : say('Lipește întâi linkul webhook-ului.', true),
  hookClear: () => ask('Oprești alertele în Discord?') && call('mod_autopilot_set', { p: { discordWebhook: '' } }, 'Alertele sunt oprite.'),
  hookTest: () => call('mod_alert_test', {}, 'Mesaj de test trimis. Verifică pe Discord.'),
  check: (el) => call('mod_checklist_set', { p_key: el.dataset.key, p_done: (el as HTMLInputElement).checked }, (el as HTMLInputElement).checked ? 'Bifat.' : 'Debifat.'),
  ruleSave: (el) => {
    const id = Number(el.dataset.id), k = val(`rule-t-${id}`), def = RULES.find(([x]) => x === k);
    const n = num(`rule-v-${id}`);
    const rule = !k ? null : def?.[2] ? { t: k, [def[2]]: n } : { t: k };
    return call('mod_bingo_rule', { p_id: id, p_rule: rule }, rule ? 'Regula e salvată: se bifează singur.' : 'Regula a fost scoasă.');
  },
  approveAll: () => ask(`Aprobi toate cele ${S.suggestions.length} propuneri? Intră în lista de provocări.`) && call('mod_review_all', { p_approve: true }, 'Toate au fost aprobate.'),
  rejectAll: () => ask(`Respingi toate cele ${S.suggestions.length} propuneri?`) && call('mod_review_all', { p_approve: false }, 'Toate au fost respinse.'),
  unmod: (el) => ask(`Scoți moderatorul ${el.dataset.login}?`) && call('mod_set_moderator', { p_login: el.dataset.login, p_on: false }, 'Moderator scos.'),
};

// One request per click: a double click on «+10 min» must not add 20 minutes.
// The control is busy (disabled, aria-busy) until its request has answered;
// the same action on the same row (data-id / data-i / data-min) waits too, even
// if a live refresh re-drew the button in the meantime.
const busy = new Set<string>();
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!el) return;
  const act = el.dataset.act!;
  const key = [act, el.dataset.id, el.dataset.i, el.dataset.min, el.dataset.name, el.dataset.login].join('|');
  if (busy.has(key)) { e.preventDefault(); return; }
  const result = acts[act]?.(el);
  if (!(result instanceof Promise)) return;
  busy.add(key);
  const control = el as HTMLButtonElement;
  const wasDisabled = control.disabled;
  if (el.tagName === 'BUTTON') { control.disabled = true; el.setAttribute('aria-busy', 'true'); }
  // At least 700 ms, so the second click of a double click lands while it's still busy.
  void Promise.allSettled([result, new Promise((r) => setTimeout(r, 700))]).then(() => {
    busy.delete(key);
    if (el.isConnected && el.tagName === 'BUTTON') { control.disabled = wasDisabled; el.removeAttribute('aria-busy'); }
  });
});
document.addEventListener('change', (e) => {
  const sel = (e.target as Element).closest<HTMLSelectElement>('[data-draft]');
  if (sel) S.draft[Number(sel.dataset.draft)] = Number(sel.value);
});
// Milestone edits are kept while typing, so a live refresh doesn't wipe them.
document.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.bingoLabel !== undefined) { editBingo()[Number(el.dataset.bingoLabel)].label = el.value; return; }
  if (el.dataset.wheel !== undefined) {
    const row = editWheel()[Number(el.dataset.i)] as any;
    row[el.dataset.wheel] = el.type === 'checkbox' ? el.checked : el.value;
    return;
  }
  if (el.dataset.lines !== undefined) {
    const g = el.dataset.lines as LineGroup;
    S.linesDraft = { ...(S.linesDraft ?? {}), [g]: el.value };
    const box = app.querySelector<HTMLElement>(`[data-lg="${g}"]`);
    if (box) {
      const L = lineInfo(g);
      box.style.borderColor = L.border;
      const c = box.querySelector<HTMLElement>('[data-lg-count]');
      if (c) { c.textContent = L.count; c.style.color = L.color; }
      box.querySelector('[data-lg-who]')!.textContent = L.who;
      box.querySelector('[data-lg-preview]')!.textContent = L.preview;
    }
    const row = app.querySelector('#replici .row');
    if (row && !row.querySelector('[data-act="linesCancel"]')) row.insertAdjacentHTML('beforeend', '<button class="btn-ghost" data-act="linesCancel">Renunță</button><span class="muted">Modificări nesalvate</span>');
    return;
  }
  if (el.dataset.goalWhen !== undefined) { editGoals()[Number(el.dataset.goalWhen)].when = el.value; return; }
  if (el.dataset.goalClip !== undefined) { editGoals()[Number(el.dataset.goalClip)].clip = el.value; return; }
  if (el.dataset.goalSponsor !== undefined) { editGoals()[Number(el.dataset.goalSponsor)].sponsor = el.value; return; }
  if (el.dataset.goalAmt !== undefined) editGoals()[Number(el.dataset.goalAmt)].threshold = el.value;
  else if (el.dataset.goalTitle !== undefined) editGoals()[Number(el.dataset.goalTitle)].title = el.value;
  else return;
  const box = app.querySelector('#milestones .row');
  if (box && !box.querySelector('[data-act="goalCancel"]')) box.insertAdjacentHTML('beforeend', '<button class="btn-ghost" data-act="goalCancel">Renunță</button><span class="muted">Modificări nesalvate</span>');
});

// Live countdown in the bar and the timer card, plus realtime refresh.
setInterval(() => {
  const t = S.timer;
  if (t?.status !== 'live' || !t.ends_at) return;
  const now = Date.now();
  const ms = Date.parse(t.ends_at) - (t.paused_until && Date.parse(t.paused_until) > now ? Date.parse(t.paused_until) : now);
  document.querySelectorAll<HTMLElement>('[data-left]').forEach((el) => { el.textContent = left(ms); });
}, 1000);

// Pages: the hash names a section (#bingo); its group's page opens and scrolls to it.
let scrollTo = decodeURIComponent(location.hash.slice(1));
function route(scroll: boolean) {
  const id = decodeURIComponent(location.hash.slice(1));
  const v = id ? viewOf(id) : null;
  const changed = !!v && v !== S.view;
  if (v) { S.view = v; S.page = groupOf(v)?.id ?? S.page; }
  if (changed) { deferred = false; if (S.me) render(); }
  else if (S.me?.is_moderator) setNav();
  // A new page opens at its top; an anchor inside the page (#premii) scrolls to it.
  if (scroll) requestAnimationFrame(() => {
    const el = id && id !== v ? document.getElementById(id) : null;
    if (el) {
      el.scrollIntoView({ block: 'start' });
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    } else if (changed) {
      window.scrollTo({ top: 0 });
      app.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    }
  });
  // Phone: the menu is one scrolling row; slide it so the open group is in view.
  requestAnimationFrame(() => {
    const sub = app.querySelector<HTMLElement>('.subnav');
    const sc = sub?.querySelector<HTMLElement>('a.cur');
    if (sub && sc && sub.scrollWidth > sub.clientWidth) sub.scrollLeft = Math.max(0, sc.offsetLeft - sub.offsetLeft - 12);
    const on = nav.querySelector<HTMLElement>('.ng.on');
    if (!on || nav.scrollWidth <= nav.clientWidth) return;
    const left = on.offsetLeft - 12;
    if (left < nav.scrollLeft || on.offsetLeft + on.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left, behavior: 'smooth' });
  });
}
window.addEventListener('hashchange', () => route(true));
// A skip link to the section already in the address doesn't change the hash: open it anyway.
document.querySelectorAll<HTMLAnchorElement>('.skip').forEach((a) => a.addEventListener('click', () => {
  if (location.hash === a.hash) requestAnimationFrame(() => route(true));
}));
// The phone menu sticks right under the status bar, whatever its height.
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);
route(false);

let pending: number | undefined;
const refresh = () => { clearTimeout(pending); pending = window.setTimeout(() => void load(), demoApi ? 50 : 400); };

// Demo: "Conectează contul de streamer" just marks it connected.
document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest<HTMLAnchorElement>('a[href="#connect-demo"]');
  if (!a) return;
  e.preventDefault();
  demoApi?.connectStreamer();
  say('Demo: pe site-ul real, aici Iceman aprobă accesul pe Twitch.');
});

if (demo) {
  void import('../demo/backend').then(({ DemoBackend }) => {
    demoApi = new DemoBackend();
    demoApi.subscribe(refresh);
    // Background jobs (close rounds, end at zero) when this page is on its own.
    if (window.top === window) setInterval(() => demoApi?.tick(), 1000);
    void load();
  });
} else {
  const ch = db.channel('mod');
  for (const table of ['timer', 'stats', 'vote_rounds', 'round_challenges', 'spins']) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, refresh);
  }
  // Realtime only sends what happens while connected: reload whenever the channel (re)joins,
  // the tab comes back, or the network returns, so nothing stays minutes old (B-14).
  ch.subscribe((status) => { if (status === 'SUBSCRIBED') refresh(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    refresh();
  });
  window.addEventListener('online', () => { refresh(); bar.innerHTML = barHtml(); });
  window.addEventListener('offline', () => { bar.innerHTML = barHtml(); });
  db.auth.onAuthStateChange(() => refresh());
  void load();
  // The health card refreshes on its own every minute (only that card: forms being typed stay as they are).
  setInterval(async () => {
    if (document.visibilityState !== 'visible' || !S.me?.is_moderator) return;
    S.health = (await (db as any).rpc('mod_health')).data ?? S.health;
    const box = app.querySelector('#sanatate .health, #sanatate > p.muted:first-of-type');
    if (box) box.outerHTML = healthHtml(S.health);
  }, 60_000);
}
