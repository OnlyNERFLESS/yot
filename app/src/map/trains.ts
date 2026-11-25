// Live trains on the metro map. The arrivals service gives minutes until the
// next train reaches a station in each direction; at RIDE_MIN a stop, that
// places the train some stations up the line, on the line's drawn shape. It
// is an estimate from live data, not a GPS position.
//
// Two sources feed it: the whole network, from a slow sweep over about every
// second station (lib/metroLive.ts), and the station in focus, from its own
// fresher arrivals. A train seen by both is drawn once, from the focus data.
import type { Map as MlMap } from 'maplibre-gl';
import type { LngLat } from '../lib/api';
import { alongLine, RIDE_MIN, type Network, type Station } from '../lib/metro';
import { sameStation, type Arrival } from '../lib/metroEta';

export interface TrainFeature {
  at: LngLat;
  bearing: number;
  colour: string;
  minutes: number;
  /** Direction index in net.dirs, and fractional station index along it. */
  dir: number;
  j: number;
  /** Approaching the station in focus: drawn large, with its minutes. */
  focus: boolean;
}

/** One reading: `minutes` before reaching station `i` of direction `dir`, as of `at`. */
export interface Sighting {
  dir: number;
  i: number;
  minutes: number;
  at: number;
}

/** Turn arrivals at a station into sightings, matching each direction by its terminus. */
export function sightings(net: Network, station: Station, rows: Arrival[], at: number, toward?: Station): Sighting[] {
  const out: Sighting[] = [];
  for (const r of rows) {
    if (r.minutes === null) continue;
    if (toward && !sameStation(r.toward, toward.name)) continue;
    const dir = net.dirs.findIndex((d) => d.seq.includes(station.id) && sameStation(net.stations[d.seq[d.seq.length - 1]].name, r.toward));
    if (dir < 0) continue;
    out.push({ dir, i: net.dirs[dir].seq.indexOf(station.id), minutes: r.minutes, at });
  }
  return out;
}

function place(net: Network, s: Sighting, now: number, focus: boolean): TrainFeature | null {
  const d = net.dirs[s.dir];
  const m = Math.max(0, s.minutes - (now - s.at) / 60_000);
  const j = s.i - m / RIDE_MIN;
  if (j < -0.25) return null; // not left its terminus yet
  const st = (x: number) => net.stations[d.seq[Math.max(0, Math.min(x, d.seq.length - 1))]].at;
  const geom = net.geomOf(d.line.ref);
  const k = Math.max(0, Math.floor(j));
  const p = k >= s.i ? { at: st(s.i), bearing: alongLine(geom, st(s.i - 1), st(s.i), 1).bearing } : alongLine(geom, st(k), st(k + 1), j - k);
  return { ...p, colour: d.line.colour, minutes: Math.round(m), dir: s.dir, j, focus };
}

/** Every train now. Readings of one train from neighbouring stations land
 * within a station of each other; the nearest reading wins, being the most
 * precise, and focus readings beat the network sweep. */
export function placeAll(net: Network, network: Sighting[], focus: Sighting[], now: number): TrainFeature[] {
  const all = [
    ...focus.map((s) => place(net, s, now, true)),
    ...network.map((s) => place(net, s, now, false)),
  ].filter((t): t is TrainFeature => t !== null);
  const kept: TrainFeature[] = [];
  for (const t of all.sort((a, b) => Number(b.focus) - Number(a.focus) || a.minutes - b.minutes)) {
    if (!kept.some((k) => k.dir === t.dir && Math.abs(k.j - t.j) < 0.8)) kept.push(t);
  }
  return kept;
}

// The trains are DOM markers, not a map layer: GeoJSON re-tiles on a worker
// for every update, while a few dozen transformed elements cost almost
// nothing. Positions are recomputed twice a second and the browser glides
// between them with a linear transform transition, on the compositor; while
// the map itself moves they follow it instantly instead.

const TRAIN_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.1V7a4 4 0 0 0 8 0V3.1"/><path d="m9 15-1-1"/><path d="m15 15 1-1"/><path d="M9 19c-2.8 0-5-2.2-5-5v-4a8 8 0 0 1 16 0v4c0 2.8-2.2 5-5 5Z"/><path d="m8 19-2 3"/><path d="m16 19 2 3"/></svg>`;
/** Update interval: at network zoom a train covers about a pixel a second,
 * so once a second is plenty; zoomed in, twice. The transition fills the gap. */
const tickMs = (zoom: number) => (zoom < COMPACT_BELOW ? 1000 : 500);
/** Below this zoom the whole network is in view: small trains, no labels. */
const COMPACT_BELOW = 12.2;

type Source = () => TrainFeature[];
type El = { el: HTMLDivElement; dir: HTMLElement; min: HTMLElement; text: string; colour: string; focus: boolean; dirIdx: number; j: number };

export class TrainMarkers {
  private root = document.createElement('div');
  private els: El[] = [];
  private source: Source | null = null;
  private label: (m: number) => string = String;
  private timer = 0;
  private step = 500;

  constructor(private map: MlMap) {
    this.root.className = 'train-layer';
    map.getCanvasContainer().appendChild(this.root);
    map.on('render', this.follow);
    document.addEventListener('visibilitychange', this.wake);
  }

  /** Follow these trains (or none), labelling minutes with `label`. */
  run(source: Source | null, label?: (m: number) => string) {
    this.source = source;
    if (label) this.label = label;
    this.wake();
  }

  remove() {
    this.run(null);
    this.map.off('render', this.follow);
    document.removeEventListener('visibilitychange', this.wake);
    this.root.remove();
  }

  private wake = () => {
    window.clearTimeout(this.timer);
    this.timer = 0;
    if (!this.source) return this.sync([], false);
    this.sync(this.source(), false);
    if (document.visibilityState === 'visible') this.tick();
  };

  private tick = () => {
    this.step = tickMs(this.map.getZoom());
    this.timer = window.setTimeout(() => {
      if (!this.source) return;
      if (!this.map.isMoving()) this.sync(this.source(), true);
      this.tick();
    }, this.step);
  };

  /** The map moved: snap every train to where it now projects. */
  private follow = () => {
    if (this.source && this.map.isMoving()) this.sync(this.source(), false);
  };

  private sync(trains: TrainFeature[], glide: boolean) {
    // Each train keeps its own element from one update to the next (same
    // direction, nearest position), so a marker glides along its own line
    // and never slides across to some other train.
    const free = new Set(this.els);
    const next: El[] = [];
    for (const tr of trains) {
      let best: El | null = null;
      for (const e of free) if (e.dirIdx === tr.dir && Math.abs(e.j - tr.j) < 1.5 && (!best || Math.abs(e.j - tr.j) < Math.abs(best.j - tr.j))) best = e;
      if (best) free.delete(best);
      next.push(best ?? this.make());
    }
    for (const e of free) e.el.remove();
    this.els = next;
    this.root.classList.toggle('compact', this.map.getZoom() < COMPACT_BELOW);
    const bearing = this.map.getBearing();
    trains.forEach((tr, i) => {
      const e = next[i];
      const p = this.map.project(tr.at);
      const fresh = e.dirIdx === -1;
      e.dirIdx = tr.dir;
      e.j = tr.j;
      e.el.style.transition = glide && !fresh ? `transform ${this.step}ms linear` : 'none';
      e.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      e.dir.style.transform = `rotate(${tr.bearing - bearing}deg)`;
      // Focus trains draw over the network's.
      e.el.style.zIndex = tr.focus ? '2' : '1';
      if (e.colour !== tr.colour) e.el.style.setProperty('--lc', (e.colour = tr.colour));
      if (e.focus !== tr.focus) e.el.classList.toggle('focus', (e.focus = tr.focus));
      const text = tr.focus ? this.label(tr.minutes) : '';
      if (e.text !== text) e.min.textContent = e.text = text;
    });
  }

  private make(): El {
    const el = document.createElement('div');
    el.className = 'train';
    el.innerHTML = `<i class="train-pulse"></i><i class="train-dir"></i><span class="train-badge">${TRAIN_SVG}</span><span class="train-min num"></span>`;
    this.root.appendChild(el);
    return { el, dir: el.querySelector('.train-dir')!, min: el.querySelector('.train-min')!, text: '', colour: '', focus: false, dirIdx: -1, j: 0 };
  }
}
