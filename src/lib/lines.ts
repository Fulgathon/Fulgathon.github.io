// Iceman's bubble: which group of lines an event uses, the placeholders, and
// a "shuffle bag" so a line doesn't repeat until all of the group were used.
// Shared by the page hero and the OBS overlay.

import { FALLBACK_LINE, MIN_LINES } from '../data/content';
import type { LineGroup, TickerItem } from '../data/types';
import { amount } from './events';
import { duration } from './format';

/** The group for one event, or null for events that don't get a line. */
export function groupFor(t: Pick<TickerItem, 'kind' | 'tier' | 'qty'>, smallDonation: number): LineGroup | null {
  switch (t.kind) {
    case 'sub': case 'resub': return t.tier === '2000' || t.tier === '3000' ? 'sub23' : 'sub';
    case 'gift': return 'gift';
    case 'bits': return 'bits';
    case 'donation': return (t.qty ?? 0) < smallDonation ? 'donSmall' : 'donBig';
    default: return null;
  }
}

export interface LineVars { nume: string; timp: string; suma: string; subs: string }

export function varsFor(t: TickerItem): LineVars {
  return {
    nume: t.user,
    timp: t.seconds ? `+${duration(t.seconds)}` : '',
    suma: t.kind === 'donation' ? `${amount(t.qty ?? 0)} €` : t.kind === 'bits' ? `${amount(t.qty ?? 0)} de biți` : '',
    subs: t.kind === 'gift' ? String(t.qty ?? 1) : '',
  };
}

export const fillLine = (line: string, v: LineVars) =>
  line.replace(/\{(nume|timp|suma|subs)\}/g, (_, k: keyof LineVars) => v[k] ?? '').replace(/\s{2,}/g, ' ').trim();

/** Usable lines of a group: trimmed, non-empty; fewer than MIN_LINES counts as "not ready". */
export function readyLines(list: string[] | undefined): string[] {
  const clean = (list ?? []).map((l) => l.trim()).filter(Boolean);
  return clean.length >= MIN_LINES ? clean : [];
}

/** Random order without repeats until every line of the group was used. */
export class LineBag {
  private bags = new Map<string, string[]>();
  private last = new Map<string, string>();

  pick(group: LineGroup, list: string[] | undefined): { line: string; fallback: boolean } {
    const lines = readyLines(list);
    if (!lines.length) return { line: FALLBACK_LINE, fallback: true };
    const key = group + '\u0000' + lines.join('\u0001');
    let bag = this.bags.get(key);
    if (!bag || !bag.length) {
      bag = [...lines].sort(() => Math.random() - 0.5);
      // Don't start a new round with the line that ended the last one.
      if (bag.length > 1 && bag[bag.length - 1] === this.last.get(group)) bag.unshift(bag.pop()!);
      this.bags.set(key, bag);
    }
    const line = bag.pop()!;
    this.last.set(group, line);
    return { line, fallback: false };
  }
}
