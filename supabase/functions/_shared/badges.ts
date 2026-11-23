// Reading the subscriber badge of a chat message (EventSub channel.chat.message).
// `info` holds the cumulative months; the badge id hints at the tier (2xxx = Tier 2,
// 3xxx = Tier 3). No imports, so the site's unit tests can load it too.

export type Badge = { set_id?: string; id?: string; info?: string };

export function subBadge(badges: Badge[] | undefined): { months: number; tier: string } | null {
  const b = (badges ?? []).find((x) => x.set_id === 'subscriber' || x.set_id === 'founder');
  const months = Number.parseInt(b?.info ?? '', 10);
  if (!b || !Number.isFinite(months) || months < 1) return null;
  const v = Number.parseInt(b.id ?? '', 10) || 0;
  return { months, tier: v >= 3000 ? '3000' : v >= 2000 ? '2000' : '1000' };
}
