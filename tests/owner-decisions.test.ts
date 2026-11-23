// Owner decisions of 23 Nov 2026 (docs/BUGS.md): «zero is final, protect Iceman, euros only».
// The page logic (derive) and the demo backend, which follows the same rules as the database
// (supabase/migrations/20261127100000_owner_decisions.sql; SQL checks in supabase/tests/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, initialState } from '../src/lib/derive';
import { emptyData } from '../src/data/sample';
import type { SiteData } from '../src/data/types';
import { DemoBackend } from '../src/demo/backend';

// The demo backend expects a browser: give it just enough (no storage, no BroadcastChannel,
// so nothing keeps the test process alive).
(globalThis as any).window = { addEventListener() {} };
(globalThis as any).BroadcastChannel = undefined;

const NOW = Date.UTC(2026, 11, 21, 18, 0, 0);
const at = (patch: Partial<SiteData>, now = NOW) => derive({ ...initialState(), now }, { ...emptyData(), loaded: true, ...patch });
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as Error).message; } };
const liveDemo = (endsInMs: number) => {
  const api = new DemoBackend('test');
  api.reset();
  (api as any).mutate((s: any) => { s.timer.status = 'live'; s.timer.endsAt = Date.now() + endsInMs; s.timer.pausedUntil = null; s.timer.doubleFrom = null; s.timer.doubleUntil = null; });
  return api;
};

test('B-08 page: at zero the marathon reads as ended, not LIVE', () => {
  const v = at({ status: 'live', startsAt: 0, endsAt: NOW - 2000 });
  assert.equal(v.navClock, '00:00:00:00');
  assert.equal(v.statusText, 'ÎNCHEIAT');
  assert.equal(v.timerLabel, 'Timpul a expirat');
  assert.equal(v.isEnded, true);
  assert.equal(v.isLive, false);
  assert.equal(v.calcAtOn, false);
  assert.equal(v.nextOn, false);
  assert.equal(at({ status: 'live', startsAt: 0, endsAt: NOW - 2000, doubleFrom: NOW + 3600e3, doubleUntil: NOW + 7200e3 }).hasDouble, false);
});

test('B-08 page: one second before zero it is still live; a freeze keeps it live', () => {
  assert.equal(at({ status: 'live', startsAt: 0, endsAt: NOW + 1500 }).statusText, 'LIVE');
  const frozen = at({ status: 'live', startsAt: 0, endsAt: NOW + 600e3, pausedUntil: NOW + 300e3 });
  assert.equal(frozen.statusText, 'LIVE');
  assert.equal(frozen.isEnded, false);
});

test('B-08 demo: an event after zero adds nothing and ends the marathon', () => {
  const api = liveDemo(-5000);
  const before = api.state.timer.endsAt;
  const ev = api.recordEvent('donation', 'andreiGG', null, 20, 'EUR');
  assert.equal(ev.seconds_added, 0);
  assert.equal(api.state.timer.endsAt, before);
  assert.equal(api.state.timer.status, 'ended');
});

test('B-08 demo: before zero an event still adds time', () => {
  const api = liveDemo(60_000);
  const ev = api.recordEvent('donation', 'andreiGG', null, 5, 'EUR');
  assert.equal(ev.seconds_added, 30 * 60);
  assert.equal(api.state.timer.status, 'live');
});

test('B-08 demo: «+ min» and «Îngheață» refuse at zero', () => {
  const api = liveDemo(-5000);
  assert.equal(code(() => api.rpc('mod_add_time', { p_minutes: 10 })), 'timer_ended');
  assert.equal(code(() => api.rpc('mod_freeze', { p_minutes: 10 })), 'timer_ended');
});

test('B-30 demo: Iceman can\'t be removed from the moderators; others can', () => {
  const api = liveDemo(60_000);
  assert.equal(code(() => api.rpc('mod_set_moderator', { p_login: 'IcemanLucky ', p_on: false })), 'protected_broadcaster');
  assert.ok(api.state.mods.includes('icemanlucky'));
  assert.equal(code(() => api.rpc('mod_set_moderator', { p_login: 'Rares1337', p_on: false })), null);
});

test('B-09 demo: only euros count; another currency is refused', () => {
  const api = liveDemo(60_000);
  const raised = api.state.stats.raised;
  assert.equal(code(() => api.recordEvent('donation', 'x', null, 50, 'RON')), 'not_eur');
  assert.equal(api.state.stats.raised, raised);
  assert.equal(code(() => api.recordEvent('donation', 'x', null, 5, 'eur')), null);
});
