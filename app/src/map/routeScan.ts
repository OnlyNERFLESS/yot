// "Finding your route": the road search, played back. Thin glowing threads
// branch out from the start through the actual streets and highways the
// router is weighing, spreading like mycelium until one of them touches the
// destination; then the web fades and the chosen route draws itself in.
// Map screen only; Metro never calls it.
//
// The web is the router's own exploration (route_explore), so every thread
// runs along a real road. It is drawn on a canvas over the map rather than as
// a map layer: each frame strokes only the segments revealed since the last
// one, so thousands of threads cost a few hundred line segments per frame and
// the GeoJSON worker is never involved. Fresh growth glows on a second canvas
// that fades a little every frame, which is what leaves the bright tips and
// the dim web behind them. The winner is a real map layer, drawn in with a
// `line-gradient`, so it sits on the map exactly where the route will be.
import type { LineLayerSpecification, Map as MlMap, PaddingOptions } from 'maplibre-gl';
import { api, type Mode } from '../lib/api';

type LngLat = [number, number];

const ROUTE_LAYERS = ['tb-route', 'tb-route-casing', 'tb-alts'];
const WIN = 'tb-scan-win';
const CLEAR = 'rgba(0,0,0,0)';
const DRAW_MS = 850;
const WEB_FADE_MS = 480;
const ROUTE_FADE_MS = 260;
const MAX_WAIT_MS = 7000;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const growEase = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export interface ScanHandle {
  /** Hand over the real route (or null) and play the reveal; resolves when done. */
  resolve: (route: LngLat[] | null) => Promise<void>;
  cancel: () => void;
}

function setRouteOpacity(map: MlMap, o: number, fadeMs: number) {
  for (const id of ROUTE_LAYERS) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, 'line-opacity-transition', { duration: fadeMs, delay: 0 });
    map.setPaintProperty(id, 'line-opacity', (id === 'tb-alts' ? 0.75 : 1) * o);
  }
}

function bbox(c: LngLat[]): [[number, number], [number, number]] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of c) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [[x0, y0], [x1, y1]];
}
const moved = (map: MlMap) => new Promise<void>((res) => (map.isMoving() ? map.once('moveend', () => res()) : res()));

export function startRouteScan(map: MlMap, from: LngLat, to: LngLat, mode: Mode, opts: { padding: PaddingOptions }): ScanHandle | null {
  // Reduced motion: no show; the caller frames the route the plain way.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  setRouteOpacity(map, 0, 0);

  // ---- canvases over the map ----
  const host = map.getContainer();
  const mk = () => {
    const c = document.createElement('canvas');
    c.className = 'scan-web';
    host.appendChild(c);
    return c;
  };
  const webC = mk();
  const glowC = mk();
  const web = webC.getContext('2d')!;
  const glow = glowC.getContext('2d')!;
  let dpr = 1;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [webC, glowC]) {
      c.width = Math.round(host.clientWidth * dpr);
      c.height = Math.round(host.clientHeight * dpr);
    }
  };
  size();

  let lines: Float32Array[] = [];
  let shown = 0; // lines revealed so far
  let growStart = 0;
  let growMs = 1800;
  let grown = false;
  let alive = true;
  let raf = 0;
  let revealing = false;
  let finish: (() => void) | null = null;
  const t0 = performance.now();

  const stroke = (ctx: CanvasRenderingContext2D, from_: number, to_: number) => {
    ctx.beginPath();
    for (let i = from_; i < to_; i++) {
      const l = lines[i];
      for (let k = 0; k < l.length; k += 2) {
        const p = map.project([l[k], l[k + 1]]);
        if (k === 0) ctx.moveTo(p.x * dpr, p.y * dpr);
        else ctx.lineTo(p.x * dpr, p.y * dpr);
      }
    }
  };
  const drawWeb = (a: number, b: number) => {
    if (b <= a) return;
    stroke(web, a, b);
    web.lineCap = 'round';
    web.lineJoin = 'round';
    // Settled growth: deep emerald with its own soft halo.
    web.strokeStyle = 'rgba(4,120,56,0.55)';
    web.lineWidth = 3.2 * dpr;
    web.stroke();
    web.strokeStyle = 'rgba(14,190,88,0.85)';
    web.lineWidth = 1.2 * dpr;
    web.stroke();
  };
  const drawFresh = (a: number, b: number) => {
    if (b <= a) return;
    stroke(glow, a, b);
    glow.lineCap = 'round';
    glow.lineJoin = 'round';
    glow.globalCompositeOperation = 'lighter';
    // Fresh growth: a wide green bloom, a tighter brighter one, a mint core.
    glow.strokeStyle = 'rgba(8,170,80,0.28)';
    glow.lineWidth = 11 * dpr;
    glow.stroke();
    glow.strokeStyle = 'rgba(22,219,101,0.5)';
    glow.lineWidth = 4.5 * dpr;
    glow.stroke();
    glow.strokeStyle = 'rgba(170,255,205,0.95)';
    glow.lineWidth = 1.6 * dpr;
    glow.stroke();
    glow.globalCompositeOperation = 'source-over';
  };
  const fadeGlow = (amount: number) => {
    glow.globalCompositeOperation = 'destination-out';
    glow.fillStyle = `rgba(0,0,0,${amount})`;
    glow.fillRect(0, 0, glowC.width, glowC.height);
    glow.globalCompositeOperation = 'source-over';
  };
  // The camera can move mid-growth (the user drags, a resize): re-project.
  const onMove = () => {
    if (!alive || revealing) return;
    web.clearRect(0, 0, webC.width, webC.height);
    glow.clearRect(0, 0, glowC.width, glowC.height);
    drawWeb(0, shown);
  };
  const onResize = () => {
    size();
    onMove();
  };
  map.on('move', onMove);
  map.on('resize', onResize);

  let hitAt = 0;
  const frame = (now: number) => {
    if (!alive) return;
    fadeGlow(0.06);
    if (growStart && !grown) {
      const k = Math.min(1, (now - growStart) / growMs);
      const want = Math.round(lines.length * growEase(k));
      drawWeb(shown, want);
      drawFresh(shown, want);
      shown = want;
      if (k >= 1) {
        grown = true;
        hitAt = now;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  // Data and camera first, then grow. The initial framing is the caller's.
  void Promise.all([api.exploreRoads(mode, from, to).catch(() => null), moved(map)]).then(([res]) => {
    if (!alive) return;
    lines = res?.lines ?? [];
    if (!lines.length) {
      grown = true;
      return;
    }
    // More streets, a little longer, but never a wait.
    growMs = Math.min(2800, Math.max(1400, 1000 + lines.length * 0.05));
    growStart = performance.now();
  });

  // ---- reveal ----
  const addWinner = (route: LngLat[]) => {
    if (!map.getSource(WIN))
      map.addSource(WIN, { type: 'geojson', lineMetrics: true, data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route } } });
    const before = map.getLayer('tb-pins') ? 'tb-pins' : undefined;
    const g0 = ['interpolate', ['linear'], ['line-progress'], 0, CLEAR, 1, CLEAR];
    if (!map.getLayer(WIN + '-glow'))
      map.addLayer({ id: WIN + '-glow', type: 'line', source: WIN, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 18, 'line-blur': 10, 'line-gradient': g0 } } as LineLayerSpecification, before);
    if (!map.getLayer(WIN))
      map.addLayer({ id: WIN, type: 'line', source: WIN, layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-width': 4.5, 'line-gradient': g0 } } as LineLayerSpecification, before);
  };
  // Deep emerald at the start running to bright green at the leading end, so
  // the line reads as travelling; the halo follows the same ramp.
  const DEEP = '#05803c';
  const MID = '#16db65';
  const TIP = '#8dffbd';
  const drawn = (p: number) => {
    const halo = (a: number) => `rgba(22,219,101,${a})`;
    const lp = ['line-progress'];
    if (p >= 0.999) return [
      ['interpolate', ['linear'], lp, 0, DEEP, 0.55, MID, 1, MID],
      ['interpolate', ['linear'], lp, 0, halo(0.25), 1, halo(0.45)],
    ];
    if (p <= 0.0005) return [['interpolate', ['linear'], lp, 0, CLEAR, 1, CLEAR], ['interpolate', ['linear'], lp, 0, CLEAR, 1, CLEAR]];
    const e = Math.min(p + 0.0004, 1);
    const mid = Math.max(p * 0.55, 0.0001);
    return [
      ['interpolate', ['linear'], lp, 0, DEEP, mid, MID, p, TIP, e, CLEAR, 1, CLEAR],
      ['interpolate', ['linear'], lp, 0, halo(0.2), p, halo(0.75), e, CLEAR, 1, CLEAR],
    ];
  };

  const cleanup = () => {
    alive = false;
    cancelAnimationFrame(raf);
    map.off('move', onMove);
    map.off('resize', onResize);
    webC.remove();
    glowC.remove();
    for (const id of [WIN, WIN + '-glow']) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(WIN)) map.removeSource(WIN);
  };

  const reveal = async (route: LngLat[] | null) => {
    revealing = true;
    for (const c of [webC, glowC]) {
      c.style.transition = `opacity ${WEB_FADE_MS}ms ease-out`;
      c.style.opacity = '0';
    }
    if (!route || route.length < 2) {
      await new Promise((r) => window.setTimeout(r, WEB_FADE_MS));
      setRouteOpacity(map, 1, ROUTE_FADE_MS);
      return;
    }
    map.fitBounds(bbox(route), { padding: opts.padding, bearing: 0, pitch: 0, duration: 650 });
    addWinner(route);
    await new Promise<void>((done) => {
      const s = performance.now() + 120;
      const step = (now: number) => {
        if (!map.getLayer(WIN)) return done();
        const k = Math.min(1, Math.max(0, (now - s) / DRAW_MS));
        const p = easeInOut(k);
        const [core, halo] = drawn(p);
        map.setPaintProperty(WIN, 'line-gradient', core as never);
        map.setPaintProperty(WIN + '-glow', 'line-gradient', halo as never);
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    // The real route fades in under the drawn one, then the drawn one goes.
    setRouteOpacity(map, 1, ROUTE_FADE_MS);
    await new Promise((r) => window.setTimeout(r, ROUTE_FADE_MS + 40));
  };

  return {
    resolve: (route) =>
      new Promise<void>((res) => {
        if (!alive) return res();
        finish = res;
        // Reveal once the web has touched the destination (plus a beat for
        // the burst), or straight away if there was nothing to grow.
        const wait = () => {
          if (!alive) return res();
          const el = performance.now() - t0;
          if ((grown && (!hitAt || performance.now() - hitAt > 280)) || el > MAX_WAIT_MS) {
            void reveal(route).then(() => {
              cleanup();
              finish?.();
            });
          } else window.setTimeout(wait, 50);
        };
        wait();
      }),
    cancel: () => {
      if (!alive) return;
      cleanup();
      setRouteOpacity(map, 1, 0);
      finish?.();
    },
  };
}
