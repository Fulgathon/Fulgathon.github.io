// All sample data from the design's renderVals(), in one place.
// Phase 2 replaces this module (or what it returns) with live data from the
// backend. Keep the shapes; the rest of the site only reads from here.

export interface TickerItem { time: string; user: string; what: string; color: string }
export interface Challenge { id: string; title: string; desc: string; votes: number }
export interface UpNext { n: number; title: string; round: number; pct: string; when: string }
export interface Completed { title: string; when: string }
/** [short label on the wheel, full prize name, label colour] */
export type Prize = [short: string, full: string, color: string];
export interface Win { user: string; prize: string; ago: string }
export type BoardTab = 'gifts' | 'bits' | 'hours';
export interface ScheduleItem { day: string; title: string; desc: string; dayColor: string }
export interface Pop { time: string; user: string; left: string; delay: string; color: string }
export interface Partner { name: string; role: string; href: string }

export interface SampleData {
  /** Seconds left on the subathon timer when the page loads (stream live). */
  remainingSeconds: number;
  /** Seconds until the start when the stream is "upcoming". */
  startsInSeconds: number;
  /** Vote round: number and an offset the sample uses to fake its close time. */
  voteRound: number;
  voteRoundOffset: number;
  viewerName: string;
  /** Subs so far while live (0 when upcoming). */
  subsLive: number;
  raisedLive: string;
  raisedUpcoming: string;
  goalTitles: string[];
  goalMarks: number[];
  tickerLive: TickerItem[];
  tickerUpcoming: TickerItem[];
  challenges: Challenge[];
  upNext: UpNext[];
  completed: Completed[];
  prizes: Prize[];
  /** Index of the "Mai încearcă" (no prize) segment. */
  losePrize: number;
  spins: number;
  flakes: number;
  recentWins: Win[];
  boards: Record<BoardTab, [user: string, value: string][]>;
  boardUnits: Record<BoardTab, string>;
  boardTabs: [BoardTab, string][];
  schedule: ScheduleItem[];
  bingo: string[];
  bingoMarked: boolean[];
  pops: Pop[];
  partners: Partner[];
  supporters: { label: string; href: string }[];
}

export const sample: SampleData = {
  remainingSeconds: 3 * 86400 + 14 * 3600 + 27 * 60 + 52,
  startsInSeconds: 6 * 86400 + 9 * 3600 + 41 * 60 + 8,
  voteRound: 4,
  voteRoundOffset: 2538,
  viewerName: 'viewer_name',
  subsLive: 1284,
  raisedLive: '24.600 lei',
  raisedUpcoming: '0 lei',

  goalTitles: [
    'Pulover urât de Crăciun tot stream-ul', 'Provocarea cu baia de gheață', 'Seară de jocuri cu viewerii', 'Concurs de turtă dulce',
    'Chatul îmi pictează fața', 'Karaoke cu colinde', 'Gătesc sarmale live', 'Stream IRL prin zăpadă',
    'Chatul îmi alege culoarea părului', 'Turneu cu comunitatea', 'Baie în lacul înghețat', 'Obiectiv secret',
  ],
  goalMarks: [100, 250, 500, 750, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500],

  tickerLive: [
    { time: '+10:00', user: 'snowdrift_tv', what: 'a dăruit 10 suburi', color: 'var(--ice)' },
    { time: '+5:00', user: 'frostbyte_77', what: 'sub Tier 3', color: 'var(--ice)' },
    { time: '+1:00', user: 'mistletoe_mike', what: 'donație 25 lei', color: '#FFFFFF' },
    { time: '+2:00', user: 'polarpixel', what: 'sub Tier 2', color: 'var(--ice)' },
    { time: '+1:00', user: 'kxtrin', what: 'sub Prime', color: 'var(--ice)' },
    { time: '+1:00', user: 'northpole_nik', what: '400 de biți', color: '#FFFFFF' },
  ],
  tickerUpcoming: [
    { time: '--:--', user: 'FULGATHON', what: 'începe pe [DATA DE START]', color: '#7D8899' },
    { time: '--:--', user: 'Pregătește-te', what: 'primul sub pornește cronometrul', color: '#7D8899' },
    { time: '--:--', user: 'Discord', what: 'anunțurile apar acolo primele', color: '#7D8899' },
  ],

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
    { title: 'Ședință foto în pulover urât', when: 'ZIUA 1' },
    { title: 'Casă din turtă dulce, contra cronometru', when: 'ZIUA 1' },
    { title: 'Citește scrisorile chatului către Moș Crăciun', when: 'ZIUA 2' },
  ],

  prizes: [
    ['+5 min', '+5 minute pe cronometru', '#F2F5FA'],
    ['VIP 24h', 'VIP pe chat 24 de ore', 'var(--ice)'],
    ['Shoutout', 'Shoutout live pe stream', '#F2F5FA'],
    ['Sub cadou', 'Un sub cadou de la Iceman', '#FFFFFF'],
    ['Alegi jocul', 'Alegi următorul joc', '#F2F5FA'],
    ['O colindă', 'Iceman îți cântă o colindă', 'var(--ice)'],
    ['Îngheți timpul', 'Îngheți cronometrul 5 minute', '#F2F5FA'],
    ['Mai încearcă', 'Mai încearcă', '#8C97A8'],
  ],
  losePrize: 7,
  spins: 2,
  flakes: 2,
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
  boardUnits: { gifts: 'suburi', bits: 'biți', hours: 'ore' },
  boardTabs: [['gifts', 'Suburi dăruite'], ['bits', 'Biți'], ['hours', 'Ore văzute']],

  schedule: [
    { day: '20', title: 'Ziua 1: start', desc: 'Pornește cronometrul, primele obiective și primul vot.', dayColor: 'var(--ice)' },
    { day: '24', title: 'Ajunul Crăciunului', desc: 'Colinde, jocuri cu comunitatea, atmosferă de sărbătoare.', dayColor: '#F2F5FA' },
    { day: '25', title: 'Crăciunul', desc: 'Deschidem cadourile împreună cu chatul.', dayColor: '#FFFFFF' },
    { day: '??', title: 'Final programat: [DATA FINALĂ]', desc: 'Ultima zi, dacă nu se mai adaugă timp.', dayColor: '#4A5568' },
  ],

  bingo: [
    'Rage quit', 'Zice „ultimul joc” și mai joacă 3', 'Pică netul sau OBS-ul', 'Cântă fără să-i ceară nimeni',
    'Raid cu peste 50 de oameni', 'Mănâncă pe stream', 'Adoarme pe cameră', 'Cineva dăruiește 10+ suburi',
    'Moare în primul minut', 'Vorbește cu microfonul pe mute', 'Chatul spamează același emote', 'A treia cafea a zilei',
    'Un mod dă timeout', 'Râde un minut fără oprire', 'Începe ora dublă', 'Cântă o colindă',
  ],
  bingoMarked: [true, false, false, false, false, true, false, false, false, false, true, false, false, false, false, false],

  pops: [
    { time: '+5:00', user: 'frostbyte_77', left: '6%', delay: '0s', color: 'var(--ice)' },
    { time: '+1:00', user: 'kxtrin', left: '58%', delay: '1.4s', color: 'var(--ice)' },
    { time: '+10:00', user: 'snowdrift_tv', left: '30%', delay: '2.8s', color: '#FFFFFF' },
    { time: '+2:00', user: 'polarpixel', left: '78%', delay: '4.2s', color: 'var(--ice)' },
    { time: '+1:00', user: 'mistletoe_mike', left: '16%', delay: '5.6s', color: '#FFFFFF' },
    { time: '+1:00', user: 'northpole_nik', left: '46%', delay: '7s', color: 'var(--ice)' },
  ],

  partners: [
    { name: '[Partener 1]', role: 'Premii roată', href: '#' },
    { name: '[Partener 2]', role: 'Obiective', href: '#' },
    { name: '[Partener 3]', role: 'Ora dublă', href: '#' },
    { name: '[Partener 4]', role: 'Bingo', href: '#' },
  ],
  supporters: Array.from({ length: 6 }, () => ({ label: 'Logo', href: '#' })),
};
