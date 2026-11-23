// Map construction: offline vector tiles from a pack file, local fonts and
// icons, plus optional online layers (Neshan live traffic, Google base map).
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type * as GeoJSON from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { layers, namedFlavor, type Flavor as PmFlavor } from '@protomaps/basemaps';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import { api } from '../lib/api';

/** Reads tile bytes from a pack through the Rust core, so the map file never
 * has to be served over HTTP or loaded into memory. */
class PackSource implements Source {
  constructor(private readonly name: string) {}
  getKey(): string {
    return `pack-${this.name}`;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await api.readRange(this.name, offset, length) };
  }
}

// MapLibre 6 finds its worker relative to its own module URL, which breaks once
// Vite has moved the module into its dependency cache or a hashed chunk. The
// worker file is self-contained, so hand Vite the asset URL explicitly.
maplibregl.setWorkerUrl(workerUrl);

// One Protocol holds every registered pack. It is attached to each MapLibre
// namespace in use: the Neshan SDK bundles its own MapLibre copy, which has its
// own protocol table and would otherwise reject pmtiles:// URLs.
const protocol = new Protocol();
maplibregl.addProtocol('pmtiles', protocol.tile);

/** `app://map/...` loads a bundled file through the page itself. Fonts are
 * otherwise fetched from inside a worker, and the Neshan SDK's worker has an
 * opaque origin, so same-origin requests from it fail CORS. */
const appAsset: maplibregl.AddProtocolAction = async (params) => {
  const res = await fetch(`${window.location.origin}/${params.url.slice('app://'.length)}`);
  if (!res.ok) throw new Error(`${res.status} ${params.url}`);
  return { data: await res.arrayBuffer() };
};
maplibregl.addProtocol('app', appAsset);
function ensureProtocol(): Protocol {
  return protocol;
}

export function registerPack(name: string): string {
  const p = new PMTiles(new PackSource(name));
  ensureProtocol().add(p);
  return `pmtiles://${p.source.getKey()}`;
}

export type Flavor = 'light' | 'dark';

/** DigiDev-tinted basemaps: evergreen ground instead of stock grey, roads in
 * the same green family, water kept blue so it still reads as water. */
const FLAVORS: Record<Flavor, PmFlavor> = {
  // Obsidian: near-neutral blacks with a whisper of green in parks, so the
  // emerald route and pins are the only saturated colour on the map.
  dark: {
    ...namedFlavor('dark'),
    background: '#060708',
    earth: '#0a0c0d',
    park_a: '#0b1712', park_b: '#0b1712', wood_a: '#0a1510', wood_b: '#0a1510', scrub_a: '#0b120f', scrub_b: '#0b120f',
    water: '#08131b',
    buildings: '#121517',
    minor_a: '#191d20', minor_b: '#191d20', minor_service: '#141719', other: '#141719',
    link: '#23282c', major: '#23282c', highway: '#2e3439',
    minor_casing: '#0a0c0d', major_casing_early: '#0a0c0d', major_casing_late: '#0a0c0d',
    highway_casing_early: '#0a0c0d', highway_casing_late: '#0a0c0d', link_casing: '#0a0c0d',
  },
  light: {
    ...namedFlavor('light'),
    background: '#eef4f0',
    earth: '#f4f8f6',
    park_a: '#d9f2e2', park_b: '#d9f2e2', wood_a: '#d3ecdb', wood_b: '#d3ecdb',
    water: '#cfe3ec',
    buildings: '#e4ebe6',
  },
};

/** The country pack is shallow (z0-8) and the city pack deep (z0-15). Below
 * this zoom the country draws alone; from it the city's tiles take over and
 * paint over the country inside their own extent, so the two never double up. */
const CITY_MIN_ZOOM = 9;

export interface BasePacks {
  /** Detailed city pack URL (streets, buildings, every POI). */
  city: string | null;
  /** Light country-wide pack URL (borders, cities, main roads). */
  country: string | null;
}

export function baseStyle(packs: BasePacks, flavor: Flavor, lang: 'en' | 'fa'): StyleSpecification {
  const origin = window.location.origin;
  const style: StyleSpecification = {
    version: 8,
    glyphs: 'app://map/fonts/{fontstack}/{range}.pbf',
    sprite: `${origin}/map/sprites/${flavor}`,
    sources: {},
    layers: [],
  };
  const attribution = '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> · Protomaps';
  if (packs.country) {
    style.sources.country = { type: 'vector', url: packs.country, attribution };
    style.layers.push(...layers('country', FLAVORS[flavor], { lang }).map((l) => ({ ...l, id: `c-${l.id}` })));
  }
  if (packs.city) {
    // The city keeps the stock layer ids: 3D buildings and overlays look them up.
    style.sources.protomaps = { type: 'vector', url: packs.city, attribution };
    const city = layers('protomaps', FLAVORS[flavor], { lang });
    style.layers.push(
      ...(packs.country
        ? city.filter((l) => l.type !== 'background').map((l) => ({ ...l, minzoom: Math.max(l.minzoom ?? 0, CITY_MIN_ZOOM) }))
        : city),
    );
  }
  if (!style.layers.length) {
    style.layers = [{ id: 'bg', type: 'background', paint: { 'background-color': flavor === 'dark' ? '#060708' : '#f4f6f5' } }];
  }
  return style;
}

/** Sources whose layers are "the city": hidden in metro mode, which shows the
 * network on a plain ground. */
const BASE_SOURCES = new Set(['protomaps', 'country', 'google-base', 'nsh-traffic']);
/** What stays of the city under the metro: ground, parks, water, the main
 * road skeleton and district names. No buildings, side streets, shops or road
 * labels, which would fight the station labels. */
const METRO_UNDERLAY = /^(c-)?(earth|landcover|landuse_park|landuse_urban_green|water|water_river|roads(_bridges|_tunnels)?_(highway|major)|boundaries|places_locality|places_subplace)$/;
const hiddenByMetro = new WeakMap<MlMap, Map<string, 'visible' | 'none'>>();

/** Metro mode: the lines and stations over a faint, low-detail city. Restores
 * each layer's own visibility afterwards, so traffic and 3D toggles survive. */
export function setBasemapHidden(map: MlMap, hidden: boolean) {
  const style = map.getStyle();
  if (!style) return;
  let saved = hiddenByMetro.get(map);
  if (map.getLayer('tb-metro-veil')) map.setLayoutProperty('tb-metro-veil', 'visibility', hidden ? 'visible' : 'none');
  if (hidden) {
    if (!saved) {
      saved = new Map();
      hiddenByMetro.set(map, saved);
    }
    for (const l of style.layers) {
      const src = 'source' in l ? (l.source as string | undefined) : undefined;
      if (!(src && BASE_SOURCES.has(src)) && l.id !== 'tb-3d') continue;
      if ((src === 'protomaps' || src === 'country') && METRO_UNDERLAY.test(l.id)) continue;
      const vis = (map.getLayoutProperty(l.id, 'visibility') as 'visible' | 'none' | undefined) ?? 'visible';
      if (!saved.has(l.id)) saved.set(l.id, vis);
      if (vis !== 'none') map.setLayoutProperty(l.id, 'visibility', 'none');
    }
  } else if (saved) {
    for (const [id, vis] of saved) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
    hiddenByMetro.delete(map);
  }
}

/** A style swap (theme, language) rebuilds every layer visible. */
export function forgetBasemapState(map: MlMap) {
  hiddenByMetro.delete(map);
}

export interface MapOptions {
  container: HTMLElement;
  style: StyleSpecification;
  center: [number, number];
  zoom: number;
  neshanWebKey: string | null;
}

/** Uses Neshan's SDK map (a MapLibre subclass) when a web key exists, because
 * their traffic tiles are encrypted and only that SDK decodes them. */
export async function createMap(o: MapOptions): Promise<MlMap> {
  const common = {
    container: o.container,
    style: o.style,
    center: o.center,
    zoom: o.zoom,
    maxZoom: 19,
    attributionControl: { compact: true } as const,
    // Two-finger rotate and tilt, like any modern maps app; the compass button resets.
    dragRotate: true,
    pitchWithRotate: true,
    maxPitch: 65,
  };
  if (o.neshanWebKey) {
    try {
      const [{ default: nsdk }] = await Promise.all([
        import('@neshan-maps-platform/maplibre-sdk'),
        import('@neshan-maps-platform/maplibre-sdk/style.css'),
      ]);
      nsdk.addProtocol('pmtiles', protocol.tile);
      nsdk.addProtocol('app', appAsset);
      return new nsdk.Map({ ...common, apiKey: o.neshanWebKey, logoPosition: 'bottom-left', copyRightPosition: 'bottom-left' });
    } catch (err) {
      console.warn('Neshan SDK unavailable, using plain MapLibre', err);
    }
  }
  return new maplibregl.Map(common);
}

// ---------------- overlay layers ----------------

export const TRAFFIC_LAYERS = ['nsh-traffic-major', 'nsh-traffic-minor'];

/** Neshan live traffic: vector source "iran_traffic", property `traffic` 1..4
 * (1 free-flowing .. 4 standstill, the colours Neshan's own style uses). */
export function addTraffic(map: MlMap, before?: string) {
  if (map.getSource('nsh-traffic')) return;
  map.addSource('nsh-traffic', {
    type: 'vector',
    tiles: ['nsh://api.neshan.org/traffic/{z}/{x}/{y}/sdk'],
    minzoom: 1,
    maxzoom: 14,
  });
  const color: maplibregl.ExpressionSpecification = [
    // Free-flowing roads (1) stay uncoloured: the layer shows problems only, so
    // it never turns the whole map into a web competing with the emerald route.
    'match', ['get', 'traffic'], 2, '#f5b544', 3, '#ff5a4f', 4, '#b0201a', 'rgba(0,0,0,0)',
  ];
  map.addLayer(
    {
      id: 'nsh-traffic-major',
      type: 'line',
      source: 'nsh-traffic',
      'source-layer': 'iran_traffic',
      minzoom: 7,
      filter: ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 14, 4, 17, 8] },
    },
    before,
  );
  map.addLayer(
    {
      id: 'nsh-traffic-minor',
      type: 'line',
      source: 'nsh-traffic',
      'source-layer': 'iran_traffic',
      minzoom: 13,
      // Side streets only show real jams (3-4); moderate slowdowns on every
      // lane painted the whole street grid amber and drowned the map.
      filter: ['all',
        ['!', ['in', ['get', 'highway'], ['literal', ['motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link']]]],
        ['>=', ['to-number', ['get', 'traffic']], 3]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 17, 5] },
    },
    before,
  );
}

export function setTrafficVisible(map: MlMap, on: boolean) {
  for (const id of TRAFFIC_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

/** Google raster base: roadmap with live traffic while a Google route is shown,
 * or hybrid satellite when the agent picks it. Our overlays stay on top. */
export function setGoogleBase(map: MlMap, tileUrl: string | null) {
  if (map.getLayer('google-base')) map.removeLayer('google-base');
  if (map.getSource('google-base')) map.removeSource('google-base');
  if (!tileUrl) return;
  map.addSource('google-base', {
    type: 'raster',
    tiles: [tileUrl],
    tileSize: 256,
    attribution: 'Map data © Google',
  });
  const firstOverlay = map.getStyle().layers.find((l) => l.id.startsWith('tb-'))?.id;
  map.addLayer({ id: 'google-base', type: 'raster', source: 'google-base' }, firstOverlay);
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Buildings rise when the map is tilted. Heights come from the map data when
 * known; otherwise a modest default so the city still reads as volumes. */
export function add3dBuildings(map: MlMap, flavor: Flavor) {
  if (map.getLayer('tb-3d') || !map.getSource('protomaps')) return;
  map.addLayer({
    id: 'tb-3d',
    type: 'fill-extrusion',
    source: 'protomaps',
    'source-layer': 'buildings',
    minzoom: 14.5,
    paint: {
      'fill-extrusion-color': flavor === 'dark' ? '#1a1f22' : '#e3e8e5',
      'fill-extrusion-height': ['coalesce', ['get', 'height'], ['*', ['coalesce', ['get', 'building:levels'], 3], 3]],
      'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.85],
    },
  }, 'tb-alts');
}

export function set3dVisible(map: MlMap, on: boolean, navigating = false) {
  if (!map.getLayer('tb-3d')) return;
  map.setLayoutProperty('tb-3d', 'visibility', on ? 'visible' : 'none');
  // While driving, buildings go glassy so a tower never hides the route or the car.
  map.setPaintProperty('tb-3d', 'fill-extrusion-opacity',
    navigating ? 0.45 : ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 0.85]);
}

/** Our own layers, prefixed tb-, re-added after every style change. */
export function addOverlays(map: MlMap) {
  const src = (id: string) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  };
  ['tb-alts', 'tb-route', 'tb-pos', 'tb-pins'].forEach(src);
  const add = (l: maplibregl.LayerSpecification) => {
    if (!map.getLayer(l.id)) map.addLayer(l);
  };
  add({ id: 'tb-alts', type: 'line', source: 'tb-alts', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#7d8c83', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 14, 4, 17, 5.5], 'line-opacity': 0.75 } });
  add({ id: 'tb-route-casing', type: 'line', source: 'tb-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#022c16', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 14, 7.5, 17, 10] } });
  add({ id: 'tb-route', type: 'line', source: 'tb-route', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#16db65', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 4.5, 17, 6.5] } });
  add({ id: 'tb-pins', type: 'circle', source: 'tb-pins',
    paint: {
      // Amber belongs to traffic. Places are white pins on a ground-coloured
      // ring, the start is the inverse, the destination is the one emerald mark.
      'circle-radius': ['match', ['get', 'role'], 'to', 9, 'from', 7, 6],
      'circle-color': ['match', ['get', 'role'], 'to', '#16db65', 'from', '#060708', '#ffffff'],
      'circle-stroke-color': ['match', ['get', 'role'], 'from', '#ffffff', '#060708'],
      'circle-stroke-width': 3,
    } });
  add({ id: 'tb-pos-acc', type: 'circle', source: 'tb-pos', filter: ['==', ['get', 'kind'], 'acc'],
    paint: { 'circle-color': '#16db65', 'circle-opacity': 0.14, 'circle-radius': ['get', 'px'] } });
  add({ id: 'tb-pos', type: 'circle', source: 'tb-pos', filter: ['==', ['get', 'kind'], 'dot'],
    paint: { 'circle-radius': 8, 'circle-color': '#16db65', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 } });
}

// ---------------- metro ----------------

export const METRO_LAYERS = ['tb-metro-casing', 'tb-metro-line', 'tb-metro-journey', 'tb-metro-st', 'tb-metro-label'];

/** Metro lines in their official colours, stations, and a highlighted journey. */
export function addMetro(map: MlMap, flavor: Flavor) {
  if (map.getSource('tb-metro')) return;
  for (const id of ['tb-metro', 'tb-metro-st', 'tb-metro-j']) map.addSource(id, { type: 'geojson', data: EMPTY });
  const ground = flavor === 'dark' ? '#060708' : '#ffffff';
  const before = map.getLayer('tb-alts') ? 'tb-alts' : undefined;
  // Metro mode keeps a faint Tehran underneath (see METRO_UNDERLAY); this
  // veil dims all of it evenly so the coloured lines own the screen.
  map.addLayer({ id: 'tb-metro-veil', type: 'background', layout: { visibility: 'none' },
    paint: { 'background-color': ground, 'background-opacity': flavor === 'dark' ? 0.5 : 0.55 } }, before);
  map.addLayer({ id: 'tb-metro-casing', type: 'line', source: 'tb-metro', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': ground, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 15, 9] } }, before);
  map.addLayer({ id: 'tb-metro-line', type: 'line', source: 'tb-metro', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': ['get', 'colour'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 15, 6], 'line-opacity': ['case', ['get', 'dim'], 0.25, 1] } }, before);
  map.addLayer({ id: 'tb-metro-journey', type: 'line', source: 'tb-metro-j', layout: { 'line-cap': 'round', 'line-join': 'round', visibility: 'none' },
    paint: { 'line-color': ['get', 'colour'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 15, 12] } });
  map.addLayer({ id: 'tb-metro-st', type: 'circle', source: 'tb-metro-st', layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', 'inter'], 4.5, 3], 15, ['case', ['get', 'inter'], 9, 6]],
      'circle-color': ground,
      'circle-stroke-color': ['case', ['get', 'sel'], '#16db65', ['get', 'colour']],
      'circle-stroke-width': ['case', ['get', 'sel'], 4, ['get', 'inter'], 3, 2],
    } });
  map.addLayer({ id: 'tb-metro-label', type: 'symbol', source: 'tb-metro-st', minzoom: 12,
    layout: { visibility: 'none', 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true },
    paint: { 'text-color': flavor === 'dark' ? '#f2f5f3' : '#070908', 'text-halo-color': ground, 'text-halo-width': 1.6 } });
}

export function setMetroVisible(map: MlMap, on: boolean) {
  for (const id of METRO_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

export function setData(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const s = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  s?.setData(data);
}

export const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
export const line = (coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords },
});
export const point = (c: [number, number], props: Record<string, unknown> = {}): GeoJSON.Feature => ({
  type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c },
});
