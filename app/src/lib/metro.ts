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

export interface Network {
  stations: Station[];
  lines: TransitLine[];
  colourOf: (ref: string) => string;
  plan: (from: number, to: number) => Journey | null;
  nearest: (at: LngLat) => { station: Station; distance_m: number } | null;
}

const RIDE_MIN = 2.2; // between consecutive stations, dwell included
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
  const dirs: { line: TransitLine; seq: number[] }[] = [];
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

  return { stations, lines, colourOf: (ref) => colours.get(ref) ?? '#9aa3a0', plan, nearest };
}
