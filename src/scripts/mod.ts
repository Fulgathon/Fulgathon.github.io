// Moderator page logic. Reads with the moderator's own session (row level
// security lets moderators see suggestions and viewers) and acts through the
// mod_* database functions, which re-check moderator rights every time.
// /mod/?demo runs on the simulated backend instead (no login, shared with
// /?demo, /overlay/?demo and /prezentare/).

import { createClient } from '@supabase/supabase-js';
import { site } from '../data/site';
import type { DemoBackend } from '../demo/backend';
import { esc } from '../lib/views';

const demo = new URLSearchParams(location.search).has('demo');
let demoApi: DemoBackend | null = null;

const db = createClient(site.supabase.url, site.supabase.publishableKey, {
  auth: { persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const app = document.getElementById('app')!;
const who = document.getElementById('who')!;
const dock = document.getElementById('dock')!;
const dockState = document.getElementById('dockState')!;
const dockClock = document.getElementById('dockClock')!;
const msgBox = document.getElementById('msg')!;

const errors: Record<string, string> = {
  not_moderator: 'Contul tău nu e moderator.',
  timer_not_live: 'Cronometrul nu e pornit.',
  round_already_open: 'Există deja o rundă deschisă. Închide-o mai întâi.',
  need_two_challenges: 'Alege cel puțin 2 provocări.',
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
} = { me: null, status: null, timer: null, stats: null, round: null, pool: [], scheduled: [], suggestions: [], prizes: [], mods: [], draft: [] };

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
    if (!S.draft.length || S.draft.some((id) => !S.pool.find((p) => p.id === id))) autoDraft();
    return render();
  }
  const { data: { session } } = await db.auth.getSession();
  if (!session) { S.me = null; return render(); }
  const { data: me } = await db.from('viewers').select('login, is_moderator').eq('id', session.user.id).maybeSingle();
  S.me = me;
  if (!me?.is_moderator) return render();

  const [status, timer, stats, rounds, pool, scheduled, suggestions, prizes, mods] = await Promise.all([
    db.rpc('mod_status'),
    db.from('timer').select('*').eq('id', 1).maybeSingle(),
    db.from('stats').select('*').eq('id', 1).maybeSingle(),
    db.from('vote_rounds').select('id, number, closes_at, winner_id, round_challenges(challenge_id, votes, position, challenges(title))').order('number', { ascending: false }).limit(1),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'pool').eq('votable', true).order('id'),
    db.from('challenges').select('id, title, level, category, status, scheduled_for').eq('status', 'scheduled').order('id'),
    db.from('suggestions').select('id, body, created_at, viewers(login, display_name)').eq('status', 'pending').order('created_at'),
    db.from('spins').select('id, user_login, created_at, prizes(win_label, is_win)').is('fulfilled_at', null).order('created_at'),
    db.from('viewers').select('login, display_name').eq('is_moderator', true).order('login'),
  ]);
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

// ---- Rendering ----
// Don't wipe a field the moderator is typing in; re-render when they leave it.
let deferred = false;
app.addEventListener('focusout', () => { if (deferred) { deferred = false; setTimeout(render, 0); } });
function render() {
  const active = document.activeElement;
  if (active && app.contains(active) && /^(INPUT|SELECT|TEXTAREA)$/.test(active.tagName)) { deferred = true; return; }
  who.innerHTML = S.me
    ? `${demo ? '<span class="pill ok">Demo</span>' : ''}<span class="muted">Conectat ca <strong style="color:#F2F5FA">${esc(S.me.login)}</strong></span><button class="btn-ghost" data-act="logout">Ieși</button>`
    : '';

  dock.hidden = !S.me?.is_moderator;
  if (!S.me) {
    app.innerHTML = `<div class="card" style="margin-top:20px"><h2>Conectează-te</h2>
      <p>Pagina e pentru moderatorii FULGATHON. Intră cu contul de Twitch.</p>
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
  dockState.textContent = live ? 'LIVE' : t.status === 'ended' ? 'Încheiat' : 'Curând';
  dockState.className = `pill ${live ? 'bad' : 'off'}`;
  dockClock.textContent = live ? left(remaining) : '—';
  const roundOpen = S.round && Date.parse(S.round.closes_at) > now;
  const totalVotes = S.round?.items.reduce((a, x) => a + x.votes, 0) ?? 0;
  const poolOptions = (sel: number) => S.pool.map((c) =>
    `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.level)} · ${esc(c.title)}</option>`).join('');

  app.innerHTML = `
  <div class="grid">
    <section class="card" id="stare">
      <h2>Stare</h2>
      <div class="row">
        <span class="pill ${live ? 'bad' : 'off'}">${live ? 'LIVE' : t.status === 'ended' ? 'Încheiat' : 'Începe curând'}</span>
        <span class="pill ${t.stream_online ? 'ok' : 'off'}">Stream ${t.stream_online ? 'online' : 'offline'}</span>
        <span class="pill ${st?.broadcaster_connected ? 'ok' : 'bad'}">Streamer ${st?.broadcaster_connected ? 'conectat' : 'neconectat'}</span>
      </div>
      <p class="big" style="margin:14px 0 4px" data-left>${live ? left(remaining) : '—'}</p>
      <p class="muted" style="margin:0">Subs: <strong style="color:#F2F5FA">${S.stats?.subs ?? 0}</strong> · Biți: ${S.stats?.bits ?? 0} · Strâns: ${S.stats?.raised ?? 0} lei</p>
      <p class="muted" style="margin:4px 0 0">Start: ${when(t.starts_at)} · Final programat: ${when(t.scheduled_end)}${t.double_from ? ` · Ora dublă: ${when(t.double_from)}–${when(t.double_until)}` : ''}</p>
      <div class="row">
        <a class="btn btn-${st?.broadcaster_connected ? 'ghost' : 'twitch'}" href="${esc(st?.connect_url ?? '#')}">${st?.broadcaster_connected ? 'Reconectează contul de streamer' : 'Conectează contul de streamer'}</a>
      </div>
      <p class="muted">Doar ${esc(st?.broadcaster_login ?? 'streamerul')} poate face asta, o singură dată. Așa ajung pe site subs, gift-urile, biții și statusul live.</p>
    </section>

    <section class="card" id="cronometru">
      <h2>Cronometru</h2>
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
        <div class="row">
          <div class="pair">
            <input class="field" type="number" inputmode="numeric" id="freezeMin" value="5" aria-label="Minute înghețat">
            <button class="btn-ghost" data-act="freeze">Îngheață cronometrul</button>
          </div>
        </div>
        <div class="row">
          <label class="inline">Ora dublă de la<input class="field" type="datetime-local" id="dblFrom"></label>
          <label class="inline">Minute<input class="field" type="number" inputmode="numeric" id="dblMin" value="60"></label>
          <button class="btn-ghost" data-act="double">Programează</button>
          <button class="btn-ghost" data-act="doubleNow">Ora dublă acum</button>
        </div>
        <div class="row"><button class="btn-ghost" data-act="end" style="border-color:#D5162B">Încheie subathonul</button></div>
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
    </section>

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
    </section>

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
    </section>

    <section class="card" id="propuneri">
      <h2>Propuneri (${S.suggestions.length})</h2>
      ${S.suggestions.length ? `<ul class="list">${S.suggestions.map((s) => `<li class="acts-row">
        <span class="grow">${esc(s.body)}<br><span class="muted">${esc(s.viewers?.display_name ?? s.viewers?.login ?? '')} · ${when(s.created_at)}</span></span>
        <button class="btn-primary" data-act="approve" data-id="${s.id}">Aprobă</button>
        <button class="btn-ghost" data-act="reject" data-id="${s.id}">Respinge</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Nicio propunere nouă.</p>'}
    </section>

    <section class="card" id="premii">
      <h2>Premii de dat (${S.prizes.length})</h2>
      ${S.prizes.length ? `<ul class="list">${S.prizes.map((p) => `<li>
        <span class="grow"><strong>${esc(p.user_login)}</strong> · ${esc(p.prizes?.win_label ?? '')}<br><span class="muted">${when(p.created_at)}</span></span>
        <button class="btn-primary" data-act="fulfil" data-id="${p.id}">Dat</button></li>`).join('')}</ul>`
        : '<p class="muted" style="margin-top:0">Toate premiile au fost date.</p>'}
    </section>

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
    </section>
  </div>`;
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
  double: () => call('mod_double_hour', { p_from: fromLocal(val('dblFrom')), p_minutes: num('dblMin') }, 'Ora dublă programată.'),
  doubleNow: () => call('mod_double_hour', { p_from: new Date().toISOString(), p_minutes: num('dblMin') || 60 }, 'Ora dublă a început.'),
  end: () => confirm('Sigur închei subathonul? Cronometrul se oprește.') && call('mod_end_timer', {}, 'Subathonul s-a încheiat.'),
  closeRound: (el) => call('mod_close_round', { p_round: Number(el.dataset.id) }, 'Runda s-a închis.'),
  reroll: () => { autoDraft(); render(); },
  openRound: () => {
    const ids = [...document.querySelectorAll<HTMLSelectElement>('[data-draft]')].map((s) => Number(s.value));
    if (new Set(ids).size !== ids.length) { say('Ai ales aceeași provocare de două ori.', true); return; }
    return call('mod_open_round', { p_challenges: ids, p_minutes: num('roundMin') || 60 }, 'Runda e deschisă.');
  },
  setWhen: (el) => call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'scheduled', p_scheduled_for: (document.querySelector<HTMLInputElement>(`[data-when="${el.dataset.id}"]`)?.value ?? '') || null }, 'Salvat.'),
  done: (el) => call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'done', p_clip: document.querySelector<HTMLInputElement>(`[data-clip="${el.dataset.id}"]`)?.value ?? null }, 'Marcată ca făcută.'),
  veto: (el) => confirm('Veto pe provocarea asta?') && call('mod_set_challenge', { p_id: Number(el.dataset.id), p_status: 'vetoed' }, 'Veto.'),
  approve: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: true }, 'Aprobată: e acum în lista de provocări.'),
  reject: (el) => call('mod_review_suggestion', { p_id: Number(el.dataset.id), p_approve: false }, 'Respinsă.'),
  fulfil: (el) => call('mod_fulfil_spin', { p_id: Number(el.dataset.id) }, 'Premiu marcat ca dat.'),
  mod: () => val('newMod').trim() && call('mod_set_moderator', { p_login: val('newMod'), p_on: true }, 'Moderator adăugat.'),
  unmod: (el) => confirm(`Scoți moderatorul ${el.dataset.login}?`) && call('mod_set_moderator', { p_login: el.dataset.login, p_on: false }, 'Moderator scos.'),
};

document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-act]');
  if (!el) return;
  void Promise.resolve(acts[el.dataset.act!]?.(el)).catch(() => {});
});
document.addEventListener('change', (e) => {
  const sel = (e.target as Element).closest<HTMLSelectElement>('[data-draft]');
  if (sel) S.draft[Number(sel.dataset.draft)] = Number(sel.value);
});

// Live countdown on the page, plus realtime refresh.
setInterval(() => {
  const el = app.querySelector<HTMLElement>('[data-left]');
  const t = S.timer;
  if (!el || t?.status !== 'live' || !t.ends_at) return;
  const now = Date.now();
  el.textContent = dockClock.textContent = left(Date.parse(t.ends_at) - (t.paused_until && Date.parse(t.paused_until) > now ? Date.parse(t.paused_until) : now));
}, 1000);

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
  ch.subscribe();
  db.auth.onAuthStateChange(() => refresh());
  void load();
}
