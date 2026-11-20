// Sample data from the design's renderVals(). Only used with ?demo; normal
// visitors get live data from Supabase (src/scripts/live.ts).

import { defaultGoals, defaultPrizes } from './content';
import type { SiteData } from './types';

const remainingSeconds = 3 * 86400 + 14 * 3600 + 27 * 60 + 52;
const startsInSeconds = 6 * 86400 + 9 * 3600 + 41 * 60 + 8;
const roundOffset = 2538;

/** The design's sample, with times made absolute from `now`. */
export function sampleData(now: number): SiteData {
  return {
    status: 'live',
    startsAt: now + startsInSeconds * 1000,
    endsAt: now + remainingSeconds * 1000,
    pausedUntil: null,
    scheduledEnd: null,
    subs: 1284,
    raised: '24.600 lei',
    goals: defaultGoals,
    ticker: [
      { time: '+10:00', user: 'snowdrift_tv', what: 'a dăruit 10 suburi', color: 'var(--ice)' },
      { time: '+5:00', user: 'frostbyte_77', what: 'sub Tier 3', color: 'var(--ice)' },
      { time: '+1:00', user: 'mistletoe_mike', what: 'donație 25 lei', color: '#FFFFFF' },
      { time: '+2:00', user: 'polarpixel', what: 'sub Tier 2', color: 'var(--ice)' },
      { time: '+1:00', user: 'kxtrin', what: 'sub Prime', color: 'var(--ice)' },
      { time: '+1:00', user: 'northpole_nik', what: '400 de biți', color: '#FFFFFF' },
    ],
    pops: [
      { time: '+5:00', user: 'frostbyte_77', left: '6%', delay: '0s', color: 'var(--ice)' },
      { time: '+1:00', user: 'kxtrin', left: '58%', delay: '1.4s', color: 'var(--ice)' },
      { time: '+10:00', user: 'snowdrift_tv', left: '30%', delay: '2.8s', color: '#FFFFFF' },
      { time: '+2:00', user: 'polarpixel', left: '78%', delay: '4.2s', color: 'var(--ice)' },
      { time: '+1:00', user: 'mistletoe_mike', left: '16%', delay: '5.6s', color: '#FFFFFF' },
      { time: '+1:00', user: 'northpole_nik', left: '46%', delay: '7s', color: 'var(--ice)' },
    ],
    round: { id: 4, number: 4, closesAt: now + ((remainingSeconds + roundOffset) % 3600) * 1000 },
    challenges: [
      { id: 'carols', title: 'O oră de colinde la karaoke', desc: 'Chatul alege colindele. Fără skip.', votes: 412 },
      { id: 'elf', title: 'Costum de spiriduș tot restul zilei', desc: 'Urechi, căciulă, papuci. Tot.', votes: 386 },
      { id: 'blind', title: '15 minute de joc legat la ochi', desc: 'Chatul îi spune ce să facă.', votes: 248 },
      { id: 'mitts', title: 'Împachetează cadouri cu mănuși de bucătărie', desc: 'Cinci cadouri, contra cronometru.', votes: 197 },
      { id: 'candy', title: 'Test cu dulciuri de Crăciun misterioase', desc: 'Zece dulciuri din toată lumea.', votes: 143 },
    ],
    upNext: [
      { n: 1, title: 'Găleată cu gheață, afară în zăpadă', round: 3, pct: '41%', when: 'Diseară, 22:00' },
      { n: 2, title: 'Chatul controlează playlistul 2 ore', round: 2, pct: '37%', when: 'Mâine, 18:00' },
      { n: 3, title: 'Vorbește doar în rime 30 de minute', round: 1, pct: '52%', when: 'Mâine, 21:00' },
    ],
    completed: [
      { title: 'Ședință foto în pulover urât', when: 'ZIUA 1', clip: '#' },
      { title: 'Casă din turtă dulce, contra cronometru', when: 'ZIUA 1', clip: '#' },
      { title: 'Citește scrisorile chatului către Moș Crăciun', when: 'ZIUA 2', clip: '#' },
    ],
    prizes: defaultPrizes,
    losePrize: 7,
    recentWins: [
      { user: 'snowdrift_tv', prize: 'VIP 24 de ore', ago: 'acum 3 min' },
      { user: 'kxtrin', prize: '+5 minute pe cronometru', ago: 'acum 11 min' },
      { user: 'auroraaa', prize: 'o colindă de la Iceman', ago: 'acum 26 min' },
      { user: 'yeti_yolo', prize: 'un shoutout live', ago: 'acum 40 min' },
    ],
    boards: {
      gifts: [['snowdrift_tv', '142'], ['frostbyte_77', '96'], ['mistletoe_mike', '71'], ['polarpixel', '58'], ['kxtrin', '44']],
      bits: [['northpole_nik', '48.500'], ['auroraaa', '31.200'], ['frostbyte_77', '22.000'], ['coldbrew_cam', '15.400'], ['yeti_yolo', '9.800']],
      hours: [['northpole_nik', '86'], ['auroraaa', '79'], ['kxtrin', '74'], ['polarpixel', '71'], ['frostbyte_77', '66']],
    },
  };
}

/** The demo's logged-in viewer. */
export const sampleViewer = { name: 'viewer_name', spins: 2, flakes: 2, minutesToNextFlake: 38 };

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
