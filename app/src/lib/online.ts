// Online route providers. Both are called from the web layer (the WebView has
// TLS on every platform) and normalised to the same `Route` shape the offline
// engine returns, so the map and navigation code never care where a route came from.
import type { LngLat, Mode, Modifier, Route, Step, StepKind } from './api';

const TIMEOUT_MS = 12_000;

async function withTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Google's encoded polyline algorithm, returned as [lon, lat]. */
export function decodePolyline(str: string, precision = 5): LngLat[] {
  const factor = 10 ** precision;
  const out: LngLat[] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let result = 0;
      let shift = 0;
      let b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

// ---------------- Neshan ----------------

interface NeshanStep {
  name?: string;
  instruction?: string;
  type?: string;
  modifier?: string;
  distance: { value: number };
  duration: { value: number };
  start_location: [number, number];
  polyline?: string;
}
interface NeshanResponse {
  routes?: {
    overview_polyline: { points: string };
    legs: { distance: { value: number }; duration: { value: number }; steps: NeshanStep[] }[];
  }[];
  message?: string;
  code?: string | number;
}

const MODIFIERS: Record<string, Modifier> = {
  straight: 'straight',
  'slight left': 'slight_left',
  left: 'left',
  'sharp left': 'sharp_left',
  'slight right': 'slight_right',
  right: 'right',
  'sharp right': 'sharp_right',
  uturn: 'uturn',
};

function neshanKind(type: string | undefined): StepKind {
  switch (type) {
    case 'depart':
      return 'depart';
    case 'arrive':
      return 'arrive';
    case 'roundabout':
    case 'rotary':
    case 'exit roundabout':
    case 'exit rotary':
      return 'roundabout';
    case 'fork':
      return 'fork';
    case 'merge':
    case 'on ramp':
    case 'off ramp':
      return 'merge';
    case 'continue':
    case 'new name':
      return 'continue';
    default:
      return 'turn';
  }
}

export interface OnlineRequest {
  mode: Mode;
  from: LngLat;
  to: LngLat;
  avoidTrafficZone: boolean;
  avoidOddEven: boolean;
}

export async function neshanRoutes(key: string, r: OnlineRequest): Promise<Route[]> {
  if (r.mode === 'walk') throw new Error('Neshan walking routing is not enabled on this key');
  const q = new URLSearchParams({
    type: r.mode === 'motorcycle' ? 'motorcycle' : 'car',
    origin: `${r.from[1]},${r.from[0]}`,
    destination: `${r.to[1]},${r.to[0]}`,
    alternative: 'true',
  });
  if (r.avoidTrafficZone) q.set('avoidTrafficZone', 'true');
  if (r.avoidOddEven) q.set('avoidOddEvenZone', 'true');
  const res = await withTimeout(`https://api.neshan.org/v4/direction?${q}`, { headers: { 'Api-Key': key } });
  const body = (await res.json()) as NeshanResponse;
  if (!res.ok || !body.routes?.length) throw new Error(body.message ?? `Neshan error ${res.status}`);
  return body.routes.map((rt): Route => {
    const legs = rt.legs;
    const steps: Step[] = legs.flatMap((l) =>
      l.steps.map(
        (s): Step => ({
          kind: neshanKind(s.type),
          modifier: MODIFIERS[s.modifier ?? 'straight'] ?? 'straight',
          name: s.name ?? '',
          name_en: '',
          instruction: s.instruction ?? '',
          distance_m: s.distance.value,
          duration_s: s.duration.value,
          at: s.start_location,
        }),
      ),
    );
    // The overview line is heavily simplified (21 points for 9 km in testing),
    // which cuts corners on screen and blurs off-route detection. Each step
    // carries its own detailed line; join those when they are all present.
    const detailed: LngLat[] = [];
    const all = legs.flatMap((l) => l.steps);
    if (all.every((st) => st.polyline !== undefined)) {
      for (const st of all) {
        for (const p of decodePolyline(st.polyline ?? '')) {
          const last = detailed[detailed.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) detailed.push(p);
        }
      }
    }
    return {
      provider: 'neshan',
      mode: r.mode,
      distance_m: legs.reduce((a, l) => a + l.distance.value, 0),
      duration_s: legs.reduce((a, l) => a + l.duration.value, 0),
      duration_free_s: null,
      coords: detailed.length >= 2 ? detailed : decodePolyline(rt.overview_polyline.points),
      steps,
    };
  });
}

// ---------------- Google (outside Iran) ----------------

interface GoogleStep {
  distanceMeters?: number;
  staticDuration?: string;
  startLocation?: { latLng: { latitude: number; longitude: number } };
  navigationInstruction?: { maneuver?: string; instructions?: string };
}
interface GoogleResponse {
  routes?: {
    distanceMeters: number;
    duration: string;
    staticDuration?: string;
    polyline: { encodedPolyline: string };
    legs: { steps?: GoogleStep[] }[];
  }[];
  error?: { message: string };
}

const secs = (d: string | undefined): number => (d ? parseFloat(d) : 0);

function googleManeuver(m: string | undefined): [StepKind, Modifier] {
  switch (m) {
    case 'DEPART':
      return ['depart', 'straight'];
    case 'TURN_LEFT':
      return ['turn', 'left'];
    case 'TURN_RIGHT':
      return ['turn', 'right'];
    case 'TURN_SLIGHT_LEFT':
    case 'RAMP_LEFT':
      return ['turn', 'slight_left'];
    case 'TURN_SLIGHT_RIGHT':
    case 'RAMP_RIGHT':
      return ['turn', 'slight_right'];
    case 'TURN_SHARP_LEFT':
      return ['turn', 'sharp_left'];
    case 'TURN_SHARP_RIGHT':
      return ['turn', 'sharp_right'];
    case 'UTURN_LEFT':
    case 'UTURN_RIGHT':
      return ['turn', 'uturn'];
    case 'FORK_LEFT':
      return ['fork', 'slight_left'];
    case 'FORK_RIGHT':
      return ['fork', 'slight_right'];
    case 'MERGE':
      return ['merge', 'straight'];
    case 'ROUNDABOUT_LEFT':
    case 'ROUNDABOUT_RIGHT':
      return ['roundabout', 'straight'];
    default:
      return ['continue', 'straight'];
  }
}

export async function googleRoutes(key: string, r: OnlineRequest, lang: string): Promise<Route[]> {
  const travelMode = r.mode === 'walk' ? 'WALK' : r.mode === 'motorcycle' ? 'TWO_WHEELER' : 'DRIVE';
  const ll = (p: LngLat) => ({ location: { latLng: { latitude: p[1], longitude: p[0] } } });
  const body: Record<string, unknown> = {
    origin: ll(r.from),
    destination: ll(r.to),
    travelMode,
    computeAlternativeRoutes: true,
    languageCode: lang,
    units: 'METRIC',
  };
  if (travelMode !== 'WALK') body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
  const res = await withTimeout('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,' +
        'routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,' +
        'routes.legs.steps.navigationInstruction',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as GoogleResponse;
  if (!res.ok || !data.routes?.length) throw new Error(data.error?.message ?? `Google error ${res.status}`);
  return data.routes.map((rt): Route => {
    const steps: Step[] = rt.legs.flatMap((l) =>
      (l.steps ?? []).map((s): Step => {
        const [kind, modifier] = googleManeuver(s.navigationInstruction?.maneuver);
        const at = s.startLocation?.latLng;
        return {
          kind,
          modifier,
          name: '',
          name_en: '',
          instruction: s.navigationInstruction?.instructions ?? '',
          distance_m: s.distanceMeters ?? 0,
          duration_s: secs(s.staticDuration),
          at: at ? [at.longitude, at.latitude] : r.from,
        };
      }),
    );
    const coords = decodePolyline(rt.polyline.encodedPolyline);
    steps.push({ kind: 'arrive', modifier: 'straight', name: '', name_en: '', distance_m: 0, duration_s: 0, at: coords[coords.length - 1] ?? r.to });
    return {
      provider: 'google',
      mode: r.mode,
      distance_m: rt.distanceMeters,
      duration_s: secs(rt.duration),
      duration_free_s: rt.staticDuration ? secs(rt.staticDuration) : null,
      coords,
      steps,
    };
  });
}

/** Google Map Tiles session: roadmap with the live traffic layer. Google's terms
 * require Google route data to be shown on a Google map, so the Google
 * provider switches the base map to these tiles. */
export async function googleTiles(key: string, lang: string, kind: 'roadmap' | 'satellite' = 'roadmap'): Promise<string> {
  const res = await withTimeout(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Satellite is the hybrid view: imagery with Google's road and label overlay.
    body: JSON.stringify(
      kind === 'satellite'
        ? { mapType: 'satellite', language: lang, region: 'US', layerTypes: ['layerRoadmap'] }
        : { mapType: 'roadmap', language: lang, region: 'US', layerTypes: ['layerTraffic'], scale: 'scaleFactor2x', highDpi: true },
    ),
  });
  const data = (await res.json()) as { session?: string; error?: { message: string } };
  if (!res.ok || !data.session) throw new Error(data.error?.message ?? `Google tiles error ${res.status}`);
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${data.session}&key=${encodeURIComponent(key)}`;
}

/** Rough Iran bounding box: Neshan inside, Google outside. */
export function inIran(p: LngLat): boolean {
  return p[0] >= 44 && p[0] <= 63.4 && p[1] >= 25 && p[1] <= 39.8;
}
