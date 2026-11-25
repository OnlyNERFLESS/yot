// Favourite stations and recent metro trips, kept on this device. Stored by
// station name rather than id: ids are positions in the network built at
// load, and would point at other stations if the transit data changed.
export interface Trip {
  from: string;
  to: string;
}

const FAV_KEY = 'yot.metroFav';
const TRIP_KEY = 'yot.metroTrips';
const MAX_TRIPS = 8;

const read = <T,>(key: string): T[] => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const loadFavs = (): string[] => read<string>(FAV_KEY).filter((x) => typeof x === 'string');
export const loadTrips = (): Trip[] => read<Trip>(TRIP_KEY).filter((x) => typeof x?.from === 'string' && typeof x?.to === 'string');

export function toggleFav(favs: string[], name: string): string[] {
  const next = favs.includes(name) ? favs.filter((x) => x !== name) : [...favs, name];
  localStorage.setItem(FAV_KEY, JSON.stringify(next));
  return next;
}

/** Newest first, no repeats. */
export function rememberTrip(trips: Trip[], trip: Trip): Trip[] {
  const next = [trip, ...trips.filter((x) => x.from !== trip.from || x.to !== trip.to)].slice(0, MAX_TRIPS);
  localStorage.setItem(TRIP_KEY, JSON.stringify(next));
  return next;
}
