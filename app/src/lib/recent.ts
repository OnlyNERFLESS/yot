// Recent searches: the places a person picked from search results, newest
// first, kept on the device. Replaces trip recording, which nobody used.
export interface Recent {
  /** Persian name, the key `placeAt` looks places up by. */
  name: string;
  name_en: string;
  kind: string;
  lon: number;
  lat: number;
  t: number;
}

const KEY = 'yot.recent';
const MAX = 8;
const listeners = new Set<() => void>();

export function recentList(): Recent[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: Recent[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
  listeners.forEach((f) => f());
}

export function addRecent(r: Omit<Recent, 't'>) {
  // The same place picked again moves to the top instead of repeating.
  const same = (x: Recent) => x.name === r.name && Math.abs(x.lon - r.lon) < 1e-4 && Math.abs(x.lat - r.lat) < 1e-4;
  save([{ ...r, t: Date.now() }, ...recentList().filter((x) => !same(x))].slice(0, MAX));
}

export const clearRecent = () => save([]);

export function onRecentChange(f: () => void): () => void {
  listeners.add(f);
  return () => void listeners.delete(f);
}
