// Romanian formatting helpers.

export const pad = (n: number) => String(n).padStart(2, '0');
export const fmtInt = (n: number) => Math.round(n).toLocaleString('ro-RO');

/** "5 minute", "20 de minute", "1 minut" (Romanian puts "de" before 20+, except 101–119 etc.). */
export function count(n: number, one: string, many: string): string {
  if (n === 1) return `1 ${one}`;
  const r = n % 100;
  const de = n >= 20 && (r === 0 || r >= 20);
  return `${fmtInt(n)} ${de ? 'de ' : ''}${many}`;
}

/** Seconds added → "+5:00", "+2:30", "+1:00:00". */
export function plusTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h > 0 ? `+${h}:${pad(m)}:${pad(r)}` : `+${m}:${pad(r)}`;
}

const dayMonth = new Intl.DateTimeFormat('ro-RO', { day: 'numeric', month: 'long', timeZone: 'Europe/Bucharest' });
/** "24 decembrie". */
export const dateRo = (ms: number) => dayMonth.format(new Date(ms));

/** "acum câteva secunde", "acum 3 min", "acum 2 ore". */
export function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'acum câteva secunde';
  const m = Math.floor(s / 60);
  if (m < 60) return `acum ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `acum ${count(h, 'oră', 'ore')}`;
  return `acum ${count(Math.floor(h / 24), 'zi', 'zile')}`;
}
