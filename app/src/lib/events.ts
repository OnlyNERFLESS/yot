// What happens on a day: Iran's official holidays and Iranian occasions (solar
// and lunar). Iran's calendar only: no international or other countries' days. Lunar dates use Iran's own Hijri months
// (crescent-sighted, from calendarData), not a generic Islamic calendar, which
// is often a day off from what Iran observes.
import { HIJRI_EVENTS, HIJRI_FIRST_YEAR, HIJRI_MONTHS, HIJRI_START_JDN, JALALI_EVENTS, MOVING_EVENTS, type Row } from './calendarData';
import { toJalali } from './jalali';

export type EventKind = 'holiday' | 'occasion';
export interface CalEvent {
  kind: EventKind;
  en: string;
  fa: string;
}
export interface Hijri {
  hy: number;
  hm: number;
  hd: number;
  /** Days in this Hijri month (29 or 30). */
  len: number;
}

const jdnOf = (d: Date) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000) + 2_440_588;

let starts: { hy: number; hm: number; start: number; len: number }[] | null = null;
function months() {
  if (starts) return starts;
  starts = [];
  let jdn = HIJRI_START_JDN;
  HIJRI_MONTHS.forEach((bits, i) => {
    for (let m = 0; m < bits.length; m++) {
      const len = bits[m] === '1' ? 30 : 29;
      starts!.push({ hy: HIJRI_FIRST_YEAR + i, hm: m + 1, start: jdn, len });
      jdn += len;
    }
  });
  return starts;
}

/** Iran's Hijri date, or null outside 1423–1460 AH (2002–2038). */
export function toHijri(d: Date): Hijri | null {
  const list = months();
  const j = jdnOf(d);
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const m = list[mid];
    if (j < m.start) hi = mid - 1;
    else if (j >= m.start + m.len) lo = mid + 1;
    else return { hy: m.hy, hm: m.hm, hd: j - m.start + 1, len: m.len };
  }
  return null;
}

const index = (rows: Row[]) => {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r[0]}-${r[1]}`;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
};
let idx: { j: Map<string, Row[]>; h: Map<string, Row[]> } | null = null;

/** Iranian occasions that move by weekday (Chaharshanbe Suri, Quds Day). The
 * data also lists Western ones (Easter, Thanksgiving); those are skipped. */
function moving(d: Date, hj: Hijri | null): CalEvent[] {
  const out: CalEvent[] = [];
  for (const [cal, month, weekday, which, en, fa] of MOVING_EVENTS) {
    let hit = false;
    if (cal === 'hijri') {
      hit = !!hj && hj.hm === month && d.getDay() === weekday && which === 'last' && hj.hd + 7 > hj.len;
    } else if (cal === 'jalali') {
      // Chaharshanbe Suri is the eve of the last Wednesday of Esfand: show it on the Tuesday.
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      const j = toJalali(next);
      const inWeek = toJalali(new Date(next.getFullYear(), next.getMonth(), next.getDate() + 7)).jm !== month;
      hit = j.jm === month && next.getDay() === weekday && inWeek;
    }
    if (hit) out.push({ kind: 'occasion', en, fa });
  }
  return out;
}

/** Everything on a day, holidays first. */
export function eventsOn(d: Date): CalEvent[] {
  idx ??= { j: index(JALALI_EVENTS), h: index(HIJRI_EVENTS) };
  const j = toJalali(d);
  const hj = toHijri(d);
  const rows: [Row, EventKind][] = [];
  for (const r of idx.j.get(`${j.jm}-${j.jd}`) ?? []) rows.push([r, r[2] ? 'holiday' : 'occasion']);
  if (hj) {
    for (const r of idx.h.get(`${hj.hm}-${hj.hd}`) ?? []) rows.push([r, r[2] ? 'holiday' : 'occasion']);
    // A short Safar moves Imam Reza's day to its 29th, the month's last day.
    if (hj.hm === 2 && hj.hd === 29 && hj.len === 29) for (const r of idx.h.get('2-30') ?? []) rows.push([r, r[2] ? 'holiday' : 'occasion']);
  }
  const list: CalEvent[] = [...rows.map(([r, kind]) => ({ kind, en: r[3], fa: r[4] })), ...moving(d, hj)];
  const rank: Record<EventKind, number> = { holiday: 0, occasion: 1 };
  list.sort((a, b) => rank[a.kind] - rank[b.kind]);
  // Both sources sometimes name the same day; keep the first (highest) one.
  const seen = new Set<string>();
  return list.filter((e) => !seen.has(e.en.toLowerCase()) && !!seen.add(e.en.toLowerCase()));
}

/** An official day off in Iran (Fridays aside). */
export const isHoliday = (d: Date) => eventsOn(d).some((e) => e.kind === 'holiday');
