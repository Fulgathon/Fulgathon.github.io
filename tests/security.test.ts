// Clip links typed on /mod end up in href on every viewer's page: only http(s) may pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeUrl } from '../src/lib/format';
import { views } from '../src/lib/views';
import { derive, initialState } from '../src/lib/derive';
import { emptyData } from '../src/data/sample';

test('safeUrl keeps http(s), "#" and same-site paths', () => {
  assert.equal(safeUrl('https://clips.twitch.tv/abc'), 'https://clips.twitch.tv/abc');
  assert.equal(safeUrl('  http://x.ro/a  '), 'http://x.ro/a');
  assert.equal(safeUrl('#'), '#');
  assert.equal(safeUrl('/sponsori/'), '/sponsori/');
});

test('safeUrl drops script and protocol-relative links', () => {
  for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<b>', 'vbscript:x', '//evil.example', '/\\evil.example',
    'https://x.ro/\u0000a', 'ftp://x.ro', '', null, undefined]) {
    assert.equal(safeUrl(bad as string), null, String(bad));
  }
});

test('a javascript: clip never reaches the page as a link', () => {
  const d = { ...emptyData(), loaded: true, status: 'live' as const, startsAt: 0, endsAt: Date.now() + 3600e3, raisedNum: 1e6,
    completed: [{ title: 'Provocare', when: 'ZIUA 1', clip: 'javascript:alert(1)' }],
    goals: emptyData().goals.map((g) => ({ ...g, doneAt: Date.now(), clip: 'javascript:alert(2)' })),
    advent: [{ day: 1, note: 'x', clip: 'javascript:alert(3)', sponsor: null }] };
  const v = derive({ ...initialState(), now: Date.now() + 40 * 86_400_000 }, d);
  const html = Object.values(views).map((fn) => (fn as (x: typeof v) => string)(v)).join('');
  assert.ok(html.length > 1000);
  assert.ok(!/javascript:/i.test(html), 'no javascript: anywhere in the rendered regions');
});

test('names are escaped in every region', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const d = { ...emptyData(), loaded: true, status: 'live' as const, startsAt: 0, endsAt: Date.now() + 3600e3,
    boards: { donations: [[evil, '5']], gifts: [[evil, '5']], bits: [[evil, '5']], hours: [[evil, '5']] } as never,
    ticker: [{ id: 1, user: evil, what: evil, time: '+6:00', color: '#fff' }] as never,
    loyal: [{ name: evil, hours: 3, streak: 1, badges: ['og'] }] };
  const v = derive({ ...initialState(), now: Date.now() }, d);
  const html = Object.values(views).map((fn) => (fn as (x: typeof v) => string)(v)).join('');
  assert.ok(!html.includes('<img src=x'), 'raw tag never rendered');
});
