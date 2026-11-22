// The data the page shows. It comes from Supabase for normal visitors
// (src/scripts/live.ts) or from the sample (src/data/sample.ts) with ?demo.

export type Status = 'upcoming' | 'live' | 'ended';
export type BoardTab = 'donations' | 'gifts' | 'bits' | 'hours';

export interface TickerItem { time: string; user: string; what: string; color: string }
export interface Pop { time: string; user: string; left: string; delay: string; color: string }
export interface Challenge { id: string; title: string; desc: string; votes: number }
export interface UpNext { n: number; title: string; round: number; pct: string; when: string }
export interface Completed { title: string; when: string; clip: string | null }
/** [short label on the wheel, full prize name, label colour] */
export type Prize = [short: string, full: string, color: string];
export interface Win { user: string; prize: string; ago: string }
/** Milestone Maraton: unlocked when the donation total (€) reaches threshold. */
export interface Goal { title: string; threshold: number }
export interface Round { id: number; number: number; closesAt: number }

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
}
