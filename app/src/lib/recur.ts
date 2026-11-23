// Expands a reminder's repeat rule into concrete occurrences, in local time.
import type { Reminder, Repeat } from './api';

const DAY = 86_400_000;

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonthsClamped(base: Date, n: number): Date {
  const x = new Date(base);
  const day = base.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

/** Occurrence start times (ms) of `r` within [from, to), at most `limit`. */
export function occurrences(r: Pick<Reminder, 'start_ms' | 'repeat'>, from: number, to: number, limit = 500): number[] {
  const rep: Repeat = r.repeat;
  const start = new Date(r.start_ms);
  const out: number[] = [];
  const until = rep.until_ms ?? Infinity;
  const maxCount = rep.count ?? Infinity;
  let n = 0;
  const push = (t: number) => {
    n++;
    if (t >= from && t < to && t <= until) out.push(t);
  };
  if (rep.freq === 'none') {
    push(r.start_ms);
    return out;
  }
  const step = Math.max(1, rep.interval ?? 1);
  // Walk forward from the start; cheap for the ranges a calendar asks for.
  let cur = new Date(start);
  for (let i = 0; i < 20_000 && out.length < limit && n < maxCount; i++) {
    const t = cur.getTime();
    if (t > to || t > until) break;
    switch (rep.freq) {
      case 'daily':
      case 'interval':
        push(t);
        cur = addDays(start, (i + 1) * step);
        break;
      case 'weekdays': {
        // Iran's working week: Saturday to Wednesday, plus Thursday; Friday off.
        if (cur.getDay() !== 5) push(t);
        cur = addDays(cur, 1);
        break;
      }
      case 'weekly': {
        const days = rep.days?.length ? rep.days : [start.getDay()];
        if (days.includes(cur.getDay())) {
          const weeks = Math.floor((cur.getTime() - start.getTime()) / (7 * DAY));
          if (weeks % step === 0) push(t);
        }
        cur = addDays(cur, 1);
        break;
      }
      case 'monthly':
        push(t);
        cur = addMonthsClamped(start, (i + 1) * step);
        break;
      case 'yearly':
        push(t);
        cur = addMonthsClamped(start, (i + 1) * 12 * step);
        break;
      default:
        return out;
    }
  }
  return out;
}

/** Alert instants (ms) for occurrences starting in [from, to): [alertTime, occurrenceStart]. */
export function alertTimes(r: Reminder, from: number, to: number): [number, number][] {
  const maxBefore = Math.max(0, ...r.alerts) * 60_000;
  const occ = occurrences(r, from, to + maxBefore);
  const out: [number, number][] = [];
  for (const o of occ) {
    for (const m of r.alerts) {
      const at = o - m * 60_000;
      if (at >= from && at < to) out.push([at, o]);
    }
  }
  if (r.snooze_until && r.snooze_until >= from && r.snooze_until < to) out.push([r.snooze_until, r.snooze_until]);
  return out.sort((a, b) => a[0] - b[0]);
}

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
