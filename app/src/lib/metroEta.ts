// Live Tehran metro arrivals. There is no official open feed; this reads the
// arrival service behind the Tehran Public Transport app (irantracking), which
// is undocumented and may change or stop without notice. So it is only asked
// while a station card is open, labelled as unofficial in the UI, and any
// failure quietly becomes "times unavailable".
import { fold } from './fold';
import { ETA_STATIONS } from './metroEtaIds';

const URL = 'https://application2.irantracking.com/modsapi/api/PublicTransport/SubwayStationETA';

export interface Arrival {
  /** Terminus the train is heading to (Persian, as the service names it). */
  toward: string;
  /** Minutes until it arrives; 0 = arriving now; null = no estimate. */
  minutes: number | null;
}

/** Words that differ between OpenStreetMap's station names and the service's
 * without changing which station it is: "ایستگاه مترو", "میدان", "شهید",
 * honorifics such as (ره) and (ع), and the spacing inside names. */
const NOISE = new Set(['ایستگاه', 'مترو', 'متروی', 'میدان', 'شهید', 'شهیدان', 'حضرت', 'آیت', 'الله', 'ره', 'ع', 'عج', 'س']);
/** The few stations whose names differ in substance, after normalising. */
const ALIASES: Record<string, string> = {
  نیروهوایی: 'نیرویهوایی',
  نمایشگاهشهرآفتاب: 'شهرآفتاب',
  تهرانصادقیه: 'صادقیه',
  'پایانه1و2فرودگاهمهرآباد': 'فرودگاهمهرآبادترمینالهای1و2',
  'پایانه4و6فرودگاهمهرآباد': 'فرودگاهمهرآبادترمینالهای4و6',
};
const key = (name: string) => {
  // OSM sometimes holds two names ("A;B"); the station's own is the last.
  const words = fold(name.split(';').pop() ?? name).split(' ').filter((w) => w && !NOISE.has(w));
  const k = words.join('');
  return ALIASES[k] ?? k;
};

let byName: Map<string, number[]> | null = null;
/** The service's station IDs for a station name (several at interchanges). */
export function etaIdsFor(name: string): number[] {
  byName ??= ETA_STATIONS.reduce((m, [id, n]) => m.set(key(n), [...(m.get(key(n)) ?? []), id]), new Map<string, number[]>());
  return byName.get(key(name)) ?? [];
}

async function one(id: number, signal: AbortSignal): Promise<Arrival[]> {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ StationID: id }),
    signal,
  });
  if (!res.ok) throw new Error(`ETA ${res.status}`);
  const rows = (await res.json()) as { DestinationName?: string; Details?: { ETAValue?: number; ETAValueText?: string }[] }[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const d = r.Details?.[0];
    const n = typeof d?.ETAValue === 'number' && /^\d+$/.test(d.ETAValueText ?? '') ? d.ETAValue : null;
    return { toward: r.DestinationName ?? '', minutes: n };
  });
}

/** Next trains at a station, one entry per direction, soonest first. Null when
 * the station is not covered or the service did not answer. */
export async function arrivalsAt(name: string, signal: AbortSignal): Promise<Arrival[] | null> {
  const ids = etaIdsFor(name);
  if (!ids.length) return null;
  const timeout = AbortSignal.timeout(8000);
  const both = AbortSignal.any ? AbortSignal.any([signal, timeout]) : signal;
  const lists = await Promise.allSettled(ids.map((id) => one(id, both)));
  const all = lists.flatMap((l) => (l.status === 'fulfilled' ? l.value : []));
  if (!all.length) return null;
  // One row per direction; a known time beats "no estimate".
  const best = new Map<string, Arrival>();
  for (const a of all) {
    const prev = best.get(a.toward);
    if (!prev || (prev.minutes === null && a.minutes !== null) || (a.minutes !== null && prev.minutes !== null && a.minutes < prev.minutes)) best.set(a.toward, a);
  }
  return [...best.values()].sort((a, b) => (a.minutes ?? 999) - (b.minutes ?? 999));
}
