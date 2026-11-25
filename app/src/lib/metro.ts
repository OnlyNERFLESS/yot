// Metro network: stations merged across lines, and a journey planner that
// minimises time with a penalty for every change of line.
import type { LngLat, TransitLine } from './api';
import { distM } from './nav';
import { fold } from './fold';

export interface Station {
  id: number;
  name: string;
  name_en: string;
  at: LngLat;
  /** Line refs serving this station, e.g. ["1", "4"]. */
  lines: string[];
}

export interface Leg {
  line: string;
  colour: string;
  from: Station;
  to: Station;
  stops: number;
  /** Direction: the line's terminus in that direction. */
  toward: Station;
  /** Station positions along the leg, for drawing. */
  path: LngLat[];
}

export interface Journey {
  legs: Leg[];
  minutes: number;
  stops: number;
}

/** One running direction of a line: its stations in order, as station ids. */
export interface Direction {
  line: TransitLine;
  seq: number[];
}

export interface Network {
  stations: Station[];
  lines: TransitLine[];
  dirs: Direction[];
  /** Every drawn piece of a line, both directions; the same array each call. */
  geomOf: (ref: string) => LngLat[][];
  colourOf: (ref: string) => string;
  plan: (from: number, to: number) => Journey | null;
  nearest: (at: LngLat) => { station: Station; distance_m: number } | null;
}

export const RIDE_MIN = 2.2; // between consecutive stations, dwell included
const WAIT_MIN = 4; // average wait boarding the first train
const CHANGE_MIN = 8; // walking between platforms plus the next wait; people prefer fewer changes
const MERGE_M = 450; // same name within this distance = one interchange station

export function buildNetwork(lines: TransitLine[]): Network {
  const stations: Station[] = [];
  const byKey = new Map<string, number[]>();
  const keyOf = (s: { name: string; name_en: string }) => fold(s.name || s.name_en).replace(/^(ایستگاه|متروی?)\s*/, '');

  const stationFor = (s: TransitLine['stops'][number], ref: string): number => {
    const k = keyOf(s);
    const at: LngLat = [s.lng, s.lat];
    for (const id of byKey.get(k) ?? []) {
      if (distM(stations[id].at, at) < MERGE_M) {
        if (!stations[id].lines.includes(ref)) stations[id].lines.push(ref);
        if (!stations[id].name_en && s.name_en) stations[id].name_en = s.name_en;
        return id;
      }
    }
    const id = stations.length;
    stations.push({ id, name: s.name, name_en: s.name_en, at, lines: [ref] });
    byKey.set(k, [...(byKey.get(k) ?? []), id]);
    return id;
  };

  // Directed edges per line direction, keeping each direction's terminus.
  type Edge = { to: number; line: string; dir: number };
  const adj: Edge[][] = [];
  const dirs: Direction[] = [];
  for (const l of lines) {
    const seq = l.stops.map((s) => stationFor(s, l.ref));
    const d = dirs.length;
    dirs.push({ line: l, seq });
    for (let i = 0; i + 1 < seq.length; i++) {
      (adj[seq[i]] ??= []).push({ to: seq[i + 1], line: l.ref, dir: d });
    }
  }

  const colours = new Map(lines.map((l) => [l.ref, l.colour]));

  const plan = (from: number, to: number): Journey | null => {
    if (from === to) return null;
    // Dijkstra over (station, direction) states. Riding on costs a stop;
    // switching to another direction or line costs a change.
    const key = (st: number, d: number) => st * 1000 + (d + 1);
    const stOf = (k: number) => Math.floor(k / 1000);
    const dirOf = (k: number) => (k % 1000) - 1;
    const dist = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap: [number, number][] = []; // [cost, key]
    const push = (c: number, k: number, p: number) => {
      if (c < (dist.get(k) ?? Infinity)) {
        dist.set(k, c);
        prev.set(k, p);
        heap.push([c, k]);
      }
    };
    push(0, key(from, -1), -1);
    let end = -1;
    while (heap.length) {
      heap.sort((x, y) => y[0] - x[0]);
      const [c, k] = heap.pop()!;
      if (c > (dist.get(k) ?? Infinity)) continue;
      const st = stOf(k);
      const d = dirOf(k);
      if (st === to) {
        end = k;
        break;
      }
      for (const e of adj[st] ?? []) {
        const board = d === -1 ? WAIT_MIN : d === e.dir ? 0 : CHANGE_MIN;
        push(c + board + RIDE_MIN, key(e.to, e.dir), k);
      }
    }
    if (end === -1) return null;
    const path: number[] = [];
    for (let k = end; k !== -1; k = prev.get(k) ?? -1) path.push(k);
    path.reverse();
    const legs: (Leg & { dir: number })[] = [];
    for (let i = 1; i < path.length; i++) {
      const st = stOf(path[i]);
      const d = dirOf(path[i]);
      const last = legs[legs.length - 1];
      if (last && last.dir === d) {
        last.to = stations[st];
        last.stops++;
        last.path.push(stations[st].at);
        continue;
      }
      const info = dirs[d];
      legs.push({
        line: info.line.ref, colour: info.line.colour, from: stations[stOf(path[i - 1])], to: stations[st], stops: 1,
        toward: stations[info.seq[info.seq.length - 1]], dir: d,
        path: [stations[stOf(path[i - 1])].at, stations[st].at],
      });
    }
    return { legs, minutes: Math.round(dist.get(end) ?? 0), stops: legs.reduce((a, l) => a + l.stops, 0) };
  };

  const nearest = (at: LngLat) => {
    let best: { station: Station; distance_m: number } | null = null;
    for (const s of stations) {
      const d = distM(at, s.at);
      if (!best || d < best.distance_m) best = { station: s, distance_m: d };
    }
    return best;
  };

  const geoms = new Map<string, LngLat[][]>();
  const geomOf = (ref: string) => {
    let g = geoms.get(ref);
    if (!g) geoms.set(ref, (g = lines.filter((l) => l.ref === ref).flatMap((l) => l.geom)));
    return g;
  };

  return { stations, lines, dirs, geomOf, colourOf: (ref) => colours.get(ref) ?? '#9aa3a0', plan, nearest };
}

// ---------- along a line's drawn shape ----------
// Station-to-station straight segments cut corners, so anything drawn on a
// line (a journey, a train) is placed on the line's own geometry instead.
// Planar maths in degrees with longitude scaled by cos(lat): exact enough
// inside one city, and far cheaper than geodesics.

const COS = Math.cos((35.7 * Math.PI) / 180);
type Hit = { s: number; d: number };

function project(piece: LngLat[], p: LngLat): Hit {
  let acc = 0;
  let best: Hit = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < piece.length; i++) {
    const [ax, ay] = piece[i];
    const dx = (piece[i + 1][0] - ax) * COS;
    const dy = piece[i + 1][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((p[0] - ax) * COS * dx + (p[1] - ay) * dy) / len2)) : 0;
    const ex = (p[0] - ax) * COS - dx * t;
    const ey = p[1] - ay - dy * t;
    const d = ex * ex + ey * ey;
    if (d < best.d) best = { s: acc + t * Math.sqrt(len2), d };
    acc += Math.sqrt(len2);
  }
  return best;
}

/** The piece of a line both points sit on, with each point's distance along it. */
function span(geom: LngLat[][], a: LngLat, b: LngLat) {
  let best: { piece: LngLat[]; sa: number; sb: number; d: number } | null = null;
  for (const piece of geom) {
    const pa = project(piece, a);
    const pb = project(piece, b);
    if (!best || pa.d + pb.d < best.d) best = { piece, sa: pa.s, sb: pb.s, d: pa.d + pb.d };
  }
  // ~350 m off the drawn line in either point: the shape is not this pair's.
  return best && best.d < 2 * (0.0032 ** 2) ? best : null;
}

function walk(piece: LngLat[], from: number, to: number): LngLat[] {
  const fwd = from <= to;
  const [lo, hi] = fwd ? [from, to] : [to, from];
  const out: LngLat[] = [];
  let acc = 0;
  for (let i = 0; i + 1 < piece.length; i++) {
    const a = piece[i];
    const b = piece[i + 1];
    const len = Math.hypot((b[0] - a[0]) * COS, b[1] - a[1]);
    const t0 = len ? (lo - acc) / len : 0;
    const t1 = len ? (hi - acc) / len : 0;
    if (t0 <= 1 && t1 >= 0) {
      const p = (t: number): LngLat => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      if (!out.length) out.push(p(Math.max(0, t0)));
      out.push(p(Math.min(1, t1)));
    }
    acc += len;
    if (acc > hi) break;
  }
  return fwd ? out : out.reverse();
}

/** The drawn line between consecutive stations, joined; straight where the
 * shape does not fit. */
export function sliceLine(geom: LngLat[][], stops: LngLat[]): LngLat[] {
  const out: LngLat[] = [stops[0]];
  for (let i = 1; i < stops.length; i++) {
    const sp = span(geom, stops[i - 1], stops[i]);
    const part = sp ? walk(sp.piece, sp.sa, sp.sb) : [stops[i - 1], stops[i]];
    out.push(...part.slice(1));
  }
  return out;
}

/** A point a fraction of the way from station `a` to station `b` along the
 * line, and the direction of travel there (degrees clockwise from north). */
const paths = new WeakMap<LngLat[][], Map<string, { path: LngLat[]; lens: number[]; total: number }>>();

/** The drawn path between two stations, measured; cached, since trains ask
 * for the same few pairs on every update. */
function pathBetween(geom: LngLat[][], a: LngLat, b: LngLat) {
  let byPair = paths.get(geom);
  if (!byPair) paths.set(geom, (byPair = new Map()));
  const k = `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  let hit = byPair.get(k);
  if (!hit) {
    const sp = span(geom, a, b);
    const path = sp ? walk(sp.piece, sp.sa, sp.sb) : [a, b];
    let total = 0;
    const lens = path.slice(1).map((p, i) => {
      const l = Math.hypot((p[0] - path[i][0]) * COS, p[1] - path[i][1]);
      total += l;
      return l;
    });
    byPair.set(k, (hit = { path, lens, total }));
  }
  return hit;
}

export function alongLine(geom: LngLat[][], a: LngLat, b: LngLat, f: number): { at: LngLat; bearing: number } {
  const { path, lens, total } = pathBetween(geom, a, b);
  let want = total * Math.max(0, Math.min(1, f));
  for (let i = 0; i < lens.length; i++) {
    const p = path[i];
    const q = path[i + 1];
    if (want <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, want / lens[i]) : 0;
      const bearing = (Math.atan2((q[0] - p[0]) * COS, q[1] - p[1]) * 180) / Math.PI;
      return { at: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], bearing };
    }
    want -= lens[i];
  }
  return { at: a, bearing: 0 };
}
