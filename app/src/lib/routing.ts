// Picks a route provider: offline always works; online adds live traffic.
// Inside Iran that is Neshan, elsewhere Google. Any online failure falls back
// to the offline engine so the agent is never left without a route.
import { api, type LngLat, type Mode, type Route, type Settings } from './api';
import { googleRoutes, inIran, neshanRoutes } from './online';

export interface RouteResult {
  routes: Route[];
  /** Why an online provider was skipped or failed, for a quiet notice. */
  note: string | null;
}

export async function findRoutes(s: Settings, mode: Mode, from: LngLat, to: LngLat): Promise<RouteResult> {
  const online = navigator.onLine && s.provider_pref === 'auto';
  let note: string | null = null;
  if (online) {
    const req = { mode, from, to, avoidTrafficZone: s.avoid_traffic_zone, avoidOddEven: s.avoid_odd_even };
    try {
      if (inIran(from) && s.has_neshan_service_key && mode !== 'walk') {
        const key = await api.secret('neshan_service_key');
        if (key) return { routes: sortByTime(await neshanRoutes(key, req)), note };
      } else if (!inIran(from) && s.has_google_key) {
        const key = await api.secret('google_key');
        if (key) return { routes: sortByTime(await googleRoutes(key, req, s.lang)), note };
      }
    } catch (err) {
      note = err instanceof Error ? err.message : String(err);
    }
  }
  const r = await api.routeOffline(mode, from, to);
  return { routes: [r], note };
}

function sortByTime(rs: Route[]): Route[] {
  return [...rs].sort((a, b) => a.duration_s - b.duration_s);
}
