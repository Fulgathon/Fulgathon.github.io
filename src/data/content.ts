// Fixed page content that doesn't come from the database.

import type { BoardTab, Goal, Prize, TickerItem } from './types';

export const boardUnits: Record<BoardTab, string> = { donations: '€', gifts: 'subs', bits: 'biți', hours: 'ore' };
export const boardTabs: [BoardTab, string][] = [['donations', 'Donatori'], ['gifts', 'Subs dăruite'], ['bits', 'Biți'], ['hours', 'Ore văzute']];

/** Ticker while nothing has happened yet. */
export function placeholderTicker(startText: string): TickerItem[] {
  return [
    { time: '--:--', user: 'ICEMARATON', what: `începe pe ${startText}`, color: '#7D8899' },
    { time: '--:--', user: 'Pregătește-te', what: 'fiecare donație și fiecare sub adaugă timp', color: '#7D8899' },
    { time: '--:--', user: 'Discord', what: 'anunțurile apar acolo primele', color: '#7D8899' },
  ];
}

/** Where the "+time" chips sit above the scoreboard, and when each one rises. */
export const popSlots = [
  { left: '6%', delay: '0s' },
  { left: '58%', delay: '1.4s' },
  { left: '30%', delay: '2.8s' },
  { left: '78%', delay: '4.2s' },
  { left: '16%', delay: '5.6s' },
  { left: '46%', delay: '7s' },
];

/** Goals and prizes as seeded in the database; used for the first paint. */
export const defaultGoals: Goal[] = [
  ['Pulover urât de Crăciun tot stream-ul', 100], ['Provocarea cu baia de gheață', 250],
  ['Seară de jocuri cu viewerii', 500], ['Concurs de turtă dulce', 750],
  ['Chatul îmi pictează fața', 1000], ['Karaoke cu colinde', 1500],
  ['Gătesc sarmale live', 2000], ['Stream IRL prin zăpadă', 2500],
  ['Chatul îmi alege culoarea părului', 3000], ['Turneu cu comunitatea', 4000],
  ['Baie în lacul înghețat', 5000], ['Obiectiv secret', 7500],
].map(([title, threshold]) => ({ title: title as string, threshold: threshold as number }));

export const prizeColors = ['#F2F5FA', 'var(--ice)', '#F2F5FA', '#FFFFFF', '#F2F5FA', 'var(--ice)', '#F2F5FA', '#8C97A8'];

export const defaultPrizes: Prize[] = [
  ['+5 min', '+5 minute pe cronometru'], ['VIP 24h', 'VIP pe chat 24 de ore'],
  ['Shoutout', 'Shoutout live pe stream'], ['Sub cadou', 'Un sub cadou de la Iceman'],
  ['Alegi jocul', 'Alegi următorul joc'], ['O colindă', 'Iceman îți cântă o colindă'],
  ['Îngheți timpul', 'Îngheți cronometrul 5 minute'], ['Mai încearcă', 'Mai încearcă'],
].map(([s, f], i) => [s, f, prizeColors[i]] as Prize);

/** Bingo card: 25 events on a 5×5 grid, row by row (same as the database; moderators edit it on /mod). */
export const bingoItems = [
  'Rage bait', 'Țipă la iKLD', 'Cântă fără să-i ceară nimeni', 'Raid cu peste 50 de oameni',
  'Cineva dăruiește 10+ subs', 'Cineva donează 100+ €', 'Moare în primul minut', 'Vorbește cu microfonul pe mute',
  'Un moderator își ia unmod', 'Mai prinde un accident pe live', 'Se ia curentul', 'Face pană la mașină',
  'Sforăie în somn', 'Rage quit', 'Zice „ultimul joc” și mai joacă 3', 'Pică netul sau OBS-ul',
  'Mănâncă pe stream', 'Adoarme pe cameră', 'Chatul spamează același emote', 'A treia cafea a zilei',
  'Râde un minut fără oprire', 'Cântă o colindă', 'Începe Ora dublă', 'Plânge de râs',
  'Apare cineva neanunțat pe cameră',
];

export const partners = [
  { name: '[Partener 1]', role: 'Premii roată', href: '#' },
  { name: '[Partener 2]', role: 'Milestones', href: '#' },
  { name: '[Partener 3]', role: 'Ora dublă', href: '#' },
  { name: '[Partener 4]', role: 'Bingo', href: '#' },
];
export const supporters = Array.from({ length: 6 }, () => ({ label: 'Logo', href: '#' }));
