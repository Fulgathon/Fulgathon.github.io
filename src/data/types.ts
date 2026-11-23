// The data the page shows. It comes from Supabase for normal visitors
// (src/scripts/live.ts) or from the sample (src/data/sample.ts) with ?demo.

export type Status = 'upcoming' | 'live' | 'ended';
export type BoardTab = 'donations' | 'gifts' | 'bits' | 'hours';

/** id: the event's id, so the overlay can queue every new one; big: a 20+ gift, 50 €+ or 5,000+ bits. */
export interface TickerItem {
  time: string; user: string; what: string; color: string; id?: number; big?: boolean; at?: number;
  /** The raw event, for Iceman's bubble (which group of lines) and the overlay. */
  kind?: string; tier?: string | null; qty?: number; seconds?: number;
  /** The bubble line the server picked for this event (same as in Twitch chat); null = fallback, undefined = pick here. */
  line?: string | null;
}
export interface Pop { time: string; user: string; left: string; delay: string; color: string }
export interface Challenge { id: string; title: string; desc: string; votes: number }
export interface UpNext { n: number; title: string; round: number; pct: string; when: string }
export interface Completed { title: string; when: string; clip: string | null }
/** [short label on the wheel, full prize name, label colour] */
export type Prize = [short: string, full: string, color: string, sponsor?: string | null];
export interface Win { user: string; prize: string; ago: string; sponsor?: string | null }
/**
 * Milestone Maraton: unlocked when the donation total (€) reaches threshold.
 * done/clip/when are set by moderators on /mod: done = it happened live
 * (with the clip link for «Ai ratat? Vezi clipurile»), when = when an
 * unlocked one is planned («vineri seara»).
 */
export interface Goal { title: string; threshold: number; sponsor?: string | null; doneAt?: number | null; clip?: string | null; when?: string | null }
/** The six groups of Iceman's bubble lines (moderators write them on /mod). */
export type LineGroup = 'sub' | 'sub23' | 'gift' | 'donSmall' | 'donBig' | 'bits';
/** One window of the Advent calendar (day 1 = the start day). */
export interface AdventDay { day: number; note: string; clip: string | null; sponsor: string | null }
export interface Round { id: number; number: number; closesAt: number }
export interface BingoItem { id: number; label: string; happened: boolean }
/** Prediction bingo: pick 5 events before closesAt; all 5 happen → raffle. */
export interface Bingo { closesAt: number | null; prize: string; prizeSponsor?: string | null; players: number; items: BingoItem[] }

/** What one viewer added in total (my_state). */
export interface Mine { seconds: number; subs: number; gifts: number; bits: number; donated: number }
/** One viewer's hours, daily streak and badges from chat presence. */
export interface Loyalty { hours: number; streak: number; best: number; days: number; badges: string[] }
/** Today's totals (Romania calendar day). */
export interface Today { seconds: number; people: number; subs: number; donated: number; bits: number; events: number }
/** Fidelii: top watchers by hours, daily streak (days with 30+ min in chat) and badges. */
export interface Loyal { name: string; hours: number; streak: number; badges: string[] }
/** Free community goal: hours watched together unlock stream events. */
export interface Together { hours: number; goals: { title: string; hours: number }[] }
/** "Acum pe stream": Twitch title + game, or a moderator note. */
export interface NowInfo { title: string | null; game: string | null; viewers: number | null; note: string | null }

export interface SiteData {
  status: Status;
  /** Epoch ms. */
  startsAt: number | null;
  endsAt: number | null;
  pausedUntil: number | null;
  scheduledEnd: number | null;
  /** "Ora dublă" window (epoch ms). */
  doubleFrom: number | null;
  doubleUntil: number | null;
  /** Sponsor presenting the current/next Ora dublă. */
  doubleSponsor?: string | null;
  subs: number;
  raised: string;
  /** Donation total in euros (milestones). */
  raisedNum: number;
  goals: Goal[];
  /** Newest first. Empty → the placeholder ticker is shown. */
  ticker: TickerItem[];
  pops: Pop[];
  round: Round | null;
  challenges: Challenge[];
  upNext: UpNext[];
  completed: Completed[];
  prizes: Prize[];
  losePrize: number;
  recentWins: Win[];
  boards: Record<BoardTab, [user: string, value: string][]>;
  bingo: Bingo;
  today: Today | null;
  loyal: Loyal[];
  together: Together | null;
  now: NowInfo | null;
  /** Iceman's lines for the hero bubble, per group (fewer than 5 → «Mersi, {nume}!»). */
  lines: Partial<Record<LineGroup, string[]>>;
  /** Donations below this many euros use the «Donație mică» lines. */
  smallDonation: number;
  /** Advent calendar notes and clips set on /mod (missing days use the defaults). */
  advent: AdventDay[];
  /** Demo showcase only: the date the Advent calendar labels start from (the real clock still decides «today»). */
  calendarStart?: number | null;
  /** How many people hold each badge (for the tooltips); null = not known yet. */
  badgeCounts: Record<string, number> | null;
}
