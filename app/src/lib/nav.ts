// Turn-by-turn progress along a route: where the agent is on the line, which
// step comes next, whether they have left the route, and what is left.
import type { LngLat, Route, Step } from './api';

const M_PER_DEG = 111_320;

function toLocal(p: LngLat, ref: LngLat): [number, number] {
  const k = Math.cos((ref[1] * Math.PI) / 180);
  return [(p[0] - ref[0]) * k * M_PER_DEG, (p[1] - ref[1]) * M_PER_DEG];
}

export function distM(a: LngLat, b: LngLat): number {
  const [x, y] = toLocal(b, a);
  return Math.hypot(x, y);
}

export interface Prepared {
  route: Route;
  /** Cumulative metres at each coordinate. */
  cum: number[];
  /** Metres along the route where each step starts. */
  stepAt: number[];
}

export function prepare(route: Route): Prepared {
  const c = route.coords;
  const cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + distM(c[i - 1], c[i]));
  // A step starts at the route vertex nearest its location, searched forward
  // so a road visited twice is not matched to its first visit.
  const stepAt: number[] = [];
  let from = 0;
  for (const s of route.steps) {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < c.length; i++) {
      const d = distM(c[i], s.at);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    stepAt.push(cum[best]);
    from = best;
  }
  return { route, cum, stepAt };
}

export interface Progress {
  /** Metres from the route line. */
  offBy: number;
  /** Metres travelled along the route. */
  along: number;
  remainingM: number;
  remainingS: number;
  next: Step | null;
  /** Metres until the next manoeuvre. */
  toNext: number;
  snapped: LngLat;
}

export function progress(p: Prepared, at: LngLat): Progress {
  const c = p.route.coords;
  let bestD = Infinity;
  let along = 0;
  let snapped: LngLat = c[0];
  for (let i = 0; i + 1 < c.length; i++) {
    const a = c[i];
    const [bx, by] = toLocal(c[i + 1], a);
    const [px, py] = toLocal(at, a);
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const d = Math.hypot(px - t * bx, py - t * by);
    if (d < bestD) {
      bestD = d;
      along = p.cum[i] + t * Math.sqrt(len2);
      snapped = [a[0] + (c[i + 1][0] - a[0]) * t, a[1] + (c[i + 1][1] - a[1]) * t];
    }
  }
  const total = p.cum[p.cum.length - 1] || 1;
  const remainingM = Math.max(0, total - along);
  let nextIdx = p.stepAt.findIndex((m, i) => i > 0 && m > along + 5);
  if (nextIdx < 0) nextIdx = p.route.steps.length - 1;
  return {
    offBy: bestD,
    along,
    remainingM,
    remainingS: p.route.duration_s * (remainingM / total),
    next: p.route.steps[nextIdx] ?? null,
    toNext: Math.max(0, p.stepAt[nextIdx] - along),
    snapped,
  };
}

/** The point `m` metres along the route, for the no-GPS preview drive. */
export function pointAlong(p: Prepared, m: number): LngLat {
  const c = p.route.coords;
  const i = p.cum.findIndex((x) => x >= m);
  if (i <= 0) return i === 0 ? c[0] : c[c.length - 1];
  const seg = p.cum[i] - p.cum[i - 1] || 1;
  const t = (m - p.cum[i - 1]) / seg;
  return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
}

/** Off route once the fix is clearly away from the line, allowing for GPS error. */
export function isOffRoute(pr: Progress, accuracy: number): boolean {
  return pr.offBy > Math.max(50, accuracy * 1.5);
}
