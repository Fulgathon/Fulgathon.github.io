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

// Partners and supporters now live in src/data/site.ts (site.partners, site.supporters).

// ---- Layout v2 ---------------------------------------------------------------

/** «Cum adaugi timp» chips in the timer card (owner's rates, 23 Nov 2026). */
export const rateChips: [string, string][] = [
  ['1 €', '+6 min'], ['Tier 1 / Prime', '+6 min'], ['Tier 2', '+12 min'],
  ['Tier 3', '+18 min'], ['Gift sub', '+6 min'], ['400 biți', '+4 min'],
];

/** «Cât adaugi tu?»: what each choice adds (seconds) and a light equivalent (approved in the mockup). */
export const calcOptions: { label: string; seconds: number; fun: string }[] = [
  { label: '5 €', seconds: 1800, fun: 'cam un meci ranked' },
  { label: '10 €', seconds: 3600, fun: 'două meciuri și o cafea' },
  { label: '25 €', seconds: 9000, fun: 'un film de Crăciun, cu tot cu reclame' },
  { label: 'Sub T1', seconds: 360, fun: 'două colinde, cântate prost' },
  { label: 'Sub T3', seconds: 1080, fun: 'o pauză de masă cu sarmale' },
  { label: '5 gift', seconds: 1800, fun: 'cam un meci ranked' },
];

/**
 * Iceman's bubble: the six groups moderators fill on /mod. The site never
 * ships lines in his voice; a group with fewer than 5 lines uses FALLBACK_LINE.
 */
export const lineGroups: { id: import('./types').LineGroup; name: string; when: string }[] = [
  { id: 'sub', name: 'Sub (Tier 1 / Prime)', when: 'Un sub nou sau reînnoit, Tier 1 sau Prime.' },
  { id: 'sub23', name: 'Sub Tier 2 / 3', when: 'Sub Tier 2 sau Tier 3.' },
  { id: 'gift', name: 'Subs cadou', when: 'Cineva dăruiește unul sau mai multe subs.' },
  { id: 'donSmall', name: 'Donație mică', when: 'Donație sub pragul de donație mare.' },
  { id: 'donBig', name: 'Donație mare', when: 'Donație de la prag în sus.' },
  { id: 'bits', name: 'Biți', when: 'Orice cheer cu biți.' },
];
export const MIN_LINES = 5;
export const MAX_LINE = 70;
export const FALLBACK_LINE = 'Mersi, {nume}!';

/** Badge tiers (Badges.dc.html): 1 bronz … 5 prismă. Rules match private.loyalty. */
export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'plat' | 'prism';
export const badgeIcons = {
  star: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z',
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3 2',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
};
export const badgeDefs: { id: string; label: string; tier: BadgeTier; icon: keyof typeof badgeIcons; how: string }[] = [
  { id: 'og', label: 'Ziua 1 OG', tier: 'bronze', icon: 'star', how: 'Fii în chat în prima zi a maratonului, 20 decembrie.' },
  { id: 'h10', label: '10 ore', tier: 'bronze', icon: 'clock', how: 'Strânge 10 ore în chat, adunate pe tot maratonul.' },
  { id: 'night', label: 'Tura de noapte', tier: 'silver', icon: 'moon', how: 'Stai în total o oră în chat între 00:00 și 06:00.' },
  { id: 'streak7', label: 'Serie de 7 zile', tier: 'gold', icon: 'bolt', how: '7 zile la rând cu cel puțin 30 de minute în chat sau un check-in cu puncte de canal.' },
  { id: 'h50', label: '50 de ore', tier: 'plat', icon: 'clock', how: 'Strânge 50 de ore în chat, adunate pe tot maratonul.' },
  { id: 'h100', label: '100 de ore', tier: 'prism', icon: 'clock', how: 'Strânge 100 de ore în chat, adunate pe tot maratonul.' },
];
/** [accent, tint, text] per tier. Platinum is teal-green; prism uses the gradient below. */
export const tierColors: Record<BadgeTier, [string, string, string]> = {
  bronze: ['#C98A5B', 'rgba(201,138,91,0.14)', '#E3B08A'],
  silver: ['#C9D1DB', 'rgba(201,209,219,0.10)', '#E6EBF1'],
  gold: ['#E6C46A', 'rgba(230,196,106,0.12)', '#F2D98E'],
  plat: ['#5FDDBF', 'rgba(95,221,191,0.12)', '#A6F0DD'],
  prism: ['#C3B8FF', 'rgba(169,184,255,0.10)', '#E2DAFF'],
};
/** One smooth cool gradient: no hard stripes, no rainbow order, no white glare. */
export const PRISM = 'linear-gradient(135deg, #9FE8FF 0%, #A9B8FF 30%, #E2B6FF 52%, #FFD6C2 74%, #C8FFE9 100%)';
/** Legend and Fidelii ranks: 1 prism, 2 gold, 3 silver, 4 bronze, then grey. */
export const rankColors = ['prism', '#E6C46A', '#C9D1DB', '#C98A5B', '#6B7689'];

/**
 * Advent calendar defaults: 22 days from the start (20 Dec 2026 → 10 Jan 2027).
 * Only fixed dates are named here (by calendar date, Romania); moderators add
 * what's scheduled, the clip of each day and sponsors on /mod.
 */
export const ADVENT_DAYS = 22;
export const adventDates: Record<string, string> = { '12-24': 'Ajunul', '12-25': 'Crăciun', '12-31': 'Revelion live', '01-01': 'Anul Nou' };
/** Days drawn with the fir tree (Ajunul, Crăciun). */
export const adventTree = ['12-24', '12-25'];

/** OBS overlay pieces (?part=…): one Browser Source each, placed per scene by Iceman.
    w × h = the Browser Source size that fits the piece at ?scale=1 (measured in ?demo). */
export const overlayPieces: { id: string; label: string; what: string; w: number; h: number; key?: boolean }[] = [
  { id: 'timer', label: 'Cronometrul', what: 'Timpul rămas și «+timp».', w: 360, h: 180 },
  { id: 'goal', label: 'Următorul milestone', what: 'Ce urmează și cât mai e.', w: 430, h: 180 },
  { id: 'together', label: 'Ore împreună', what: 'Ore privite și timp adăugat azi.', w: 340, h: 80 },
  { id: 'bubble', label: 'Balonul lui Iceman', what: 'Replica lui la fiecare sub sau donație.', w: 350, h: 270 },
  { id: 'vote', label: 'Votul live', what: 'Doar cât e deschis votul.', w: 400, h: 330 },
  { id: 'moments', label: 'Momentele', what: 'Viscol, milestone, legende, roata etc.', w: 1100, h: 460 },
  { id: 'code', label: 'Codul secret', what: 'Doar când arătați un cod. Link privat.', w: 460, h: 170, key: true },
  { id: 'promo', label: 'Linia partenerului', what: 'Partenerul, la 10 minute.', w: 520, h: 60 },
  { id: 'snow', label: 'Ninsoarea', what: 'La valuri de subs cadou. Tot ecranul.', w: 1920, h: 1080 },
];
