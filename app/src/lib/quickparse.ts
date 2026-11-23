// Reads one reminder or task per line of free text, the way people jot them:
//   "Call Ali tomorrow 10am", "Pay rent 5/12", "Gym every monday 19:00",
//   "Meet supplier fri 14:30", "Renew visa in 3 days", "فردا ساعت ۱۰ تماس با علی".
// Whatever is not a date, time or repeat stays as the title. The result is
// always shown as a preview before anything is saved, so a misread is cheap.
import type { Repeat } from './api';

export interface QuickItem {
  title: string;
  /** Local date, YYYY-MM-DD, or null when the line names no day. */
  date: string | null;
  /** HH:MM, 24-hour, or null when the line names no time. */
  time: string | null;
  repeat: Repeat;
  high: boolean;
}

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s: string) =>
  s.replace(/[۰-۹٠-٩]/g, (c) => String(FA_DIGITS.indexOf(c) >= 0 ? FA_DIGITS.indexOf(c) : AR_DIGITS.indexOf(c)));

// 0 = Sunday … 6 = Saturday, matching Date.getDay and Repeat.days.
const WEEKDAYS: [RegExp, number][] = [
  [/^(sun|sunday|یکشنبه|یک‌شنبه)$/, 0],
  [/^(mon|monday|دوشنبه)$/, 1],
  [/^(tue|tues|tuesday|سه‌شنبه|سهشنبه)$/, 2],
  [/^(wed|wednesday|چهارشنبه)$/, 3],
  [/^(thu|thur|thurs|thursday|پنجشنبه|پنج‌شنبه)$/, 4],
  [/^(fri|friday|جمعه)$/, 5],
  [/^(sat|saturday|شنبه)$/, 6],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const weekdayOf = (w: string) => WEEKDAYS.find(([re]) => re.test(w))?.[1] ?? null;
const monthOf = (w: string) => {
  const i = MONTHS.indexOf(w.slice(0, 3));
  return i >= 0 && /^[a-z]+$/.test(w) ? i : null;
};

/** Next date (today counts) falling on weekday `wd`. */
function nextWeekday(now: Date, wd: number): Date {
  return addDays(now, (wd - now.getDay() + 7) % 7);
}

function hhmm(h: number, m: number): string | null {
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parseLine(raw: string, now = new Date()): QuickItem | null {
  const line = toLatin(raw).replace(/\s+/g, ' ').trim();
  if (!line) return null;
  const words = line.split(' ');
  const keep: string[] = [];
  let date: Date | null = null;
  let time: string | null = null;
  let repeat: Repeat = { freq: 'none' };
  let high = false;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const lw = w.toLowerCase().replace(/[.,;]$/, '');
    const next = (words[i + 1] ?? '').toLowerCase().replace(/[.,;]$/, '');

    if (/^!+$/.test(lw)) { high = true; continue; }
    // Connectors that only make sense next to a date or time.
    if ((lw === 'at' || lw === 'on' || lw === 'ساعت' || lw === 'روز') && /^(\d|[a-z]|[آ-ی])/.test(next) && (/\d/.test(next) || weekdayOf(next) !== null)) continue;

    if (lw === 'today' || lw === 'امروز') { date = now; continue; }
    if (lw === 'tomorrow' || lw === 'tmr' || lw === 'tmrw' || lw === 'فردا') { date = addDays(now, 1); continue; }
    if (lw === 'پس‌فردا' || lw === 'پسفردا') { date = addDays(now, 2); continue; }
    if (lw === 'tonight') { date = now; time = time ?? '20:00'; continue; }

    // "in 3 days", "in 2 weeks"
    if (lw === 'in' && /^\d+$/.test(next) && /^(day|days|week|weeks)$/.test((words[i + 2] ?? '').toLowerCase())) {
      const n = Number(next) * (/week/.test(words[i + 2].toLowerCase()) ? 7 : 1);
      date = addDays(now, n);
      i += 2;
      continue;
    }

    // Repeats: "every day", "daily", "every monday", "weekly", "every month", "هر روز"
    if (lw === 'daily' || ((lw === 'every' || lw === 'هر') && (next === 'day' || next === 'روز'))) {
      repeat = { freq: 'daily' };
      if (lw !== 'daily') i++;
      continue;
    }
    if (lw === 'weekly' || ((lw === 'every' || lw === 'هر') && (next === 'week' || next === 'هفته'))) {
      repeat = { freq: 'weekly', days: [(date ?? now).getDay()] };
      if (lw !== 'weekly') i++;
      continue;
    }
    if (lw === 'monthly' || ((lw === 'every' || lw === 'هر') && (next === 'month' || next === 'ماه'))) {
      repeat = { freq: 'monthly' };
      if (lw !== 'monthly') i++;
      continue;
    }
    if ((lw === 'every' || lw === 'هر') && weekdayOf(next) !== null) {
      const wd = weekdayOf(next)!;
      repeat = { freq: 'weekly', days: [wd] };
      date = date ?? nextWeekday(now, wd);
      i++;
      continue;
    }

    // "next friday", or a bare weekday
    if (lw === 'next' && weekdayOf(next) !== null) {
      const d = nextWeekday(now, weekdayOf(next)!);
      date = d.getDay() === now.getDay() ? addDays(d, 7) : d;
      i++;
      continue;
    }
    if (weekdayOf(lw) !== null) { date = nextWeekday(now, weekdayOf(lw)!); continue; }

    // Times: 14:30, 9.15, 10am, 2:30pm, 7 pm
    let m = /^(\d{1,2})[:.](\d{2})(am|pm)?$/.exec(lw);
    if (m) {
      let h = Number(m[1]);
      const suffix = m[3] ?? (next === 'am' || next === 'pm' ? next : '');
      if (suffix === 'pm' && h < 12) h += 12;
      if (suffix === 'am' && h === 12) h = 0;
      const t = hhmm(h, Number(m[2]));
      if (t) { time = t; if (!m[3] && suffix) i++; continue; }
    }
    m = /^(\d{1,2})(am|pm)$/.exec(lw);
    if (m || (/^\d{1,2}$/.test(lw) && (next === 'am' || next === 'pm'))) {
      let h = Number(m ? m[1] : lw);
      const suffix = m ? m[2] : next;
      if (suffix === 'pm' && h < 12) h += 12;
      if (suffix === 'am' && h === 12) h = 0;
      const t = hhmm(h, 0);
      if (t) { time = t; if (!m) i++; continue; }
    }
    // "ساعت ۱۰" was skipped above; the bare hour lands here when it followed "at"/"ساعت".
    if (/^\d{1,2}$/.test(lw) && /^(at|ساعت)$/.test((words[i - 1] ?? '').toLowerCase())) {
      const t = hhmm(Number(lw), 0);
      if (t) { time = t; continue; }
    }

    // Dates: 5/12 or 5/12/2027 (day first, as written in Iran and the UK), 2027-01-05
    m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(lw);
    if (m) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
      let d = new Date(y, Number(m[2]) - 1, Number(m[1]));
      if (!m[3] && d < addDays(now, 0)) d = new Date(y + 1, Number(m[2]) - 1, Number(m[1]));
      if (d.getDate() === Number(m[1])) { date = d; continue; }
    }
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lw);
    if (m) { date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); continue; }
    // "5 dec", "dec 5"
    if (/^\d{1,2}$/.test(lw) && monthOf(next) !== null) {
      date = upcoming(now, monthOf(next)!, Number(lw));
      i++;
      continue;
    }
    if (monthOf(lw) !== null && /^\d{1,2}(st|nd|rd|th)?$/.test(next)) {
      date = upcoming(now, monthOf(lw)!, parseInt(next, 10));
      i++;
      continue;
    }

    keep.push(w);
  }

  // A trailing "at"/"on" left behind by a removed token reads as noise.
  while (keep.length && /^(at|on|by|-|–|ساعت)$/i.test(keep[keep.length - 1])) keep.pop();
  const title = keep.join(' ').trim();
  if (!title) return null;
  return { title, date: date ? iso(date) : null, time, repeat, high };
}

function upcoming(now: Date, month: number, day: number): Date {
  const d = new Date(now.getFullYear(), month, day);
  return d < addDays(now, 0) ? new Date(now.getFullYear() + 1, month, day) : d;
}

export function parseLines(text: string, now = new Date()): QuickItem[] {
  return text.split(/\r?\n/).map((l) => parseLine(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, ''), now)).filter((x): x is QuickItem => x !== null);
}

/** When a reminder fires. A line with a time but no day means the next time
 * that clock time comes round; no time at all means 09:00. */
export function startOf(item: QuickItem, now = new Date()): number {
  const [h, m] = (item.time ?? '09:00').split(':').map(Number);
  if (item.date) {
    const [y, mo, d] = item.date.split('-').map(Number);
    return new Date(y, mo - 1, d, h, m).getTime();
  }
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
  return t.getTime() > now.getTime() ? t.getTime() : addDays(t, 1).getTime() + h * 3_600_000 + m * 60_000;
}
