// The empty first-paint state, and the design's pre-ticked bingo squares for
// ?demo. The design's sample subathon itself now seeds the demo backend
// (src/demo/backend.ts); live visitors get Supabase data (src/scripts/live.ts).

import { defaultGoals, defaultPrizes } from './content';
import type { SiteData } from './types';

/** The design's pre-ticked bingo squares (demo only). */
export const sampleBingoMarked = [true, false, false, false, false, true, false, false, false, false, true, false, false, false, false, false];

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
    raised: '0 lei',
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
    boards: { gifts: [], bits: [], hours: [] },
  };
}
