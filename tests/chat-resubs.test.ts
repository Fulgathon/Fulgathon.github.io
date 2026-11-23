// Resubs nobody shared are read from the subscriber badge in chat
// (supabase/functions/_shared/badges.ts; counting rules in 20261128100000_chat_resubs.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subBadge } from '../supabase/functions/_shared/badges';

test('subscriber badge: months from info, tier from the badge id', () => {
  assert.deepEqual(subBadge([{ set_id: 'subscriber', id: '12', info: '14' }]), { months: 14, tier: '1000' });
  assert.deepEqual(subBadge([{ set_id: 'moderator', id: '1' }, { set_id: 'subscriber', id: '2006', info: '7' }]), { months: 7, tier: '2000' });
  assert.deepEqual(subBadge([{ set_id: 'subscriber', id: '3024', info: '25' }]), { months: 25, tier: '3000' });
});

test('founder badge counts too', () => {
  assert.deepEqual(subBadge([{ set_id: 'founder', id: '0', info: '30' }]), { months: 30, tier: '1000' });
});

test('no subscriber badge, or no months: nothing to report', () => {
  assert.equal(subBadge(undefined), null);
  assert.equal(subBadge([]), null);
  assert.equal(subBadge([{ set_id: 'vip', id: '1' }]), null);
  assert.equal(subBadge([{ set_id: 'subscriber', id: '0', info: '' }]), null);
  assert.equal(subBadge([{ set_id: 'subscriber', id: '0', info: '0' }]), null);
});
