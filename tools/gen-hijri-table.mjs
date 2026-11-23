// Emit Iran's Hijri month lengths from 1423 to 1460: official through Shawwal
// 1448, Tehran crescent prediction after. Usage: node genhijri.mjs <package dir>
import { pathToFileURL } from 'node:url';
const dir = process.argv[2];
const { hijriFromJdn } = await import(pathToFileURL(dir + '/lib/calendar/hijri.js').href);
const { gregorianToJdn } = await import(pathToFileURL(dir + '/lib/calendar/jalali.js').href);
const { OFFICIAL_HIJRI_START_JDN } = await import(pathToFileURL(dir + '/lib/calendar/official-months.js').href);

const years = new Map();
let jdn = OFFICIAL_HIJRI_START_JDN;
for (;;) {
  const h = hijriFromJdn(jdn);
  if (h.year > 1460) break;
  if (!years.has(h.year)) years.set(h.year, []);
  years.get(h.year)[h.month - 1] = h.monthLength;
  jdn += h.monthLength - h.day + 1;
}
const check = (y, m, d) => { const h = hijriFromJdn(gregorianToJdn(y, m, d)); return `${y}-${m}-${d} = ${h.day}/${h.month}/${h.year}`; };
console.error(check(2025, 3, 31), '|', check(2025, 6, 6), '|', check(2025, 7, 6), '|', check(2024, 7, 16), '|', check(2026, 11, 23));
const rows = [...years].map(([y, l]) => `  ${y}: '${l.map((n) => (n === 30 ? 1 : 0)).join('')}',`).join('\n');
console.log(`START_JDN ${OFFICIAL_HIJRI_START_JDN}\n${rows}`);
