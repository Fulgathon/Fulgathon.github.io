// Moderator page logic. Reads with the moderator's own session (row level
// security lets moderators see suggestions and viewers) and acts through the
// mod_* database functions, which re-check moderator rights every time.
// /mod/?demo runs on the simulated backend instead (no login, shared with
// /?demo, /overlay/?demo and /prezentare/).

import { createClient } from '@supabase/supabase-js';
import { site } from '../data/site';
import type { DemoBackend } from '../demo/backend';
import { esc } from '../lib/views';
import { FALLBACK_LINE, lineGroups, MAX_LINE, MIN_LINES } from '../data/content';
import type { AdventDay, LineGroup, TickerItem } from '../data/types';
import { ADVENT_DAYS, adventDates, badgeDefs, PRISM, rankColors, tierColors } from '../data/content';
import { tickerItem } from '../lib/events';
import { ago as agoText, count as countRo, fmtInt } from '../lib/format';

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
  need_two_challenges: 'Alege cel puțin 2 provocări.',
  bad_goals: 'Fiecare milestone are nevoie de text și de o sumă în euro (număr întreg, peste 0).',
  bad_items: 'Bingo: între 5 și 60 de evenimente, fiecare cu un text de cel mult 80 de caractere.',
  item_in_use: 'Un eveniment ales deja de jucători nu poate fi șters. Îl poți redenumi.',
  need_25: 'Cartonașul are exact 25 de evenimente (5×5). Adaugă sau șterge până ajungi la 25.',
  card_locked: 'Jucătorii și-au ales deja linii: poți doar redenumi evenimentele, nu le poți muta, adăuga sau șterge.',
  no_bingo_winners: 'Nu e nimeni (nou) pe lista de bingo: încă nu s-au întâmplat toate cele 5 evenimente la cineva.',
  freeze_in_past: 'Alege o dată din viitor (după înghețarea de acum, dacă e una).',
  bad_minutes: 'Scrie un număr de minute mai mare decât 0.',
  bad_clip: 'Linkul clipului trebuie să înceapă cu https://',
  duplicate_amount: 'Două milestone-uri au aceeași sumă. Fiecare sumă trebuie să fie diferită.',
  bad_lines: 'Replicile nu au putut fi salvate: cel mult 40 pe grup.',
  line_too_long: 'O replică are mai mult de 70 de caractere. Scurteaz-o ca să încapă în balon.',
  bad_threshold: 'Pragul pentru donație mare trebuie să fie un număr între 1 și 10.000 de euro.',
  mod_set_lines: 'Editorul de replici are nevoie de actualizarea bazei de date (migrarea layout v2).',
  mod_set_chat_echo: 'Comutatorul de chat are nevoie de actualizarea bazei de date (migrarea layout v2).',
};
let msgTimer: number | undefined;
function say(text: string, err = false) {
  msgBox.textContent = text;
  msgBox.classList.toggle('err', err);
  msgBox.hidden = false;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => { msgBox.hidden = true; }, 4000);
}
async function call(fn: string, args: Record<string, unknown> = {}, ok = 'Gata.') {
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
interface Challenge { id: number; title: string; level: string; category: string; status: string; scheduled_for: string | null }
let S: {
  me: { login: string; is_moderator: boolean } | null;
  status: { broadcaster_login: string; broadcaster_connected: boolean; connect_url: string } | null;
  timer: Record<string, any> | null;
  stats: Record<string, any> | null;
  round: { id: number; number: number; closes_at: string; winner_id: number | null; items: { challenge_id: number; votes: number; title: string }[] } | null;
  pool: Challenge[];
  scheduled: Challenge[];
  suggestions: { id: number; body: string; created_at: string; viewers: { login: string; display_name: string } | null }[];
  prizes: { id: number; user_login: string; created_at: string; prizes: { win_label: string; is_win: boolean } | null }[];
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
    closes_at: string | null; prize: string; prize_sponsor?: string | null;
    items: { id: number; label: string; happened_at: string | null }[];
    status: { players: number; winners: { login: string }[]; draws: { login: string; drawn_at: string | null }[] };
  } | null;
  /** Bingo event list being edited (null = showing the saved list). */
  bingoDraft: { id?: number; label: string }[] | null;
  /** Public names: names the filter hides, and the rules set (hide / allow / viewer opt-out). */
  names: { filtered: string[]; rules: { name: string; rule: 'hide' | 'allow' | 'opt_out'; at: string }[] };
  /** mod_health(): is everything still arriving? */
  health: any;
  /** "Acum pe stream" (Twitch title/game + note) and the community goal list. */
  now: { title: string | null; game: string | null; note: string | null } | null;
  together: { hours: number; goals: { title: string; hours: number }[] } | null;
  /** «Replicile lui Iceman»: saved lines per group, the small/large donation threshold, and the text being edited. */
  lines: Partial<Record<LineGroup, string[]>>;
  smallDonation: number;
  linesDraft: Partial<Record<LineGroup, string>> | null;
  /** Twitch-chat echo: the switch, and whether Iceman's token may write in chat (null = not available yet). */
  chat: { on: boolean; canWrite: boolean; connected: boolean; lastAt: string | null } | null;
  /** Which group page is open (live, continut, jocuri, oameni, sponsori, overlay). */
  page: string;
  /** Newest events (public feed), Advent days, Fidelii, legends and badge counts (public_state). */
  feed: TickerItem[];
  advent: AdventDay[];
  adventDraft: AdventDay[] | null;
  adventSel: number;
  loyal: { name: string; hours: number; streak: number; badges: string[] }[];
  boards: { donations: [string, number][]; gifts: [string, number][]; bits: [string, number][] };
  badgeCounts: Record<string, number> | null;
} = { page: 'live', feed: [], advent: [], adventDraft: null, adventSel: 0, loyal: [], boards: { donations: [], gifts: [], bits: [] }, badgeCounts: null, chat: null, lines: {}, smallDonation: 10, linesDraft: null, health: null, now: null, together: null, names: { filtered: [], rules: [] }, me: null, status: null, timer: null, stats: null, round: null, pool: [], scheduled: [], suggestions: [], prizes: [], mods: [], draft: [], goals: [], goalsDraft: null, bingo: null, bingoDraft: null, wheel: [], wheelDraft: null, codes: [], overlayKey: null, report: null };
const bingoRows = () => S.bingoDraft ?? (S.bingo?.items ?? []).map((i) => ({ id: i.id, label: i.label }));
const editBingo = () => { if (!S.bingoDraft) S.bingoDraft = bingoRows(); return S.bingoDraft; };
const goalRows = () => S.goalsDraft ?? S.goals.map((g) => ({ title: g.title, threshold: String(g.threshold), sponsor: g.sponsor ?? '', done: !!g.done_at, clip: g.clip_url ?? '', when: g.scheduled_for ?? '' }));
const wheelRows = () => S.wheelDraft ?? S.wheel.map((p) => ({ short_label: p.short_label, full_label: p.full_label, sponsor: p.sponsor ?? '', is_win: p.is_win, weight: String(p.weight) }));
const editWheel = () => { if (!S.wheelDraft) S.wheelDraft = wheelRows(); return S.wheelDraft; };
/** Sponsor names for the suggestions list: the site's partners plus any already used. */
const sponsorNames = () => [...new Set([site.sponsor.name, ...site.partners.map((p) => p.name), ...((S.report?.sponsors ?? []).map((x: any) => x.sponsor))]
  .filter((n) => n && !n.startsWith('[')))];
const editGoals = () => { if (!S.goalsDraft) S.goalsDraft = goalRows(); return S.goalsDraft; };

// Suggest a round: 2 easy, 2 medium, 1 hard, all from different categories.
function autoDraft() {
  const pick: number[] = [];
  const used = new Set<string>();
  const shuffled = [...S.pool].sort(() => Math.random() - 0.5);
  for (const [level, n] of [['ușor', 2], ['mediu', 2], ['greu', 1]] as const) {
    for (const c of shuffled) {
      if (pick.filter((id) => S.pool.find((p) => p.id === id)?.level === level).length >= n) break;
      if (c.level === level && !used.has(c.category) && !pick.includes(c.id)) { pick.push(c.id); used.add(c.category); }
    }
  }
  S.draft = pick;
}

async function load() {
  if (demoApi) {
    Object.assign(S, demoApi.modState());
    S.names = demoApi.rpc('mod_names', {}) as typeof S.names;
    S.health = demoHealth();
    const site = demoApi.toSiteData();
    S.now = site.now; S.together = site.together;
    S.lines = site.lines; S.smallDonation = site.smallDonation;
    S.chat = demoApi.rpc('mod_chat_status', {}) as typeof S.chat;
    S.feed = site.ticker.filter((x) => x.time !== '—');
    S.advent = site.advent;
    S.loyal = site.loyal;
    const num = (rows: [string, string][]) => rows.map(([n, v]) => [n, Number(String(v).replace(/\./g, ''))] as [string, number]);
    S.boards = { donations: num(site.boards.donations), gifts: num(site.boards.gifts), bits: num(site.boards.bits) };
    S.badgeCounts = site.badgeCounts;
    if (!S.draft.length || S.draft.some((id) => !S.pool.find((p) => p.id === id))) autoDraft();
    return render();
  }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { S.me = null; return render(); }
  const { data: me } = await db.from('viewers').select('login, is_moderator').eq('id', session.user.id).maybeSingle();
  S.me = me;
  if (!me?.is_moderator) return render();

  const [status, timer, stats, rounds, pool, scheduled, suggestions, prizes, mods, goals] = await Promise.all([
    db.rpc('mod_status'),
    db.from('timer').select('*').eq('id', 1).maybeSingle(),
    db.from('stats').select('*').eq('id', 1).maybeSingle(),
    db.from('vote_rounds').select('id, number, closes_at, winner_id, round_challenges(challenge_id, votes, position, challenges(title))').order('number', { ascending: false }).limit(1),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'pool').eq('votable', true).order('id'),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'scheduled').order('id'),
    db.from('suggestions').select('id, body, created_at, viewers(login, display_name)').eq('status', 'pending').order('created_at'),
    db.from('spins').select('id, user_login, created_at, prizes(win_label, is_win)').is('fulfilled_at', null).order('created_at'),
    db.from('viewers').select('login, display_name').eq('is_moderator', true).order('login'),
    db.from('goals').select('title, threshold, unlocked_at, sponsor, done_at, clip_url, scheduled_for').order('position'),
  ]);
  const [wheel, codes, okey, report, names] = await Promise.all([
    db.from('prizes').select('short_label, full_label, win_label, sponsor, is_win, weight').order('position'),
    db.rpc('mod_codes'), db.rpc('mod_overlay_key'), db.rpc('mod_sponsor_report'),
    (db as any).rpc('mod_names'),
  ]);
  S.health = (await (db as any).rpc('mod_health')).data ?? null;
  const ps = (await (db as any).rpc('public_state', { p_have: {} })).data?.parts ?? {};
  S.now = ps.now ?? null; S.together = ps.together ?? null;
  S.lines = ps.lines?.groups ?? {}; S.smallDonation = Number(ps.lines?.smallDonation) || 10;
  S.chat = ((await (db as any).rpc('mod_chat_status')).data as typeof S.chat) ?? null;
  S.feed = (Array.isArray(ps.feed) ? ps.feed : []).map((e: any) => tickerItem({ id: e.id, at: e.at ? Date.parse(e.at) : undefined, kind: e.kind, tier: e.tier,
    quantity: e.quantity, currency: e.currency, seconds_added: e.seconds, user_name: e.name, user_login: null })).filter((x: TickerItem) => x.time !== '—');
  S.advent = (Array.isArray(ps.advent) ? ps.advent : []).map((a: any) => ({ day: Number(a.day), note: a.note ?? '', clip: a.clip ?? null, sponsor: a.sponsor ?? null }));
  S.loyal = Array.isArray(ps.loyal) ? ps.loyal : [];
  const rowsOf = (l: any) => (Array.isArray(l) ? l : []).map((r: any) => [String(r[0]), Number(r[1]) || 0] as [string, number]);
  S.boards = { donations: rowsOf(ps.boards?.donations), gifts: rowsOf(ps.boards?.gifts), bits: rowsOf(ps.boards?.bits) };
  S.badgeCounts = ps.badges ?? null;
  S.names = names.data ?? { filtered: [], rules: [] };
  S.wheel = (wheel.data ?? []) as typeof S.wheel;
  S.codes = (codes.data ?? []) as typeof S.codes;
  S.overlayKey = (okey.data as string | null) ?? null;
  S.report = report.data ?? null;
  S.goals = (goals.data ?? []) as typeof S.goals;
  const [bItems, bSet, bStatus] = await Promise.all([
    db.from('bingo_items').select('id, label, happened_at').order('position'),
    db.from('bingo_settings').select('closes_at, prize, prize_sponsor').eq('id', 1).maybeSingle(),
    db.rpc('mod_bingo_status'),
  ]);
  S.bingo = {
    closes_at: bSet.data?.closes_at ?? null, prize: bSet.data?.prize ?? '', prize_sponsor: bSet.data?.prize_sponsor ?? null,
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
  S.prizes = ((prizes.data ?? []) as any[]).filter((p) => p.prizes?.is_win);
  S.mods = (mods.data ?? []) as any;
  if (!S.draft.length || S.draft.some((id) => !S.pool.find((p) => p.id === id))) autoDraft();
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
    : !C.canWrite ? '<span class="pill warn">Lipsește permisiunea</span> <span class="muted">Iceman reconectează o dată contul de streamer (butonul de la Stare) și aprobă «scrie în chat».</span>'
    : C.on ? `<span class="pill ok">Pornit</span> <span class="muted">Scrie din contul lui Iceman.${C.lastAt ? ` Ultimul mesaj: ${when(C.lastAt)}.` : ''}</span>`
    : '<span class="pill off">Oprit</span>';
  return `<div style="padding:14px 16px;border:1px solid #23415E">
        <label style="display:flex;align-items:center;gap:14px;min-height:44px"><input type="checkbox" data-act="chatToggle" ${C?.on ? 'checked' : ''} ${C && C.canWrite ? '' : 'disabled'} aria-describedby="chat-state chat-warn"><span><strong style="font-family:'Barlow Condensed',sans-serif;font-size:20px;text-transform:uppercase;color:#F2F5FA">Trimite replica și în chatul Twitch</strong><span style="display:block;font-size:14px;color:#AEB8C7">Aceeași replică din balon, din contul lui Iceman, cu @ la cel care a dat și timpul adăugat. Cel mult un mesaj la 5 secunde; un val de subs cadou primește un singur mesaj; numele ascunse nu primesc mesaj.</span></span></label>
        <p id="chat-state" style="margin:8px 0 0;font-size:14px">${state}</p>
        <p id="chat-warn" style="margin:6px 0 0;font-size:14px;color:#F2C14E">Înainte să-l pornești: dacă StreamElements sau Nightbot mulțumesc deja în chat, oamenii primesc două mulțumiri.</p>
        <p style="margin:8px 0 0;font-size:13px;color:#8C97A8">În chat: <span style="color:#EFEFF1"><strong style="color:#9147FF">icemanlucky</strong>: ${esc(preview)}</span></p>
      </div>`;
}

function linesHtml(): string {
  const groups = lineGroups.map((g) => {
    const L = lineInfo(g.id);
    return `<div class="line-group" data-lg="${g.id}" style="padding:18px;background:#0B1018;border:1px solid ${L.border}">
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
    <h2>Replicile lui Iceman</h2>
    <p class="muted" style="margin-top:0;max-width:900px">Ce zice Iceman în balonul din hero când intră ceva. Câte o replică pe rând, minim ${MIN_LINES} pe grup. Site-ul alege una la întâmplare și nu o repetă până nu le folosește pe toate. Poți folosi: <code>{nume}</code> <code>{timp}</code> <code>{suma}</code> <code>{subs}</code>. Maxim ${MAX_LINE} de caractere, ca să încapă în balon. Numele trec prin același filtru ca restul site-ului.</p>
    <div style="margin-top:14px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));gap:12px">
      ${chatHtml()}
      <div style="padding:14px 16px;border:1px solid #23415E">
        <label class="inline">Donație mare de la (€)<input class="field" type="number" inputmode="decimal" min="1" max="10000" id="smallDonation" value="${esc(S.smallDonation)}" style="width:110px"></label>
        <p class="muted" style="margin:8px 0 0;font-size:14px">Sub prag: replicile «Donație mică». De la prag în sus: «Donație mare».</p>
      </div>
    </div>
    <div style="margin-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px">${groups}</div>
    <div class="row">
      <button class="btn-primary" data-act="linesSave">Salvează tot</button>
      ${S.linesDraft ? '<button class="btn-ghost" data-act="linesCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}
    </div>
    <p class="muted">Un grup cu mai puțin de ${MIN_LINES} replici e marcat cu galben și folosește replica de rezervă «${esc(FALLBACK_LINE)}».</p>
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
    httpErrors: [], httpCalls: 120 };
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
  rows.push(live && online && (eAge === null || eAge > 3600) ? ['warn', 'Subs și biți (Twitch)', `Nicio notificare ${ago(eAge)}. Normal dacă nu a venit niciun sub; altfel verifică pe /mod conectarea streamerului.`]
    : ['ok', 'Subs și biți (Twitch)', `Ultima notificare: ${ago(eAge)}.`]);
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
  return `<ul class="list health">${rows.map(([c, name, text]) => `<li><span class="pill ${c}">${label[c]}</span><span class="grow"><strong style="color:#F2F5FA">${esc(name)}</strong><br><span class="muted">${esc(text)}</span></span></li>`).join('')}</ul>`;
}

// ---- Layout: grouped by job (status bar on top, prism menu on the left) ----
const ICONS: Record<string, string> = {
  live: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8',
  continut: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  jocuri: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 3v18M3 12h18',
  oameni: 'M9 11a4 4 0 1 0 0-8a4 4 0 1 0 0 8M2 21c0-4 3-6 7-6s7 2 7 6M17 3.5a4 4 0 0 1 0 7M22 21c0-3-1.5-5-4-5.7',
  sponsori: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z',
  overlay: 'M3 4h18v13H3zM8 21h8M12 17v4',
};
const GROUPS: { id: string; name: string; title: string; lead: string; items: [string, string][] }[] = [
  { id: 'live', name: 'LIVE', title: 'Cronometru și stream', lead: 'Tot ce schimbi aici apare pe site și pe stream în câteva secunde.',
    items: [['cronometru', 'Cronometru'], ['inghetare', 'Îngheață'], ['ora-dubla', 'Ora dublă'], ['acum', 'Acum pe stream'], ['stare', 'Contul de streamer'], ['zona', 'Zonă periculoasă']] },
  { id: 'continut', name: 'CONȚINUT', title: 'Conținut', lead: 'Ce scrie pe site: replicile lui Iceman, milestone-urile, calendarul, votul.',
    items: [['replici', 'Replicile lui Iceman'], ['milestones', 'Milestone Maraton'], ['comunitar', 'Obiectiv comunitar'], ['advent', 'Calendar de Advent'], ['vot', 'Vot și provocări'], ['propuneri', 'Propuneri']] },
  { id: 'jocuri', name: 'JOCURI', title: 'Jocuri', lead: 'Roata, premiile de dat, bingo și codurile secrete.',
    items: [['roata-premii', 'Roata și premiile'], ['premii', 'Premii de dat'], ['bingo', 'Bingo'], ['cod', 'Coduri secrete']] },
  { id: 'oameni', name: 'OAMENI', title: 'Oameni', lead: 'Numele afișate, insignele, legendele și moderatorii.',
    items: [['nume', 'Nume afișate'], ['insigne', 'Insigne și Fidelii'], ['legende', 'Legende'], ['moderatori', 'Moderatori']] },
  { id: 'sponsori', name: 'SPONSORI', title: 'Sponsori', lead: 'Partenerii de pe site și raportul pentru fiecare.',
    items: [['parteneri', 'Parteneri și logo-uri'], ['raport', 'Raport pe sponsor']] },
  { id: 'overlay', name: 'OVERLAY', title: 'Overlay OBS', lead: 'Linkul pentru OBS și variantele lui.',
    items: [['overlay', 'Overlay OBS']] },
];
const groupOf = (id: string) => (id === 'todo' || id === 'sanatate' ? GROUPS[0]
  : GROUPS.find((g) => g.id === id || g.items.some(([i]) => i === id || (i === 'vot' && id === 'provocari'))));

/** How many things wait on each menu item (badges). */
function waiting(id: string): { n: number; warn?: boolean } {
  const raised = Number(S.stats?.raised ?? 0);
  switch (id) {
    case 'replici': return { n: lineGroups.filter((g) => !lineInfo(g.id).ok).length, warn: true };
    case 'milestones': return { n: S.goals.filter((g) => raised >= g.threshold && !g.done_at).length };
    case 'propuneri': return { n: S.suggestions.length };
    case 'premii': return { n: S.prizes.length };
    case 'bingo': return { n: S.bingo?.status.winners.length && !S.bingo.status.draws.length ? S.bingo.status.winners.length : 0 };
    case 'stare': return { n: S.status && !S.status.broadcaster_connected ? 1 : 0, warn: true };
    default: return { n: 0 };
  }
}

function navHtml(): string {
  const cur = decodeURIComponent(location.hash.slice(1)) || GROUPS.find((g) => g.id === S.page)?.items[0][0];
  return GROUPS.map((g) => {
    const on = g.id === S.page;
    return `<div class="ng${on ? ' on' : ''}">
      <a class="ng-head" href="#${g.items[0][0]}" ${on ? 'aria-current="true"' : ''}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[g.id]}"></path></svg><span>${esc(g.name)}</span></a>
      <div class="ng-items">${g.items.map(([id, label]) => {
        const w = waiting(id);
        return `<a href="#${id}" data-nav="${id}"${id === cur ? ' class="cur" aria-current="location"' : ''}>${esc(label)}${w.n ? `<span class="nb${w.warn ? ' warn' : ''}">${w.n}</span>` : ''}</a>`;
      }).join('')}</div>
    </div>`;
  }).join('');
}

/** The menu is one Tab stop: ↑/↓ (←/→ on phones), Home and End move inside it (M5).
    A live refresh re-draws it without taking the focus away. */
function setNav() {
  const had = nav.contains(document.activeElement) ? (document.activeElement as HTMLAnchorElement).getAttribute('href') : null;
  nav.innerHTML = navHtml();
  const links = [...nav.querySelectorAll<HTMLAnchorElement>('a')];
  const home = links.find((a) => a.classList.contains('cur')) ?? links.find((a) => a.closest('.ng.on')) ?? links[0];
  links.forEach((a) => { a.tabIndex = a === home ? 0 : -1; });
  if (had) (links.find((a) => a.getAttribute('href') === had) ?? home)?.focus({ preventScroll: true });
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
    [h.tipeee?.error || tA === null || tA > 90 ? 'bad' : 'ok', 'Donații', short(tA)],
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
  return `<a class="hdots" href="#sanatate">${dots.map(([c, n, v]) => `<span class="hd"><span class="dot ${c}"></span><span class="hd-n">${n}</span><span class="sr-only">: ${state(c)},</span> <span class="muted">${v}</span></span>`).join('')}<span class="hsum ${cls}">${esc(text)}</span></a>`;
}

function barHtml(): string {
  const brand = '<a class="brand" href="#cronometru">ICE<span>MARATON</span> <small>/MOD</small></a>';
  if (!S.me) return brand;
  const who = `<span class="who">${demo ? '<span class="pill ok">Demo</span>' : ''}<span class="avatar" aria-hidden="true">${esc((S.me.login || '?').charAt(0).toUpperCase())}</span><span class="who-n">${esc(S.me.login)}</span><button class="btn-ghost" data-act="logout">Ieși</button></span>`;
  if (!S.me.is_moderator) return brand + '<span class="grow"></span>' + who;
  const t = S.timer ?? {};
  const now = Date.now();
  const live = t.status === 'live';
  const frozen = t.paused_until && Date.parse(t.paused_until) > now;
  const dbl = t.double_from && t.double_until && Date.parse(t.double_until) > now;
  const dblNow = dbl && Date.parse(t.double_from) <= now;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' });
  return `${brand}<span class="sep"></span>
    <span class="pill ${live ? 'bad' : 'off'} skew">${live ? 'LIVE' : t.status === 'ended' ? 'ÎNCHEIAT' : 'CURÂND'}</span>
    <span class="bar-clock" data-left>${live ? left(Date.parse(t.ends_at) - (frozen ? Date.parse(t.paused_until) : now)) : '—'}</span>
    ${live ? (frozen ? `<span class="chip frost">ÎNGHEȚAT PÂNĂ LA ${esc(when(t.paused_until))}</span>` : '<span class="chip run">MERGE</span>') : ''}
    ${dbl ? `<span class="chip dbl">ORA DUBLĂ ${dblNow ? `×2 PÂNĂ LA ${hm(t.double_until)}` : esc(when(t.double_from))}${t.double_sponsor ? ` · ${esc(String(t.double_sponsor).toUpperCase())}` : ''}</span>` : ''}
    <span class="grow"></span>${healthDots()}<span class="sep"></span>${who}`;
}

function unitsHtml(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const u: [string, string][] = [[pad(Math.floor(s / 86400)), 'ZILE'], [pad(Math.floor((s % 86400) / 3600)), 'ORE'], [pad(Math.floor((s % 3600) / 60)), 'MINUTE'], [pad(s % 60), 'SECUNDE']];
  return u.map(([v, l]) => `<div class="unit"><div class="unit-v" data-unit>${v}</div><div class="unit-l">${l}</div></div>`).join('');
}

/** «De făcut acum»: what needs a moderator, from data /mod already has. */
function todoHtml(): string {
  const raised = Number(S.stats?.raised ?? 0);
  const items: { tag: string; cls: string; t: string; d: string; btn: string }[] = [];
  if (S.status && !S.status.broadcaster_connected) items.push({ tag: 'STREAMER', cls: 'bad', t: 'Contul de streamer nu e conectat', d: 'Fără el nu ajung subs, biții și statusul live.', btn: `<a class="btn btn-twitch" href="${esc(S.status.connect_url ?? '#')}">Conectează</a>` });
  for (const p of S.prizes.slice(0, 3)) items.push({ tag: 'PREMIU', cls: 'ok', t: `${p.user_login} · ${p.prizes?.win_label ?? ''}`, d: `Câștigat pe roată ${when(p.created_at)}`, btn: `<button class="btn-primary" data-act="fulfil" data-id="${p.id}">Am dat premiul</button>` });
  if (S.prizes.length > 3) items.push({ tag: 'PREMII', cls: 'ok', t: `Încă ${S.prizes.length - 3} premii de dat`, d: '', btn: '<a class="btn btn-ghost" href="#premii">Vezi toate</a>' });
  S.goals.forEach((g, i) => { if (raised >= g.threshold && !g.done_at) items.push({ tag: 'MILESTONE', cls: 'white', t: `${pad(i + 1)} · ${g.title}`, d: 'Deblocat. Când s-a făcut live, pune linkul clipului.', btn: '<a class="btn btn-ghost" href="#milestones">Marchează făcut</a>' }); });
  const lg = lineGroups.filter((g) => !lineInfo(g.id).ok).length;
  if (lg) items.push({ tag: 'REPLICI', cls: 'warn', t: `${lg} ${lg === 1 ? 'grup are' : 'grupuri au'} sub ${MIN_LINES} replici`, d: `Balonul folosește «${FALLBACK_LINE}» până le completați.`, btn: '<a class="btn btn-ghost" href="#replici">Completează</a>' });
  if (S.suggestions.length) items.push({ tag: 'PROPUNERI', cls: 'off', t: `${S.suggestions.length} ${S.suggestions.length === 1 ? 'propunere nouă' : 'propuneri noi'} de la abonați`, d: '', btn: '<a class="btn btn-ghost" href="#propuneri">Vezi propunerile</a>' });
  const bw = S.bingo?.status.winners.length ?? 0;
  if (bw && !S.bingo?.status.draws.length) items.push({ tag: 'BINGO', cls: 'ok', t: `${bw} cu bingo, gata de tragere`, d: '', btn: '<a class="btn btn-ghost" href="#bingo">Trage la sorți</a>' });
  return `<section class="card todo" id="todo"><h2>De făcut acum${items.length ? ` · ${items.length}` : ''}</h2>
    ${items.length ? items.map((x) => `<div class="todo-i"><p><span class="pill ${x.cls}">${x.tag}</span> <strong>${esc(x.t)}</strong></p>${x.d ? `<p class="muted">${esc(x.d)}</p>` : ''}<div class="row">${x.btn}</div></div>`).join('') : '<p class="muted">Nimic nu așteaptă acum.</p>'}
  </section>`;
}

function feedHtml(): string {
  const now = Date.now();
  return `<section class="card" id="intra"><h2>Intră acum</h2>
    ${S.feed.length ? `<ul class="list feed">${S.feed.slice(0, 8).map((f) => `<li><strong class="ft">${esc(f.time)}</strong><span class="grow"><strong>${esc(f.user)}</strong> <span class="muted">${esc(f.what)}</span></span><span class="muted">${f.at ? esc(agoText(f.at, now)) : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Încă n-a intrat nimic.</p>'}
  </section>`;
}

// ---- Milestones: state, when, clip ----
function milestonesHtml(): string {
  const raised = Number(S.stats?.raised ?? 0);
  const rows = goalRows();
  let nextFound = false;
  return `<section class="card wide" id="milestones">
    <div class="card-head"><h2>Milestone Maraton</h2><span class="muted">Strâns acum: <strong style="color:#F2F5FA">${fmtInt(raised)} €</strong></span></div>
    <p class="muted" style="margin-top:0">Provocările care se deblochează când donațiile ajung la sumă. «Făcut» + link = apare pe site la «Ai ratat? Vezi clipurile». Lista se ordonează singură după sumă.</p>
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

// ---- Advent calendar ----
const roParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest', year: 'numeric', month: '2-digit', day: '2-digit' });
const MONTHS = ['IAN', 'FEB', 'MAR', 'APR', 'MAI', 'IUN', 'IUL', 'AUG', 'SEP', 'OCT', 'NOI', 'DEC'];
const MONTHS_LONG = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const adventRows = () => S.adventDraft ?? S.advent;
function adventDay(n: number) {
  const startAt = S.timer?.starts_at ? Date.parse(S.timer.starts_at) : Date.UTC(2026, 11, 20, 10);
  const [, m, d] = roParts.format(new Date(startAt + (n - 1) * 86_400_000)).split('-').map(Number);
  const dayOf = (ms: number) => { const [y, mm, dd] = roParts.format(new Date(ms)).split('-').map(Number); return Date.UTC(y, mm - 1, dd) / 86_400_000; };
  const today = dayOf(Date.now()) - dayOf(startAt) + 1;
  const md = `${pad(m)}-${pad(d)}`;
  const fixed = n === 1 ? 'Startul' : n === ADVENT_DAYS ? 'Finalul programat' : adventDates[md] ?? '';
  return { short: `${d} ${MONTHS[m - 1]}`, long: `${d} ${MONTHS_LONG[m - 1]}`, fixed, past: n < today, today: n === today };
}
function adventHtml(): string {
  const rows = adventRows();
  const sel = S.adventSel || 1;
  const cur = rows.find((r) => r.day === sel) ?? { day: sel, note: '', clip: null, sponsor: null };
  const info = adventDay(sel);
  const cells = Array.from({ length: ADVENT_DAYS }, (_, k) => {
    const n = k + 1, a = adventDay(n), r = rows.find((x) => x.day === n);
    const note = [r?.note || a.fixed, r?.sponsor ?? ''].filter(Boolean).join(' · ') + (r?.clip ? ' · clip' : '');
    return `<button type="button" class="ad${n === sel ? ' sel' : ''}${a.today ? ' today' : a.past ? ' past' : ''}" data-act="adventPick" data-day="${n}" aria-pressed="${n === sel}"><span class="ad-d">${a.today ? 'AZI · ' : ''}${a.short}</span><span class="ad-n">${pad(n)}</span><span class="ad-t">${esc(note)}</span></button>`;
  }).join('');
  return `<section class="card wide" id="advent">
    <div class="card-head"><h2>Calendar de Advent</h2><span class="muted">Alege o zi, completează, salvează. Zilele fără nimic arată doar data.</span></div>
    <div class="advent-wrap">
      <div class="ad-grid">${cells}</div>
      <div class="ad-edit">
        <p class="ad-title">ZIUA ${pad(sel)} · ${info.long.toUpperCase()}${info.today ? ' · AZI' : info.past ? ' · TRECUTĂ' : ''}</p>
        <label class="inline">Ce e programat (max. 60 de caractere)<input class="field" data-adv="note" maxlength="60" value="${esc(cur.note ?? '')}" placeholder="${esc(info.fixed || 'ex: Provocarea votată')}"></label>
        <label class="inline">Sponsorul zilei<input class="field" data-adv="sponsor" maxlength="60" list="sponsorNames" value="${esc(cur.sponsor ?? '')}" placeholder="opțional"></label>
        <label class="inline">Clipul zilei<input class="field" type="url" data-adv="clip" value="${esc(cur.clip ?? '')}" placeholder="https://clips.twitch.tv/…"></label>
        <div class="row"><button class="btn-primary" data-act="adventSave">Salvează calendarul</button>${S.adventDraft ? '<button class="btn-ghost" data-act="adventCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}</div>
      </div>
    </div>
  </section>`;
}

// ---- Read-only views (Oameni, Sponsori, Overlay) ----
const rankStyle = (i: number) => rankColors[i] === 'prism' ? `background:${PRISM};-webkit-background-clip:text;background-clip:text;color:transparent` : `color:${rankColors[Math.min(i, rankColors.length - 1)]}`;
function insigneHtml(): string {
  const counts = S.badgeCounts;
  return `<section class="card wide" id="insigne">
    <h2>Insigne și Fidelii</h2>
    <p class="muted" style="margin-top:0">Insignele se dau singure, din timpul în chat și din check-in-uri. Aici vezi câți le au și cine stă cel mai mult.</p>
    <ul class="list">${badgeDefs.map((b) => { const [accent, , fg] = tierColors[b.tier]; return `<li><span class="pill" style="background:${b.tier === 'prism' ? PRISM : accent};color:#04101A">${esc(b.label.toUpperCase())}</span><span class="grow muted">${esc(b.how)}</span><strong style="color:${fg}">${counts?.[b.id] !== undefined ? countRo(counts[b.id], 'om', 'oameni') : '—'}</strong></li>`; }).join('')}</ul>
    <h3 class="h3s">Fidelii</h3>
    ${S.loyal.length ? `<ul class="list">${S.loyal.map((l, i) => `<li><span class="rk" style="${rankStyle(i)}">${i + 1}</span><span class="grow"><strong>${esc(l.name)}</strong> <span class="muted">· ${countRo(l.streak, 'zi', 'zile')} la rând</span></span><strong>${countRo(l.hours, 'oră', 'ore')}</strong></li>`).join('')}</ul>` : '<p class="muted">Primii fideli apar după prima oră în chat.</p>'}
  </section>`;
}
function legendeHtml(): string {
  const col = (title: string, rows: [string, number][], unit: string) => `<div><h3 class="h3s">${title}</h3>${rows.length ? `<ul class="list">${rows.slice(0, 5).map(([n, v], i) => `<li><span class="rk" style="${rankStyle(i)}">${i + 1}</span><span class="grow"><strong>${esc(n)}</strong></span><strong>${fmtInt(v)}${unit}</strong></li>`).join('')}</ul>` : '<p class="muted">Încă nimeni.</p>'}</div>`;
  return `<section class="card wide" id="legende">
    <h2>Legende</h2>
    <p class="muted" style="margin-top:0">Top 5 pe tot maratonul, ca pe site. Un nume nepotrivit se ascunde din «Nume afișate».</p>
    <div class="cols3">${col('Donatori', S.boards.donations, ' €')}${col('Subs dăruite', S.boards.gifts, ' subs')}${col('Biți', S.boards.bits, '')}</div>
  </section>`;
}
function parteneriHtml(): string {
  const tile = (name: string, role: string, logo: string) => `<li><span class="grow"><strong>${esc(name)}</strong>${role ? ` <span class="muted">· ${esc(role)}</span>` : ''}</span><span class="pill ${logo ? 'ok' : 'warn'}">${logo ? 'logo pus' : 'fără logo'}</span></li>`;
  return `<section class="card wide" id="parteneri">
    <h2>Parteneri și logo-uri</h2>
    <p class="muted" style="margin-top:0">Așa apar pe site. Numele, logo-urile și linkurile se schimbă în <code>src/data/site.ts</code>: trimite-i-le lui Claude (logo SVG sau PNG, ideal și varianta albă).</p>
    <h3 class="h3s">Partener principal</h3><ul class="list">${tile(site.sponsor.name, `cod ${site.sponsor.code}`, site.sponsor.logo)}</ul>
    <h3 class="h3s">Parteneri</h3><ul class="list">${site.partners.map((p) => tile(p.name, p.role, p.logo)).join('')}</ul>
    <h3 class="h3s">Susținători</h3><ul class="list">${site.supporters.map((p, i) => tile(p.name || `Locul ${i + 1} (liber)`, '', p.logo)).join('')}</ul>
  </section>`;
}
function overlayHtml(): string {
  const base = location.origin + '/overlay/';
  const key = S.overlayKey;
  const v = (q: string) => base + '?' + [key ? `key=${key}` : '', q].filter(Boolean).join('&');
  const rows: [string, string][] = [
    ['Scena întreagă (de bază): cronometrul, milestone-ul, orele împreună, balonul lui Iceman și momentele', v('')],
    ['La fel, cu mai puțină mișcare (fără ninsoare și sărituri)', v('calm=1')],
    ['Scena de pauză «Revin imediat» (o scenă separată în OBS)', v('scene=brb')],
    ['Doar cronometrul și momentele (fără balon și fără ore împreună)', v('show=timer,moments,code')],
    ['Banda subțire veche, în colțul din dreapta sus', v('style=strip')],
    ['Cutia mare veche', v('style=box')],
  ];
  return `<section class="card wide" id="overlay">
    <h2>Overlay OBS</h2>
    <p class="muted" style="margin-top:0">În OBS: Browser Source, 1920×1080, cu unul din linkurile de mai jos. ${key ? '<strong style="color:#FF8A95">Linkurile au cheia privată: nu le da nimănui.</strong>' : 'Fără cheie, codurile secrete nu apar pe stream.'}</p>
    <ul class="list">${rows.map(([label, url], i) => `<li><span class="grow"><strong>${esc(label)}</strong><br><input class="field" readonly value="${esc(url)}" id="ov${i}" aria-label="${esc(label)}" style="width:100%;margin-top:6px"></span><button class="btn-ghost" data-act="copyOv" data-i="${i}">Copiază</button></li>`).join('')}</ul>
    <p class="muted">Momentele apar pe rând, în mijloc: viscol la valuri de subs cadou, milestone deblocat, legendă nouă, insignă de 50 sau 100 de ore, bingo, câștigătoarea votului, roata când cineva învârte pe site, momente mari (50 €+, 5.000 de biți). Codul secret apare calm, în stânga jos, doar cu linkul cu cheie.</p>
  </section>`;
}

/** Values the moderator changed in this page's own fields (by id), not yet sent. */
function typedValues(): Map<string, string> {
  const out = new Map<string, string>();
  app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input[id], textarea[id], select[id]').forEach((el) => {
    if ((el as HTMLInputElement).readOnly || (el as HTMLInputElement).type === 'checkbox') return;
    const dirty = el instanceof HTMLSelectElement
      ? [...el.options].some((o) => o.selected !== o.defaultSelected)
      : el.value !== el.defaultValue;
    if (dirty) out.set(el.id, el.value);
  });
  return out;
}
/** Set after an action succeeded: the next render starts the forms afresh. */
let resetTyped = false;

// ---- M3: unsaved changes. A card is «NESALVAT» while it holds a list draft or a field
// whose value differs from what was loaded; leaving the page then asks first. ----
const draftCards = (): Record<string, unknown> => ({ replici: S.linesDraft, milestones: S.goalsDraft, advent: S.adventDraft, bingo: S.bingoDraft, 'roata-premii': S.wheelDraft });
function fieldChanged(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean {
  if ((el as HTMLInputElement).readOnly || el.disabled || el.closest('dialog')) return false;
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return false;
  return el instanceof HTMLSelectElement ? [...el.options].some((o) => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
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
app.addEventListener('change', markUnsaved);
window.addEventListener('beforeunload', (e) => {
  if (!app.querySelector('.card.dirty') && !Object.values(draftCards()).some(Boolean)) return;
  e.preventDefault();
  e.returnValue = '';
});

function render() {
  const active = document.activeElement;
  if (active && app.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) { deferred = true; return; }
  const isMod = !!S.me?.is_moderator;
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
  const poolOptions = (sel: number) => S.pool.map((c) =>
    `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.level)} · ${esc(c.title)}</option>`).join('');

  setNav();
  const sec: Record<string, () => string> = {
    'stare': () => `
    <section class="card" id="stare">
      <h2>Contul de streamer</h2>
      <div class="row">
        <span class="pill ${live ? 'bad' : 'off'}">${live ? 'LIVE' : t.status === 'ended' ? 'Încheiat' : 'Începe curând'}</span>
        <span class="pill ${t.stream_online ? 'ok' : 'off'}">Stream ${t.stream_online ? 'online' : 'offline'}</span>
        <span class="pill ${st?.broadcaster_connected ? 'ok' : 'bad'}">Streamer ${st?.broadcaster_connected ? 'conectat' : 'neconectat'}</span>
      </div>
      <p class="big" style="margin:14px 0 4px" data-left>${live ? left(remaining) : '—'}</p>
      <p class="muted" style="margin:0">Subs: <strong style="color:#F2F5FA">${S.stats?.subs ?? 0}</strong> · Biți: ${S.stats?.bits ?? 0} · Strâns: ${S.stats?.raised ?? 0} €</p>
      ${t.paused_until && Date.parse(t.paused_until) > now ? `<p style="margin:6px 0 0"><span class="pill ok">Înghețat</span> până la ${when(t.paused_until)}. Subs și donațiile adaugă timp în continuare.</p>` : ''}
      <p class="muted" style="margin:4px 0 0">Start: ${when(t.starts_at)} · Final programat: ${when(t.scheduled_end)}${t.double_from ? ` · Ora dublă: ${when(t.double_from)}–${when(t.double_until)}` : ''}</p>
      <div class="row">
        <a class="btn btn-${st?.broadcaster_connected ? 'ghost' : 'twitch'}" href="${esc(st?.connect_url ?? '#')}">${st?.broadcaster_connected ? 'Reconectează contul de streamer' : 'Conectează contul de streamer'}</a>
      </div>
      <p class="muted">Doar ${esc(st?.broadcaster_login ?? 'streamerul')} poate face asta, o singură dată. Așa ajung pe site subs, gift-urile, biții și statusul live.</p>
    </section>`,
    'cronometru': () => `
    <section class="card wide" id="cronometru">
      <div class="card-head"><h2>Cronometru</h2><span class="muted">Final programat: <strong style="color:#F2F5FA">${when(t.scheduled_end)}</strong></span></div>
      <div class="units" aria-label="Timp rămas">${live ? unitsHtml(remaining) : '<p class="muted" style="margin:0">Cronometrul pornește odată cu subathonul.</p>'}</div>
      ${live ? `
        <div class="row">
          <div class="quick">
            <button class="btn-ghost" data-act="add" data-min="1">+1 min</button>
            <button class="btn-ghost" data-act="add" data-min="5">+5 min</button>
            <button class="btn-ghost" data-act="add" data-min="10">+10 min</button>
            <button class="btn-ghost" data-act="add" data-min="-5">−5 min</button>
          </div>
          <div class="pair">
            <input class="field" type="number" inputmode="numeric" id="addMin" placeholder="min" aria-label="Minute de adăugat">
            <button class="btn-primary" data-act="addCustom">Adaugă</button>
          </div>
        </div>
      ` : `

        <p class="muted" style="margin-top:0">Înainte de start: data și ora de start (pentru numărătoarea inversă) și finalul programat.</p>
        <div class="row">
          <label class="inline">Start<input class="field" type="datetime-local" id="startAt"></label>
          <label class="inline">Final programat<input class="field" type="datetime-local" id="endAt"></label>
          <button class="btn-ghost" data-act="schedule">Salvează</button>
        </div>
        <div class="row">
          <label class="inline">Ore pe cronometru la start<input class="field" type="number" id="startHours" value="24" step="0.5"></label>
          <button class="btn-primary" data-act="start">Pornește acum</button>
        </div>
      `}
    </section>`,
    // M2: ending is irreversible, so it lives apart from the time buttons and asks for a typed word.
    'zona': () => `
    <section class="card danger" id="zona">
      <h2>Zonă periculoasă</h2>
      ${live
        ? `<p style="margin:0">«Încheie subathonul» oprește cronometrul pentru totdeauna: site-ul și overlay-ul arată «Încheiat», iar subs și donațiile nu mai adaugă timp. Nu se poate anula de aici.</p>
           <div class="row"><button class="btn-ghost btn-danger" data-act="end">Încheie subathonul…</button></div>`
        : `<p class="muted" style="margin:0">Butonul de încheiere apare aici doar cât timp cronometrul merge.</p>`}
    </section>`,
    'inghetare': () => `
    <section class="card" id="inghetare">
      <h2>Îngheață</h2>
      <p class="muted" style="margin-top:0">Cronometrul stă pe loc. Subs și donațiile adaugă timp în continuare.${t.paused_until && Date.parse(t.paused_until) > now ? ` <span class="pill ok">Înghețat</span> până la <strong style="color:#F2F5FA">${when(t.paused_until)}</strong>.` : ''}</p>
      ${live ? `
        <div class="row">
          <div class="pair">
            <input class="field" type="number" inputmode="numeric" id="freezeMin" value="5" aria-label="Minute înghețat">
            <button class="btn-ghost" data-act="freeze">Îngheață (minute)</button>
          </div>
        </div>
        <div class="row">
          <label class="inline">Îngheață până la<input class="field" type="datetime-local" id="freezeUntil"></label>
          <button class="btn-ghost" data-act="freezeUntil">Îngheață până atunci</button>
          ${t.paused_until && Date.parse(t.paused_until) > now ? '<button class="btn-ghost" data-act="unfreeze">Dezgheață acum</button>' : ''}
        </div>
` : '<p class="muted">Se poate îngheța după ce pornește cronometrul.</p>'}
    </section>`,
    'ora-dubla': () => `
    <section class="card" id="ora-dubla">
      <h2>Ora dublă</h2>
      <p class="muted" style="margin-top:0">${t.double_from ? `${Date.parse(t.double_until) > now ? (Date.parse(t.double_from) <= now ? '<span class="pill ok">Acum</span>' : '<span class="pill off">Programată</span>') : '<span class="pill off">Ultima</span>'} ${when(t.double_from)}–${when(t.double_until)}${t.double_sponsor ? ` · oferită de <strong style="color:#E6C46A">${esc(t.double_sponsor)}</strong>` : ''}` : 'Nicio oră dublă programată.'}</p>
      ${live ? `
        <div class="row">
          <label class="inline">Ora dublă de la<input class="field" type="datetime-local" id="dblFrom"></label>
          <label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="dblMin" value="60"></label>
          <label class="inline">Oferită de (sponsor)<input class="field" id="dblSponsor" list="sponsorNames" placeholder="opțional" value="${esc(t.double_sponsor ?? '')}"></label>
          <button class="btn-ghost" data-act="double">Programează</button>
          <button class="btn-ghost" data-act="doubleNow">Ora dublă acum</button>
        </div>
` : '<p class="muted">Se programează după ce pornește cronometrul.</p>'}
    </section>`,
    'acum': () => `
    <section class="card" id="acum">
      <h2>Acum pe stream</h2>
      <p class="muted" style="margin-top:0">De pe Twitch: <strong style="color:#F2F5FA">${esc(S.now?.title ?? '—')}</strong>${S.now?.game ? ` · ${esc(S.now.game)}` : ''}. Se actualizează singur la 5 minute.</p>
      ${S.now?.note ? `<p><span class="pill ok">Notă</span> ${esc(S.now.note)}</p>` : ''}
      <div class="row">
        <input class="field" id="nowNote" placeholder="ex: Pauză de masă, revin în 15 min" maxlength="140" aria-label="Notă scurtă pe site" style="flex:1 1 260px;min-width:0">
        <input class="field" type="number" id="nowMin" value="30" min="1" max="1440" aria-label="Câte minute">
        <button class="btn-primary" data-act="noteSet">Arată pe site</button>
        ${S.now?.note ? '<button class="btn-ghost" data-act="noteClear">Scoate nota</button>' : ''}
      </div>
      <p class="muted">Nota înlocuiește titlul de pe Twitch, pe site, pentru câte minute alegi.</p>
    </section>`,
    'comunitar': () => `
    <section class="card" id="comunitar">
      <h2>Obiectiv comunitar</h2>
      <p class="muted" style="margin-top:0">Ore privite împreună până acum: <strong style="color:#F2F5FA">${S.together ? Math.round(S.together.hours) : 0} h</strong>.</p>
      <textarea class="field" id="togetherList" rows="5" aria-label="Obiective comunitare, câte unul pe rând: ore | titlu" style="width:100%;padding:10px;font:inherit">${esc((S.together?.goals ?? []).map((g) => `${g.hours} | ${g.title}`).join('\n'))}</textarea>
      <div class="row"><button class="btn-primary" data-act="togetherSave">Salvează obiectivele</button></div>
      <p class="muted">Câte unul pe rând: <strong>ore | ce se deblochează</strong>, de exemplu «500 | Karaoke cu chatul». Gratuit pentru toți: se numără orele din chat cât e live.</p>
    </section>`,
    'replici': () => `
    ${linesHtml()}`,
    'bingo': () => `
    ${S.bingo ? (() => {
      const B = S.bingo!;
      const open = !B.closes_at || Date.parse(B.closes_at) > now;
      const happened = (id?: number) => !!B.items.find((i) => i.id === id)?.happened_at;
      return `<section class="card wide" id="bingo">
      <h2>Bingo</h2>
      <p class="muted" style="margin-top:0">${B.status.players} jucători · ${open ? `alegerile se închid la <strong style="color:#F2F5FA">${when(B.closes_at)}</strong>` : '<strong style="color:#F2F5FA">alegerile s-au închis</strong>'}. Fiecare jucător alege 5 evenimente; cine le are pe toate 5 bifate intră la tragere.</p>
      <div class="row">
        <label class="inline">Alegerile se închid la<input class="field" type="datetime-local" id="bingoClose" value="${toLocal(B.closes_at)}"></label>
        <label class="inline" style="flex:1 1 220px">Premiul<input class="field" id="bingoPrize" value="${esc(B.prize)}" maxlength="120"></label>
        <label class="inline" style="flex:1 1 180px">Premiul e de la<input class="field" id="bingoPrizeSponsor" list="sponsorNames" value="${esc(B.prize_sponsor ?? '')}" maxlength="60" placeholder="sponsor (opțional)"></label>
        <button class="btn-ghost" data-act="bingoSettings">Salvează</button>
      </div>
      <h3 style="margin:20px 0 0;font-family:'Barlow Condensed',sans-serif;font-size:18px;text-transform:uppercase">Cartonașul (25 = 5×5, rând cu rând) · bifează când se întâmplă</h3>
      <p class="muted" style="margin:4px 0 0">Ordinea de aici e ordinea de pe cartonaș: primele 5 = rândul 1, următoarele 5 = rândul 2 etc. ${bingoRows().length !== 25 ? `<strong style="color:#FF8A95">Acum sunt ${bingoRows().length}; trebuie exact 25.</strong>` : ''}</p>
      <ul class="list">${bingoRows().map((r, i) => `<li>
        ${r.id !== undefined ? `<button class="${happened(r.id) ? 'btn-primary' : 'btn-ghost'}" data-act="bingoTick" data-id="${r.id}" data-on="${happened(r.id) ? '0' : '1'}" aria-pressed="${happened(r.id)}">${happened(r.id) ? '✓ S-a întâmplat' : 'Bifează'}</button>` : '<span class="pill off">nou</span>'}
        <input class="field grow" data-bingo-label="${i}" value="${esc(r.label)}" maxlength="80" aria-label="Evenimentul ${i + 1}" style="flex:1 1 200px;min-width:0">
        <button class="btn-ghost" data-act="bingoDel" data-i="${i}">Șterge</button></li>`).join('')}</ul>
      <div class="row">
        <button class="btn-ghost" data-act="bingoAdd">Adaugă eveniment</button>
        <button class="btn-primary" data-act="bingoSaveList">Salvează lista</button>
        ${S.bingoDraft ? '<button class="btn-ghost" data-act="bingoCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}
      </div>
      <h3 style="margin:24px 0 0;font-family:'Barlow Condensed',sans-serif;font-size:18px;text-transform:uppercase">Tragerea la sorți</h3>
      <p class="muted" style="margin-top:4px">${B.status.winners.length ? `${B.status.winners.length} cu bingo: ${B.status.winners.map((w) => esc(w.login)).join(', ')}` : 'Nimeni nu are încă toate cele 5 evenimente bifate.'}</p>
      <div class="row"><button class="btn-primary" data-act="bingoDraw" ${B.status.winners.length ? '' : 'disabled'}>Trage la sorți</button></div>
      ${B.status.draws.length ? `<p style="margin:10px 0 0">Extrași: ${B.status.draws.map((d) => `<strong>${esc(d.login)}</strong>${d.drawn_at ? ` <span class="muted">(${when(d.drawn_at)})</span>` : ''}`).join(' · ')}</p>` : ''}
    </section>`;
    })() : ''}`,
    'roata-premii': () => `
    <section class="card wide" id="roata-premii">
      <h2>Premiile roții</h2>
      <p class="muted" style="margin-top:0">8 felii, în ordinea de pe roată. «Pe roată» = textul scurt de pe felie (max. 16 caractere). Pune sponsorul la premiile oferite de el: apare pe site și pe stream «de la …». Șansa = cât de des iese felia (0 = niciodată).</p>
      <ul class="list">${wheelRows().map((p, i) => `<li>
        <span class="muted" style="flex:0 0 22px">${i + 1}</span>
        <input class="field" data-wheel="short_label" data-i="${i}" value="${esc(p.short_label)}" maxlength="16" aria-label="Pe roată, felia ${i + 1}" style="flex:0 1 130px;min-width:0">
        <input class="field" data-wheel="full_label" data-i="${i}" value="${esc(p.full_label)}" maxlength="80" aria-label="Premiul, felia ${i + 1}" style="flex:1 1 200px;min-width:0">
        <input class="field" data-wheel="sponsor" data-i="${i}" value="${esc(p.sponsor)}" list="sponsorNames" maxlength="60" placeholder="de la (sponsor)" aria-label="Sponsorul, felia ${i + 1}" style="flex:0 1 170px;min-width:0">
        <label style="display:inline-flex;align-items:center;gap:6px;min-height:44px"><input type="checkbox" data-wheel="is_win" data-i="${i}" ${p.is_win ? 'checked' : ''}> câștig</label>
        <label style="display:inline-flex;align-items:center;gap:6px">șansa<input class="field" type="number" min="0" max="9999" data-wheel="weight" data-i="${i}" value="${esc(p.weight)}" style="width:80px"></label>
      </li>`).join('')}</ul>
      <div class="row"><button class="btn-primary" data-act="wheelSave">Salvează premiile</button>${S.wheelDraft ? '<button class="btn-ghost" data-act="wheelCancel">Renunță</button><span class="muted">Modificări nesalvate</span>' : ''}</div>
    </section>`,
    'cod': () => `
    <section class="card wide" id="cod">
      <h2>Cod secret</h2>
      ${(() => {
        const cur = S.codes.find((c) => c.expires_at && Date.parse(c.expires_at) > now);
        return cur ? `<p style="margin:0"><span class="pill ok">Pe stream acum</span></p>
          <p class="big" style="margin:10px 0 4px;letter-spacing:.06em">${esc(cur.code)}</p>
          <p class="muted" style="margin:0">${cur.sponsor ? `oferit de <strong style="color:#F2F5FA">${esc(cur.sponsor)}</strong> · ` : ''}valabil până la ${when(cur.expires_at)} · ${cur.claims} revendicări</p>
          <div class="row"><button class="btn-ghost" data-act="codeEnd">Oprește codul</button></div>`
          : '<p class="muted" style="margin-top:0">Niciun cod pe stream acum. Arată unul în timpul unui moment cu sponsorul: cine îl scrie pe site primește o rotire bonus.</p>';
      })()}
      <div class="row">
        <label class="inline" style="flex:1 1 200px">Oferit de<input class="field" id="codeSponsor" list="sponsorNames" value="${esc(site.sponsor.name)}" maxlength="60"></label>
        <label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="codeMin" value="10" min="1" max="60"></label>
        <button class="btn-primary" data-act="codeShow">Arată un cod nou pe stream</button>
      </div>
      ${S.overlayKey ? `<p class="muted" style="margin:14px 0 0">Ca să apară codul pe stream, overlay-ul din OBS trebuie să aibă cheia: <strong style="color:#FF8A95">nu da linkul ăsta nimănui</strong>.</p>
        <div class="row"><input class="field" id="overlayLink" readonly value="${esc(location.origin + '/overlay/?key=' + S.overlayKey)}" style="flex:1 1 280px;min-width:0" aria-label="Linkul de overlay cu cheie"><button class="btn-ghost" data-act="copyOverlay">Copiază linkul pentru OBS</button></div>` : ''}
      ${S.codes.length ? `<ul class="list">${S.codes.slice(0, 8).map((c) => `<li><span class="grow"><strong>${esc(c.code)}</strong>${c.sponsor ? ` · ${esc(c.sponsor)}` : ''}<br><span class="muted">${when(c.shown_at)}</span></span><span>${c.claims} revendicări</span></li>`).join('')}</ul>` : ''}
    </section>`,
    'raport': () => `
    <section class="card wide" id="raport">
      <h2>Raport pentru sponsori</h2>
      ${(() => {
        const R = S.report;
        if (!R) return '<p class="muted">Se încarcă…</p>';
        const fmt = (n: any) => (n === null || n === undefined ? '—' : Number(n).toLocaleString('ro-RO'));
        return `<p class="muted" style="margin-top:0">Vârf de viewers în chat: <strong style="color:#F2F5FA">${fmt(R.peak_chatters)}</strong> · ore privite în total: <strong style="color:#F2F5FA">${fmt(R.watch_hours)}</strong> · strâns: <strong style="color:#F2F5FA">${fmt(R.raised)} €</strong>. Click-urile se numără o dată pe vizită, fără date personale.</p>
        ${(R.sponsors ?? []).length ? `<ul class="list">${R.sponsors.map((x: any, i: number) => `<li style="align-items:flex-start">
          <span class="grow"><strong style="font-size:18px">${esc(x.sponsor)}</strong><br>
          <span class="muted">Click-uri pe link: <strong style="color:#F2F5FA">${fmt(x.clicks)}</strong> · cod de reducere copiat: <strong style="color:#F2F5FA">${fmt(x.code_copies)}</strong> · coduri secrete: ${fmt(x.codes_shown)} afișate, <strong style="color:#F2F5FA">${fmt(x.code_claims)}</strong> revendicări · ore duble: ${fmt(x.double_hours)} (donat în ele: <strong style="color:#F2F5FA">${fmt(x.donated_in_hours)} €</strong>, vârf ${fmt(x.peak_in_hours)} viewers) · premii câștigate: ${fmt(x.wins)} · milestones: ${fmt(x.milestones_unlocked)} / ${fmt(x.milestones)}</span></span>
          <button class="btn-ghost" data-act="copyReport" data-i="${i}">Copiază</button></li>`).join('')}</ul>` : '<p class="muted">Încă nimic de raportat. Apare aici după ce pui sponsori pe premii, ore duble sau coduri.</p>'}`;
      })()}
    </section>`,
    'vot': () => `
    <section class="card wide" id="vot">
      <h2>Runda de vot</h2>
      ${S.round ? `
        <p class="muted" style="margin-top:0">Runda ${S.round.number} · ${roundOpen ? `se închide la ${when(S.round.closes_at)}` : 'închisă'} · ${totalVotes} voturi</p>
        <ul class="list">${S.round.items.map((x) => `<li><span class="grow">${esc(x.title)}${S.round!.winner_id === x.challenge_id ? ' <span class="pill ok">câștigă</span>' : ''}</span><strong>${x.votes}</strong><span class="muted">${totalVotes ? Math.round((x.votes / totalVotes) * 100) : 0}%</span></li>`).join('')}</ul>
        ${roundOpen ? `<div class="row"><button class="btn-primary" data-act="closeRound" data-id="${S.round.id}">Închide runda acum</button><span class="muted">Se închide singură la final și alege câștigătoarea.</span></div>` : ''}
      ` : '<p class="muted" style="margin-top:0">Nicio rundă încă.</p>'}
      ${!roundOpen ? `
        <h2 style="margin-top:20px">Rundă nouă</h2>
        <p class="muted" style="margin-top:0">Propunere automată: 2 ușoare, 2 medii, 1 grea, din categorii diferite. Schimbă ce vrei.</p>
        ${S.draft.map((id, i) => `<div class="row"><select class="field" data-draft="${i}" aria-label="Provocarea ${i + 1}">${poolOptions(id)}</select></div>`).join('')}
        <div class="row">
          <button class="btn-ghost" data-act="reroll">Alege altele</button>
          <label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="roundMin" value="60"></label>
          <button class="btn-primary" data-act="openRound">Deschide runda</button>
        </div>` : ''}
    </section>`,
    'provocari': () => `
    <section class="card" id="provocari">
      <h2>Provocări câștigătoare</h2>
      ${S.scheduled.length ? `<ul class="list">${S.scheduled.map((c) => `<li>
        <span class="grow">${esc(c.title)}</span>
        <span class="pair"><input class="field" data-when="${c.id}" value="${esc(c.scheduled_for ?? '')}" placeholder="ex: Diseară, 22:00" aria-label="Când">
        <button class="btn-ghost" data-act="setWhen" data-id="${c.id}">Salvează</button></span>
        <span class="pair"><input class="field" type="url" data-clip="${c.id}" placeholder="Link clip (opțional)" aria-label="Link clip">
        <button class="btn-primary" data-act="done" data-id="${c.id}">Făcută</button>
        <button class="btn-ghost" data-act="veto" data-id="${c.id}">Veto</button></span></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Nimic programat.</p>'}
    </section>`,
    'propuneri': () => `
    <section class="card" id="propuneri">
      <h2>Propuneri (${S.suggestions.length})</h2>
      ${S.suggestions.length ? `<ul class="list">${S.suggestions.map((s) => `<li class="acts-row">
        <span class="grow">${esc(s.body)}<br><span class="muted">${esc(s.viewers?.display_name ?? s.viewers?.login ?? '')} · ${when(s.created_at)}</span></span>
        <button class="btn-primary" data-act="approve" data-id="${s.id}">Aprobă</button>
        <button class="btn-ghost" data-act="reject" data-id="${s.id}">Respinge</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Nicio propunere nouă.</p>'}
    </section>`,
    'premii': () => `
    <section class="card" id="premii">
      <h2>Premii de dat (${S.prizes.length})</h2>
      ${S.prizes.length ? `<ul class="list">${S.prizes.map((p) => `<li>
        <span class="grow"><strong>${esc(p.user_login)}</strong> · ${esc(p.prizes?.win_label ?? '')}<br><span class="muted">${when(p.created_at)}</span></span>
        <button class="btn-primary" data-act="fulfil" data-id="${p.id}">Dat</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Toate premiile au fost date.</p>'}
    </section>`,
    'nume': () => `
    <section class="card" id="nume">
      <h2>Nume afișate public</h2>
      <p class="muted" style="margin-top:0">Numele cu cuvinte urâte, linkuri, e-mailuri sau numere de telefon apar automat ca «Anonim» pe site și pe stream. Contribuțiile se numără la fel.</p>
      ${S.names.filtered.length ? `<h3 style="margin:12px 0 6px;font-size:15px">Ascunse automat (${S.names.filtered.length})</h3>
      <ul class="list">${S.names.filtered.map((n) => `<li><span class="grow">${esc(n)}</span><button class="btn-ghost" data-act="nameAllow" data-name="${esc(n)}">E în regulă, arată-l</button></li>`).join('')}</ul>` : '<p class="muted">Niciun nume ascuns automat.</p>'}
      ${S.names.rules.length ? `<h3 style="margin:12px 0 6px;font-size:15px">Reguli</h3>
      <ul class="list">${S.names.rules.map((r) => `<li><span class="grow">${esc(r.name)} <span class="muted">· ${({ hide: 'ascuns de un moderator', allow: 'permis de un moderator', opt_out: 'ascuns la cererea lui' })[r.rule]}</span></span>${r.rule === 'opt_out' ? '' : `<button class="btn-ghost" data-act="nameClear" data-name="${esc(r.name)}">Șterge regula</button>`}</li>`).join('')}</ul>` : ''}
      <div class="row">
        <div class="pair">
          <input class="field" id="hideName" placeholder="nume sau login" aria-label="Numele de ascuns" autocapitalize="none" autocorrect="off" spellcheck="false">
          <button class="btn-primary" data-act="nameHide">Ascunde</button>
        </div>
      </div>
      <p class="muted">Ascunde un nume nepotrivit care a scăpat filtrului. Cine vrea să nu apară își poate ascunde singur numele pe site, sub clasament.</p>
    </section>`,
    'moderatori': () => `
    <section class="card" id="moderatori">
      <h2>Moderatori</h2>
      <ul class="list">${S.mods.map((m) => `<li><span class="grow">${esc(m.display_name ?? m.login)}</span>${m.login === S.me!.login ? '<span class="muted">tu</span>' : `<button class="btn-ghost" data-act="unmod" data-login="${esc(m.login)}">Scoate</button>`}</li>`).join('')}</ul>
      <div class="row">
        <div class="pair">
          <input class="field" id="newMod" placeholder="login Twitch" aria-label="Login Twitch" autocapitalize="none" autocorrect="off" spellcheck="false">
          <button class="btn-primary" data-act="mod">Adaugă</button>
        </div>
      </div>
      <p class="muted">Merge și înainte ca persoana să se fi conectat pe site.</p>
    </section>`,
    milestones: milestonesHtml,
    advent: adventHtml,
    insigne: insigneHtml,
    legende: legendeHtml,
    parteneri: parteneriHtml,
    overlay: overlayHtml,
  };
  const page = GROUPS.find((g) => g.id === S.page) ?? GROUPS[0];
  const cards = page.items.flatMap(([id]) => (id === 'vot' ? ['vot', 'provocari'] : [id])).map((id) => sec[id]?.() ?? '').join('\n');
  // A live refresh (every sub re-draws the page) must not undo what a moderator
  // typed but hasn't sent yet: «Îngheață 120 min» would quietly become the default 5.
  const typed = resetTyped ? new Map<string, string>() : typedValues();
  resetTyped = false;
  app.innerHTML = `
  <datalist id="sponsorNames">${sponsorNames().map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
  <div class="page-head">
    <div><span class="tag-ice">${esc(page.name)}</span><h1>${esc(page.title)}</h1></div>
    <p class="muted">${esc(page.lead)}</p>
  </div>
  ${page.id === 'live' ? `<div class="live-cols"><div class="grid">${cards}</div><aside class="aside">${todoHtml()}${feedHtml()}<section class="card" id="sanatate"><h2>Conexiuni</h2>${healthHtml(S.health)}<p class="muted">Se actualizează singur la un minut.</p></section></aside></div>`
    : `<div class="grid">${cards}</div>`}`;
  for (const [id, v] of typed) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (el && app.contains(el)) el.value = v;
  }
  markUnsaved();
  // Opened with #section in the address: scroll there once the page exists.
  if (scrollTo) { const el = document.getElementById(scrollTo); scrollTo = ''; el?.scrollIntoView({ block: 'start' }); }
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
  schedule: () => call('mod_set_schedule', { p_starts_at: fromLocal(val('startAt')), p_scheduled_end: fromLocal(val('endAt')) }, 'Programul a fost salvat.'),
  start: () => confirm(`Pornești cronometrul acum cu ${num('startHours')} ore?`) &&
    call('mod_start_timer', { p_hours: num('startHours'), p_scheduled_end: S.timer?.scheduled_end ?? null }, 'Subathonul a pornit!'),
  add: (el) => call('mod_add_time', { p_minutes: Number(el.dataset.min) }, `${el.dataset.min} min adăugate.`),
  addCustom: () => num('addMin') && call('mod_add_time', { p_minutes: num('addMin') }, `${num('addMin')} min adăugate.`),
  freeze: () => call('mod_freeze', { p_minutes: num('freezeMin') }, 'Cronometrul e înghețat.'),
  freezeUntil: () => val('freezeUntil') && call('mod_freeze_until', { p_until: fromLocal(val('freezeUntil')) }, 'Cronometrul e înghețat până atunci.'),
  unfreeze: () => confirm('Dezgheți cronometrul acum?') && call('mod_unfreeze', {}, 'Cronometrul merge din nou.'),
  bingoSettings: () => call('mod_bingo_settings', { p_closes_at: fromLocal(val('bingoClose')), p_prize: val('bingoPrize'), p_prize_sponsor: val('bingoPrizeSponsor') }, 'Setările de bingo au fost salvate.'),
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
  copyOverlay: () => { const v = val('overlayLink'); void navigator.clipboard?.writeText(v).then(() => say('Link copiat. Pune-l în OBS ca Browser Source, 1920×1080.')); },
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
  bingoAdd: () => { editBingo().push({ label: '' }); render(); },
  bingoDel: (el) => { editBingo().splice(Number(el.dataset.i), 1); render(); },
  bingoCancel: () => { S.bingoDraft = null; render(); },
  bingoSaveList: async () => {
    const list = bingoRows().filter((r) => r.label.trim()).map((r) => (r.id !== undefined ? { id: r.id, label: r.label.trim() } : { label: r.label.trim() }));
    await call('mod_bingo_set_items', { p_items: list }, 'Lista de bingo a fost salvată.');
    S.bingoDraft = null;
  },
  bingoDraw: async () => {
    if (!confirm('Tragi la sorți un câștigător dintre cei cu bingo?')) return;
    const won = await call('mod_bingo_draw', {}, 'Tragere făcută.');
    if (won) alert(`Câștigătorul: ${won}`);
  },
  double: () => call('mod_double_hour', { p_from: fromLocal(val('dblFrom')), p_minutes: num('dblMin'), p_sponsor: val('dblSponsor') }, 'Ora dublă programată.'),
  doubleNow: () => call('mod_double_hour', { p_from: new Date().toISOString(), p_minutes: num('dblMin') || 60, p_sponsor: val('dblSponsor') }, 'Ora dublă a început.'),
  end: () => openEndDialog(),
  endConfirm: () => {
    if (!endWordOk()) return;
    endDlg.close();
    return call('mod_end_timer', {}, 'Subathonul s-a încheiat.');
  },
  closeRound: (el) => call('mod_close_round', { p_round: Number(el.dataset.id) }, 'Runda s-a închis.'),
  reroll: () => { autoDraft(); render(); },
  openRound: () => {
    const ids = [...document.querySelectorAll<HTMLSelectElement>('[data-draft]')].map((s) => Number(s.value));
    if (new Set(ids).size !== ids.length) { say('Ai ales aceeași provocare de două ori.', true); return; }
    return call('mod_open_round', { p_challenges: ids, p_minutes: num('roundMin') || 60 }, 'Runda e deschisă.');
  },
  setWhen: (el) => call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'scheduled', p_scheduled_for: (document.querySelector<HTMLInputElement>(`[data-when="${el.dataset.id}"]`)?.value ?? '') || null }, 'Salvat.'),
  done: (el) => {
    const clip = (document.querySelector<HTMLInputElement>(`[data-clip="${el.dataset.id}"]`)?.value ?? '').trim();
    if (clip && !/^https:\/\//.test(clip) && !(demo && clip === '#')) { say('Linkul clipului trebuie să înceapă cu https://', true); return; }
    return call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'done', p_clip: clip || null }, 'Marcată ca făcută.');
  },
  veto: (el) => confirm('Veto pe provocarea asta?') && call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'vetoed' }, 'Veto.'),
  approve: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: true }, 'Aprobată: e acum în lista de provocări.'),
  reject: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: false }, 'Respinsă.'),
  fulfil: (el) => call('mod_fulfil_spin', { p_id: Number(el.dataset.id) }, 'Premiu marcat ca dat.'),
  goalAdd: () => { editGoals().push({ title: '', threshold: '', sponsor: '', done: false, clip: '', when: '' }); render(); },
  goalDone: (el) => { const g = editGoals()[Number(el.dataset.i)]; g.done = !g.done; render(); },
  adventPick: (el) => { S.adventSel = Number(el.dataset.day) || 1; render(); },
  adventCancel: () => { S.adventDraft = null; render(); },
  adventSave: async () => {
    const list = adventRows().filter((d) => d.note || d.clip || d.sponsor)
      .map((d) => ({ day: d.day, note: (d.note ?? '').trim(), clip: (d.clip ?? '').trim(), sponsor: (d.sponsor ?? '').trim() }));
    if (list.some((d) => d.clip && !/^https:\/\//.test(d.clip) && !(demo && d.clip === '#'))) { say('Linkul clipului trebuie să înceapă cu https://', true); return; }
    await call('mod_set_advent', { p_days: list }, 'Calendarul a fost salvat. Apare pe site în câteva secunde.');
    S.adventDraft = null;
  },
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
    if (on && !confirm('Pornești replicile în chatul Twitch, din contul lui Iceman? Verifică întâi că niciun bot nu mulțumește deja în chat.')) { (el as HTMLInputElement).checked = false; return; }
    return call('mod_set_chat_echo', { p_on: on }, on ? 'Replicile apar și în chatul Twitch.' : 'Replicile nu mai apar în chat.');
  },
  noteSet: () => val('nowNote').trim() && call('mod_set_note', { p_note: val('nowNote'), p_minutes: Number(val('nowMin')) || 30 }, 'Nota apare pe site.'),
  noteClear: () => call('mod_set_note', { p_note: '', p_minutes: 1 }, 'Nota a fost scoasă.'),
  togetherSave: () => {
    const list = val('togetherList').split('\n').map((l) => l.split('|')).filter((p) => p.length >= 2)
      .map(([h, ...t]) => ({ hours: Math.round(Number(h.trim())), title: t.join('|').trim() })).filter((g) => g.hours > 0 && g.title);
    return call('mod_set_community_goals', { p_goals: list }, 'Obiectivele comunitare au fost salvate.');
  },
  nameHide: () => val('hideName').trim() && call('mod_name_rule', { p_name: val('hideName'), p_rule: 'hide' }, 'Numele e ascuns peste tot.'),
  nameAllow: (el) => call('mod_name_rule', { p_name: el.dataset.name, p_rule: 'allow' }, 'Numele apare din nou.'),
  nameClear: (el) => call('mod_name_rule', { p_name: el.dataset.name, p_rule: null }, 'Regula a fost ștearsă.'),
  mod: () => val('newMod').trim() && call('mod_set_moderator', { p_login: val('newMod'), p_on: true }, 'Moderator adăugat.'),
  unmod: (el) => confirm(`Scoți moderatorul ${el.dataset.login}?`) && call('mod_set_moderator', { p_login: el.dataset.login, p_on: false }, 'Moderator scos.'),
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
  if (el.dataset.adv !== undefined) {
    const k = el.dataset.adv as 'note' | 'clip' | 'sponsor';
    const day = S.adventSel || 1;
    if (!S.adventDraft) S.adventDraft = S.advent.map((d) => ({ ...d }));
    let row = S.adventDraft.find((d) => d.day === day);
    if (!row) { row = { day, note: '', clip: null, sponsor: null }; S.adventDraft.push(row); }
    (row as any)[k] = el.value;
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
  const s = Math.max(0, Math.floor(ms / 1000));
  const v = [pad(Math.floor(s / 86400)), pad(Math.floor((s % 86400) / 3600)), pad(Math.floor((s % 3600) / 60)), pad(s % 60)];
  app.querySelectorAll<HTMLElement>('[data-unit]').forEach((el, i) => { if (el.textContent !== v[i]) el.textContent = v[i]; });
}, 1000);

// Pages: the hash names a section (#bingo); its group's page opens and scrolls to it.
let scrollTo = decodeURIComponent(location.hash.slice(1));
function route(scroll: boolean) {
  const id = decodeURIComponent(location.hash.slice(1));
  const g = id ? groupOf(id) : null;
  if (g && g.id !== S.page) { S.page = g.id; deferred = false; if (S.me) render(); }
  else if (S.me?.is_moderator) setNav();
  if (scroll && id) requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    // Keyboard and screen-reader users land in the section they asked for (M5).
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  });
  // Phone: the menu is one scrolling row; slide it so the open group is in view.
  requestAnimationFrame(() => {
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
