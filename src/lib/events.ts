// How an event (sub, gift, bits, donation…) reads in the ticker, the "+time"
// chips and the overlay. Shared by the live data (Supabase) and the demo.

import type { TickerItem } from '../data/types';
import { count, fmtInt, plusTime } from './format';

export interface EventLike {
  kind: string;
  tier: string | null;
  quantity: number | string;
  currency: string | null;
  seconds_added: number;
  user_name: string | null;
  user_login: string | null;
}

const amount = (n: number) => (Number.isInteger(n) ? fmtInt(n) : n.toLocaleString('ro-RO', { maximumFractionDigits: 2 }));
const tierName = (tier: string | null) => (tier === 'prime' ? 'Prime' : `Tier ${{ '2000': 2, '3000': 3 }[tier ?? ''] ?? 1}`);

export function describe(e: EventLike): string {
  const n = Number(e.quantity);
  switch (e.kind) {
    case 'sub': return `sub ${tierName(e.tier)}`;
    case 'resub': return `resub ${tierName(e.tier)}`;
    case 'gift': return n === 1 ? 'a dăruit un sub' : `a dăruit ${count(n, 'sub', 'subs')}`;
    case 'bits': return count(n, 'bit', 'biți');
    case 'donation': return `donație ${amount(n)} ${!e.currency || e.currency === 'RON' ? 'lei' : e.currency}`;
    default: return 'timp adăugat';
  }
}

export function tickerItem(e: EventLike): TickerItem {
  return {
    time: e.seconds_added > 0 ? plusTime(e.seconds_added) : '—',
    user: e.user_name || e.user_login || 'Anonim',
    what: describe(e),
    color: ['sub', 'resub', 'gift'].includes(e.kind) ? 'var(--ice)' : '#FFFFFF',
  };
}

export { amount };
