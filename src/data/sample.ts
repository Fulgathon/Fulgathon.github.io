// The empty first-paint state. The design's sample subathon itself now seeds the demo backend
// (src/demo/backend.ts); live visitors get Supabase data (src/scripts/live.ts).

import { bingoItems, defaultGoals, defaultPrizes } from './content';
import type { SiteData } from './types';


/** What the page shows before anything has loaded: upcoming, nothing yet. */
export function emptyData(): SiteData {
  return {
    status: 'upcoming',
    startsAt: null,
    endsAt: null,
    pausedUntil: null,
    scheduledEnd: null,
    doubleFrom: null,
    doubleUntil: null,
    subs: 0,
    raised: '0 €',
    raisedNum: 0,
    goals: defaultGoals,
    ticker: [],
    pops: [],
    round: null,
    challenges: [],
    upNext: [],
    completed: [],
    prizes: defaultPrizes,
    losePrize: 7,
    recentWins: [],
    boards: { donations: [], gifts: [], bits: [], hours: [] },
    bingo: { closesAt: null, prize: '', players: 0, items: bingoItems.map((label, i) => ({ id: i + 1, label, happened: false })) },
    today: null,
    loyal: [],
    together: null,
    now: null,
  };
}
