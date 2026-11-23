// The countdown viewers see: derived from the server's end time and the (corrected) clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, initialState } from '../src/lib/derive';
import { emptyData } from '../src/data/sample';
import type { SiteData } from '../src/data/types';

const NOW = Date.UTC(2026, 11, 21, 18, 0, 0);
const at = (patch: Partial<SiteData>, now = NOW) => derive({ ...initialState(), now }, { ...emptyData(), loaded: true, ...patch });
const clock = (v: ReturnType<typeof derive>) => v.navClock;

test('before the first answer the page says it is loading, never «starts soon»', () => {
  const v = derive({ ...initialState(), now: NOW }, emptyData());
  assert.equal(v.statusText, 'SE ÎNCARCĂ');
  assert.equal(v.timerLabelUp, 'SE ÎNCARCĂ');
  assert.equal(clock(v), '--:--:--:--');
  const r = derive({ ...initialState(), now: NOW, connFailures: 2 }, emptyData());
  assert.equal(r.statusText, 'REÎNCERCĂM');
  assert.equal(r.timerLabel, 'Fără conexiune');
});

test('live: remaining time = end − now', () => {
  const v = at({ status: 'live', startsAt: NOW - 3600e3, endsAt: NOW + (2 * 86400 + 3 * 3600 + 4 * 60 + 5) * 1000 });
  assert.equal(clock(v), '02:03:04:05');
  assert.equal(v.statusText, 'LIVE');
});

test('frozen: the clock stands still until the freeze ends, then resumes', () => {
  const d = { status: 'live' as const, startsAt: 0, pausedUntil: NOW + 3600e3, endsAt: NOW + 3600e3 + 600e3 };
  assert.equal(clock(at(d)), '00:00:10:00');
  assert.equal(clock(at(d, NOW + 1800e3)), '00:00:10:00');
  assert.equal(clock(at(d, NOW + 3600e3 + 60e3)), '00:00:09:00');
  assert.ok(at(d).isFrozen);
});

test('zero never goes negative; ended shows zero', () => {
  assert.equal(clock(at({ status: 'live', startsAt: 0, endsAt: NOW - 5000 })), '00:00:00:00');
  assert.equal(clock(at({ status: 'ended', startsAt: 0, endsAt: NOW - 3600e3 })), '00:00:00:00');
  assert.equal(at({ status: 'ended' }).statusText, 'ÎNCHEIAT');
});

test('very long marathons show all the days', () => {
  assert.equal(clock(at({ status: 'live', startsAt: 0, endsAt: NOW + 400 * 86400e3 })), '400:00:00:00');
});

test('upcoming counts down to the start', () => {
  const v = at({ status: 'upcoming', startsAt: NOW + 90e3 });
  assert.equal(clock(v), '00:00:01:30');
  assert.equal(v.timerLabelUp, 'ÎNCEPE ÎN');
});
