import React, { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl';
import {
  ArrowLeftRight, Footprints as WalkIcon,
  ArrowLeft, Banknote, BedDouble, Bike, Bookmark, Box, Car, Check, CircleCheck, Clock, History, Coffee, Compass, Ellipsis, Flag,
  Footprints, Fuel, Globe, Hospital, Landmark, Layers, LayoutGrid, LocateFixed, MapPin, Navigation, Pause, Phone, Pill, Play, Radio, Satellite,
  Camera, Copy, Search, Share2, ShoppingCart, SquareParking, Star, TrafficCone, TrainFront, Utensils, Users, X, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../app/ctx';
import { api, type Hit, type LngLat, type Mode, type Route } from '../lib/api';
import { fmtClock, fmtDistance, fmtDuration, humanError, instruction, kindLabel, nf, sep, type Key } from '../lib/i18n';
import { isMobile, locationSwitchOn, openAppPermissionSettings, openPhoneLocationSettings, requestLocationPermission, watch, type Fix, type LocProblem } from '../lib/location';
import { distM, isOffRoute, pointAlong, prepare, progress, type Prepared, type Progress } from '../lib/nav';
import { findRoutes } from '../lib/routing';
import { googleTiles, inIran } from '../lib/online';
import {
  add3dBuildings, addMetro, addOverlays, addTraffic, baseStyle, createMap, fc, forgetBasemapState,
  line, point, registerPack, set3dVisible, setBasemapHidden, setData, setGoogleBase, setMetroVisible, probeRaster, SAT_SOURCES, setRasterBase,
  setTrafficVisible, type BasePacks,
} from '../map/setup';
import { TurnIcon } from '../ui/TurnIcon';
import { useBack } from '../lib/back';
import { addRecent, clearRecent, onRecentChange, recentList, type Recent } from '../lib/recent';
import { DriverView, type DriverTarget } from '../ui/DriverView';
import { startRouteScan } from '../map/routeScan';
import { Puck } from '../map/puck';
import { SelPin } from '../map/selpin';
import { StreetView } from '../ui/StreetView';
import { MetroArrivals, minutesLeft, useArrivals } from '../ui/MetroArrivals';
import { buildNetwork, sliceLine, type Journey, type Network, type Station } from '../lib/metro';
import { sameStation } from '../lib/metroEta';
import { placeAll, sightings, TrainMarkers, type Sighting } from '../map/trains';
import { sweep } from '../lib/metroLive';
import { loadFavs, loadTrips, rememberTrip, toggleFav } from '../lib/metroSaved';
import { fold } from '../lib/fold';
import { placeMessage, shareText } from '../lib/share';

interface Place {
  at: LngLat;
  /** Label in the UI language. */
  label: string;
  /** Persian label, for showing a driver. */
  fa: string;
}

/** A place card: from search, a category, a tapped map label, or a dropped pin. */
interface Card {
  at: LngLat;
  name: string;
  nameAlt: string;
  /** Persian name and a Persian second line (address or "near <street>"). */
  fa: string;
  faLine: string;
  en: string;
  kind: string;
  hit: Hit | null;
  pin: boolean;
}

interface Note {
  text: string;
  kind: 'info' | 'ok' | 'warn';
  raw?: string;
}

const TEHRAN: LngLat = [51.389, 35.6892];
const RECHECK_MS = 180_000; // faster-route check while navigating online
const SAVE_GAIN_S = 180; // only offer a switch that saves at least 3 minutes

type Category = { id: Key; Icon: LucideIcon; kinds: string[] };
/** The four a field agent reaches for first; the rest sit under "More". */
const PRIMARY: Category[] = [
  { id: 'catFuel', Icon: Fuel, kinds: ['amenity=fuel'] },
  { id: 'catAtms', Icon: Banknote, kinds: ['amenity=atm', 'amenity=bank'] },
  { id: 'catPharmacy', Icon: Pill, kinds: ['amenity=pharmacy'] },
  { id: 'catHotels', Icon: BedDouble, kinds: ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel'] },
];
const SECONDARY: Category[] = [
  { id: 'catRestaurants', Icon: Utensils, kinds: ['amenity=restaurant', 'amenity=fast_food'] },
  { id: 'catCafes', Icon: Coffee, kinds: ['amenity=cafe'] },
  { id: 'catHospital', Icon: Hospital, kinds: ['amenity=hospital', 'amenity=clinic'] },
  { id: 'catGrocery', Icon: ShoppingCart, kinds: ['shop=supermarket', 'shop=convenience', 'shop=greengrocer'] },
  { id: 'catMetro', Icon: TrainFront, kinds: ['railway=station', 'railway=subway_entrance', 'public_transport=station'] },
  { id: 'catParking', Icon: SquareParking, kinds: ['amenity=parking'] },
  { id: 'catMosque', Icon: Landmark, kinds: ['amenity=place_of_worship'] },
];

type Snap = 'peek' | 'half' | 'full';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ms = (n: number) => (reducedMotion() ? 0 : n);

/** Room a route needs: beside the side panel on wide screens, above the sheet on phones. */
function routePadding() {
  if (window.innerWidth >= 900) return { top: 90, bottom: 90, left: 460, right: 90 };
  return { top: 120, bottom: 300, left: 50, right: 50 };
}

/** Room the metro framing leaves for the panel: beside it on wide screens,
 * above the sheet on phones. */
function framePadding(sheetOpen = false) {
  if (window.innerWidth >= 900) return { top: 60, bottom: 60, left: 450, right: 90 };
  return { top: 40, bottom: sheetOpen ? Math.round(window.innerHeight * 0.48) : 170, left: 24, right: 24 };
}

/** The dense middle of a network: the 5th to 95th percentile of stations on
 * each axis. Framing every station lets one long branch (Line 1's airport
 * spur) shrink the whole core to a corner; the branch is a pan away. */
function coreBox(pts: LngLat[]): [[number, number], [number, number]] {
  const q = (v: number[], f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
  const xs = pts.map((p) => p[0]).sort((a, b) => a - b);
  const ys = pts.map((p) => p[1]).sort((a, b) => a - b);
  return [[q(xs, 0.05), q(ys, 0.05)], [q(xs, 0.95), q(ys, 0.95)]];
}

/** Iran's extent, for a country pack that does not state its own. */
const IRAN_BOUNDS: [number, number, number, number] = [44.0, 25.0, 63.4, 39.8];

export function MapScreen({ active, metro = false }: { active: boolean; metro?: boolean }) {
  const { t, lang, dark, settings, online, intent, clearIntent } = useApp();
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const puckRef = useRef<Puck | null>(null);
  const selRef = useRef<SelPin | null>(null);
  const packUrl = useRef<BasePacks>({ city: null, country: null });
  const [ready, setReady] = useState(false);
  // Bumped on every style load: a theme or language swap drops added sources.
  const [styleGen, setStyleGen] = useState(0);
  const [noPack, setNoPack] = useState(false);

  const [fix, setFix] = useState<Fix | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const [locProblem, setLocProblem] = useState<LocProblem | null>(null);
  // Sent to a settings screen: retry the moment the person comes back.
  const awaitingSettings = useRef(false);
  const [follow, setFollow] = useState(false);
  const [locTry, setLocTry] = useState(0); // bump to ask for location again
  const [locAsk, setLocAsk] = useState(false);
  const askedLoc = useRef(false);
  const [pickLabel, setPickLabel] = useState('');
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(0);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [searching, setSearching] = useState(false);
  const [listTitle, setListTitle] = useState<string | null>(null);
  const [cat, setCat] = useState<Key | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [card, setCard] = useState<Card | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [driver, setDriver] = useState<DriverTarget | null>(null);
  const [sv, setSv] = useState<{ at: LngLat; title: string } | null>(null);
  const [from, setFrom] = useState<Place | null>(null); // null = my location
  const [to, setTo] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>(settings.default_mode);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [arrived, setArrived] = useState<Place | null>(null);

  const [nav, setNav] = useState<Prepared | null>(null);
  // Preview: no GPS yet, or a start chosen somewhere other than here. The
  // route is driven by a simulated position instead of leaving a blank screen.
  const [preview, setPreview] = useState(false);
  const [simAlong, setSimAlong] = useState(0);
  const [simPlay, setSimPlay] = useState(false);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const [offer, setOffer] = useState<{ route: Route; saves: number } | null>(null);

  const [layersOpen, setLayersOpen] = useState(false);
  const [traffic, setTraffic] = useState(true);
  const [satellite, setSatellite] = useState(false);
  const [satSrc, setSatSrc] = useState(0);
  const [b3d, setB3d] = useState(true);
  const [googleUrl, setGoogleUrl] = useState<{ kind: 'roadmap' | 'satellite'; url: string } | null>(null);

  const [recent, setRecent] = useState<Recent[]>(recentList);
  useEffect(() => onRecentChange(() => setRecent(recentList())), []);

  const [snap, setSnap] = useState<Snap>('peek');
  const [pickMode, setPickMode] = useState<'from' | 'to' | null>(null);
  const [placeName, setPlaceName] = useState<string | null>(null);

  // ---------- metro ----------
  const [net, setNet] = useState<Network | null>(null);
  const [mFrom, setMFrom] = useState<number | null>(null);
  const [mTo, setMTo] = useState<number | null>(null);
  const [mPick, setMPick] = useState<'from' | 'to' | null>(null);
  const [mQuery, setMQuery] = useState('');
  const [station, setStation] = useState<Station | null>(null);
  const [favs, setFavs] = useState(loadFavs);
  const [trips, setTrips] = useState(loadTrips);
  const metroRef = useRef(false);
  const stationTapRef = useRef<(key: string | null) => void>(() => {});

  // The map's handlers are bound once; they call the latest versions through these.
  const emptyRef = useRef<(at: LngLat) => void>(() => {});
  const tapRef = useRef<(name: string, nameEn: string, kind: string, at: LngLat) => void>(() => {});
  const pickRef = useRef<'from' | 'to' | null>(null);
  const navRef = useRef(false);

  const flavor = dark ? 'dark' : 'light';
  const route = routes[sel] ?? null;
  const here: LngLat | null = fix ? [fix.lng, fix.lat] : null;
  const origin: LngLat | null = from?.at ?? here;
  const center = (): LngLat => (mapRef.current ? (mapRef.current.getCenter().toArray() as LngLat) : here ?? TEHRAN);
  // Google tiles only with a key, online, and outside Iran (Google refuses Iranian networks).
  const googleOk = settings.has_google_key && online && !inIran(here ?? center());
  /** Where navigation thinks the agent is: the GPS fix, or the preview's simulated spot. */
  const pos: Fix | null = useMemo(() => {
    if (!nav || !preview) return fix;
    const at = pointAlong(nav, simAlong);
    return { lng: at[0], lat: at[1], accuracy: 5, speed: simPlay ? simSpeed(nav.route.mode) : 0, heading: routeBearing(nav, simAlong), t: Date.now() };
  }, [nav, preview, simAlong, simPlay, fix]);
  const prog: Progress | null = useMemo(() => (nav && pos ? progress(nav, [pos.lng, pos.lat]) : null), [nav, pos]);
  const nameOf = (h: { name: string; name_en: string }) => (lang === 'en' ? h.name_en || h.name : h.name);
  const altOf = (h: { name: string; name_en: string }) => {
    const main = nameOf(h);
    const alt = lang === 'en' ? h.name : h.name_en;
    return alt && alt !== main ? alt : '';
  };
  const warn = (raw: unknown) => {
    const r = raw instanceof Error ? raw.message : String(raw);
    setNote({ text: humanError(lang, r), kind: 'warn', raw: r });
  };

  // ---------- map lifecycle ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const packs = await api.packs();
      // The city pack is the one that ships a road graph (it is the only one
      // detailed enough to route on); a tiles-only pack beside it is the
      // country overview. Bounds cannot decide this: only graphs carry them.
      const tilePacks = packs.filter((p) => p.has_tiles);
      const tiles = tilePacks.find((p) => p.has_graph) ?? tilePacks[0];
      const countryPack = tilePacks.find((p) => p !== tiles && !p.has_graph);
      packUrl.current = {
        city: tiles ? registerPack(tiles.name) : null,
        country: countryPack ? registerPack(countryPack.name) : null,
      };
      setNoPack(!tiles);
      const b = tiles?.bounds;
      const cb = countryPack ? (countryPack.bounds ?? IRAN_BOUNDS) : null;
      const start: LngLat = b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : TEHRAN;
      const key = settings.has_neshan_web_key ? await api.secret('neshan_web_key') : null;
      if (cancelled || !el.current) return;
      const map = await createMap({ container: el.current, style: baseStyle(packUrl.current, flavor, lang), center: start, zoom: 11, neshanWebKey: key });
      mapRef.current = map;
      puckRef.current = new Puck(map);
      selRef.current = new SelPin(map);
      const fence = cb ?? b;
      if (fence) {
        const padX = (fence[2] - fence[0]) * 0.15;
        const padY = (fence[3] - fence[1]) * 0.15;
        map.setMaxBounds([[fence[0] - padX, fence[1] - padY], [fence[2] + padX, fence[3] + padY]]);
        map.setMinZoom(cb ? 4 : 9);
      }
      if (import.meta.env.DEV) (window as unknown as { __map: MlMap }).__map = map;
      map.on('style.load', () => {
        forgetBasemapState(map);
        addOverlays(map);
        add3dBuildings(map, dark ? 'dark' : 'light');
        addMetro(map, dark ? 'dark' : 'light');
        if (key) addTraffic(map, 'tb-alts');
        setReady(true);
        setStyleGen((n) => n + 1);
      });
      map.on('dragstart', () => setFollow(false));
      map.on('rotate', () => setBearing(map.getBearing()));
      map.on('pitch', () => setPitch(map.getPitch()));
      map.on('contextmenu', (e) => emptyRef.current([e.lngLat.lng, e.lngLat.lat]));
      map.on('click', (e) => {
        if (navRef.current) return;
        const tapped: LngLat = [e.lngLat.lng, e.lngLat.lat];
        if (pickRef.current) {
          emptyRef.current(tapped);
          return;
        }
        if (metroRef.current) {
          const st = nearestFeature(map, e.point, ['tb-metro-st', 'tb-metro-label'], (x) => x.properties?.key !== undefined);
          if (st?.properties?.key !== undefined) stationTapRef.current(String(st.properties.key));
          else stationTapRef.current(null);
          return; // metro shows the network only: no places or dropped pins
        }
        const layers = ['pois', 'places_subplace', 'places_locality'].filter((id) => map.getLayer(id));
        const f = nearestFeature(map, e.point, layers, (x) => !!x.properties?.name);
        if (!f) {
          emptyRef.current(tapped);
          return;
        }
        const p = f.properties as Record<string, string>;
        const at: LngLat = f.geometry.type === 'Point' ? (f.geometry.coordinates as LngLat) : tapped;
        tapRef.current(p.name, p['name:en'] ?? '', p.kind ?? f.sourceLayer ?? '', at);
      });
    })();
    return () => {
      cancelled = true;
      puckRef.current?.remove();
      puckRef.current = null;
      selRef.current?.remove();
      trainsRef.current?.remove();
      trainsRef.current = null;
      selRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.has_neshan_web_key]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) map.setStyle(baseStyle(packUrl.current, flavor, lang), { diff: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flavor, lang]);

  useEffect(() => {
    if (active) mapRef.current?.resize();
  }, [active]);

  // While navigating on a phone the tab bar gives its height back to the map.
  useEffect(() => {
    document.documentElement.dataset.nav = nav ? '1' : '';
    return () => {
      document.documentElement.dataset.nav = '';
    };
  }, [nav]);

  // ---------- location ----------
  useEffect(() => {
    let stop = () => {};
    let alive = true;
    let kept: Fix | null = null;
    void watch(
      (f) => {
        // Fixes arrive every second, and each one re-renders this whole
        // screen. Outside navigation, standing still is mostly GPS jitter:
        // keep a fix only when it moved, got notably better or worse, or
        // ten seconds passed. It also steadies the dot.
        if (!navRef.current && kept && f.t - kept.t < 10_000 && distM([kept.lng, kept.lat], [f.lng, f.lat]) < 3 && Math.abs(f.accuracy - kept.accuracy) < kept.accuracy * 0.3) return;
        kept = f;
        setFix(f);
        setLocErr(null);
        setLocProblem(null);
      },
      (m, p) => {
        // A passing hiccup while a fresh fix is in hand changes nothing on
        // screen. Off and denied are real and always get through.
        if (p === 'error' && kept && Date.now() - kept.t < 30_000) return;
        kept = null; // the next fix must get through to clear this
        setLocErr(m);
        setLocProblem(p);
      },
    ).then((s) => (alive ? (stop = s) : s()));
    return () => {
      alive = false;
      stop();
    };
  }, [locTry]);

  // Location refused or switched off: say so once, as a prompt with a way to
  // fix it, instead of a grey status line nobody reads.
  useEffect(() => {
    // On a phone, 'error' means permission and switch are fine and there is
    // simply no fix yet (indoors, GPS warming up): no dialog can help that.
    if (active && !metro && locErr && !fix && !askedLoc.current && !(isMobile && locProblem === 'error')) {
      askedLoc.current = true;
      setLocAsk(true);
    }
  }, [active, metro, locErr, fix, locProblem]);
  useEffect(() => {
    if (fix) setLocAsk(false);
  }, [fix]);
  // Coming back from a settings screen retries on its own. On phones only
  // after the app itself sent the person there: an unprompted retry would
  // re-open the permission dialog in a loop.
  useEffect(() => {
    if (!locErr) return;
    const again = () => {
      if (document.visibilityState !== 'visible') return;
      if (isMobile && !awaitingSettings.current) return;
      awaitingSettings.current = false;
      askedLoc.current = false; // if it still fails, explain again
      setLocTry((n) => n + 1);
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [locErr]);

  // ---------- push data to the map ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setData(map, 'tb-route', fc(route ? [line(route.coords)] : []));
    setData(map, 'tb-alts', fc(routes.filter((_, i) => i !== sel).map((r) => line(r.coords))));
  }, [routes, sel, route, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pins = [
      ...(nav || (to && !pickMode) ? [] : hits.map((h) => point([h.lon, h.lat], { role: 'hit' }))),
      // While an end is being chosen, the centre pin is its only mark.
      ...(from && pickMode !== 'from' ? [point(from.at, { role: 'from' })] : []),
      ...(to && pickMode !== 'to' ? [point(to.at, { role: 'to' })] : []),
    ];
    setData(map, 'tb-pins', fc(pins));
    // The open place card is marked by the dropping pin.
    if (card && !to && !pickMode && !nav) selRef.current?.show(card.at);
    else selRef.current?.hide();
  }, [hits, from, to, card, nav, ready, pickMode]);

  // Navigation camera: tilted into a semi-3D view, heading up, the car low on
  // the screen so the road ahead fills it. Linear easing over about one fix
  // interval makes the camera glide from fix to fix instead of hopping.
  const lastCam = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!pos) {
      // e.g. a no-GPS preview just ended: nothing to mark.
      puckRef.current?.set(null, null, 'dot');
      setData(map, 'tb-pos', fc([]));
      return;
    }
    const at: LngLat = nav && prog && prog.offBy < 30 ? prog.snapped : [pos.lng, pos.lat];
    const draw = () => {
      const mpp = (156543.03392 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** map.getZoom();
      setData(map, 'tb-pos', fc([point(at, { kind: 'acc', px: Math.min(200, pos.accuracy / mpp) })]));
    };
    // The marker: an extruded 3D arrow on the road while navigating, else a
    // dot with a heading cone once the device knows which way it is moving.
    const heading = nav && prog ? navHeading(nav, prog, pos) : pos.heading !== null && (pos.speed ?? 0) > 1 ? pos.heading : null;
    puckRef.current?.set(at, heading, nav ? 'nav' : 'dot');
    draw();
    map.on('zoom', draw);
    if (follow) {
      if (nav && prog) {
        const now = Date.now();
        const gap = lastCam.current ? Math.min(1200, now - lastCam.current) : 900;
        lastCam.current = now;
        const walk = nav.route.mode === 'walk';
        map.easeTo({
          center: at, bearing: navHeading(nav, prog, pos), pitch: walk ? 45 : 52,
          zoom: walk ? 17.6 : 17, duration: ms(gap), easing: (x) => x,
          offset: [0, map.getContainer().clientHeight * 0.2],
        });
      } else {
        map.easeTo({ center: at, duration: ms(600), zoom: Math.max(map.getZoom(), 14) });
      }
    }
    return () => {
      map.off('zoom', draw);
    };
  }, [pos, ready, follow, nav, prog]);

  // Preview drive: a steady simulated position along the route, one step a second.
  useEffect(() => {
    if (!nav || !preview || !simPlay) return;
    const id = window.setInterval(() => setSimAlong((a) => a + simSpeed(nav.route.mode)), 1000);
    return () => window.clearInterval(id);
  }, [nav, preview, simPlay]);

  // A preview that was only waiting for GPS hands over the moment a fix arrives.
  useEffect(() => {
    if (nav && preview && !from && fix) {
      setPreview(false);
      setSimPlay(false);
    }
  }, [nav, preview, from, fix]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) setTrafficVisible(map, traffic && online && !satellite);
  }, [traffic, online, satellite, ready, styleGen]);

  // While driving the buildings stay, but glassy, so the tilted view reads as
  // a city without a tower ever hiding the route or the car.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) set3dVisible(map, b3d && !satellite, nav !== null);
  }, [b3d, satellite, ready, nav, styleGen]);

  /** Turning 3D on at a flat, far-out view changes nothing visible, which
   * reads as broken: tilt and come close enough for the buildings to rise. */
  const toggle3d = (on: boolean) => {
    setB3d(on);
    const map = mapRef.current;
    if (!map || nav) return;
    if (on) map.easeTo({ pitch: 55, zoom: Math.max(map.getZoom(), 16), duration: ms(700) });
    else map.easeTo({ pitch: 0, duration: ms(500) });
  };

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const want: 'roadmap' | 'satellite' | null = satellite ? 'satellite' : route?.provider === 'google' ? 'roadmap' : null;
    if (!want) {
      setGoogleBase(map, null);
      return;
    }
    // No usable Google key (none set, or inside Iran where Google refuses):
    // satellite comes from free keyless imagery with our labels over it.
    if (want === 'satellite' && !googleOk) {
      const src = SAT_SOURCES[satSrc];
      setRasterBase(map, src.url, src.attribution, true, src.maxzoom);
      return;
    }
    if (googleUrl?.kind === want) {
      setGoogleBase(map, googleUrl.url);
      return;
    }
    void api.secret('google_key').then(async (k) => {
      if (!k) return;
      try {
        setGoogleUrl({ kind: want, url: await googleTiles(k, lang, want) });
      } catch (err) {
        warn(err);
        if (want === 'satellite') setSatellite(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [satellite, route, googleUrl, ready, lang, styleGen, googleOk, satSrc]);

  // ---------- map <-> satellite: a radar sweep ----------
  // The current view freezes as a picture; a radar beam circles the city
  // while the new base loads underneath; then the beam locks on and a ping
  // expands from the centre, opening the new view inside its ring.
  const scanWrap = useRef<HTMLDivElement>(null);
  const scanOld = useRef<HTMLDivElement>(null);
  const radarBeam = useRef<HTMLDivElement>(null);
  const radarWave = useRef<HTMLDivElement>(null);
  const [scanImg, setScanImg] = useState<string | null>(null);
  const [scanFade, setScanFade] = useState(false); // leaving satellite: crossfade only
  const scanning = useRef(false);
  const TURN_MS = 1300;
  // Which keyless imagery host works on this connection. Once one fails it
  // stays skipped for the session, so the next switch goes straight on.
  const satSrcRef = useRef(0);
  satSrcRef.current = satSrc;
  /** Turns satellite on and proves tiles actually arrive, falling back
   * through SAT_SOURCES; false means no imagery host is reachable. */
  const loadImagery = async (map: MlMap): Promise<boolean> => {
    let i = satSrcRef.current;
    const hostOf = (n: number) => new URL(SAT_SOURCES[n].url.replace(/\{[a-z]\}/g, '0')).host;
    let probe = probeRaster(map, googleOk ? null : hostOf(i));
    setSatellite(true);
    if (googleOk) return probe;
    while (!(await probe)) {
      if (++i >= SAT_SOURCES.length) return false;
      probe = probeRaster(map, hostOf(i));
      setSatSrc(i);
    }
    return true;
  };
  const satFailed = () => {
    setSatellite(false);
    setNote({ text: t('satelliteBlocked'), kind: 'warn' });
  };
  const idleOr = (map: MlMap, ms: number) => new Promise<void>((res) => {
    const tm = window.setTimeout(res, ms);
    map.once('idle', () => { window.clearTimeout(tm); res(); });
  });
  const switchBase = async (sat: boolean) => {
    const map = mapRef.current;
    if (sat === satellite || scanning.current) return;
    let frame: string | null = null;
    if (map && !reducedMotion()) {
      try {
        map.redraw();
        // A phone canvas is about 3x the screen in pixels; encoding all of it
        // stalls the tap. Downscale the frozen frame first (it is only seen
        // for a second, under the radar).
        const c = map.getCanvas();
        const k = Math.min(1, (isMobile ? 720 : 1400) / Math.max(c.width, c.height));
        if (k < 1) {
          const small = document.createElement('canvas');
          small.width = Math.round(c.width * k);
          small.height = Math.round(c.height * k);
          small.getContext('2d')!.drawImage(c, 0, 0, small.width, small.height);
          frame = small.toDataURL('image/jpeg', 0.72);
        } else frame = c.toDataURL('image/jpeg', 0.8);
      } catch {
        frame = null;
      }
    }
    if (!map || !frame) {
      if (!sat || !map) return setSatellite(sat);
      if (!(await loadImagery(map))) satFailed();
      return;
    }
    scanning.current = true;
    // Phones: the popup would sit over the radar; the choice is made, close it.
    if (isMobile) setLayersOpen(false);
    setScanFade(!sat);
    setScanImg(frame);
    if (!sat) setSatellite(false);
    const frameWait = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    await frameWait();
    await frameWait();
    // Back to the map: no radar, just a smooth fade from the satellite picture
    // to the map once it has drawn underneath.
    if (!sat) {
      await new Promise<void>((res) => {
        const t = window.setTimeout(res, 1500);
        map.once('idle', () => { window.clearTimeout(t); res(); });
      });
      await scanOld.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 650, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' })
        .finished.catch(() => undefined);
      setScanImg(null);
      scanning.current = false;
      return;
    }
    // Tiles must really arrive before anything is revealed; a host that
    // refuses this network falls through to the next one meanwhile.
    let result: boolean | null = null;
    const loading = loadImagery(map).then(async (ok) => {
      if (ok) await idleOr(map, 2500);
      result = ok;
    });
    const wrap = scanWrap.current;
    const beam = radarBeam.current;
    if (wrap && beam) {
      // Wide screens: the beam reaches every corner from the centre. Phones:
      // a compact radar disc in the middle; a beam the size of the whole
      // screen read as a wall of green on a small display.
      const r = isMobile
        ? Math.round(Math.min(wrap.clientWidth, wrap.clientHeight) * 0.4)
        : Math.ceil(Math.hypot(wrap.clientWidth, wrap.clientHeight) / 2) + 4;
      Object.assign(beam.style, { width: `${2 * r}px`, height: `${2 * r}px`, margin: `${-r}px 0 0 ${-r}px` });
      wrap.style.setProperty('--ring', `${isMobile ? Math.round(r / 3) : Math.max(70, Math.round(r / 5))}px`);
      wrap.style.setProperty('--radar-r', `${r}px`);
      wrap.classList.toggle('compact', isMobile);
      if (isMobile) {
        // Centre the disc in the map a person can actually see: between the
        // search bar and the top of the sheet, not behind the sheet.
        const box = wrap.getBoundingClientRect();
        const sheetTop = wrap.parentElement?.querySelector('.sheet')?.getBoundingClientRect().top ?? box.bottom;
        const topBar = wrap.parentElement?.querySelector('.topbar')?.getBoundingClientRect().bottom ?? box.top;
        const cy = Math.max(r + 8, Math.min(box.height - r - 8, (topBar + Math.min(sheetTop, box.bottom)) / 2 - box.top));
        wrap.style.setProperty('--cy', `${Math.round(cy)}px`);
        const fit = Math.max(60, Math.min(r, (Math.min(sheetTop, box.bottom) - topBar) / 2 - 12));
        Object.assign(beam.style, { width: `${2 * fit}px`, height: `${2 * fit}px`, margin: `${-fit}px 0 0 ${-fit}px` });
        wrap.style.setProperty('--radar-r', `${Math.round(fit)}px`);
        wrap.style.setProperty('--ring', `${Math.round(fit / 3)}px`);
      }
    }
    const turn = () => beam?.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: TURN_MS, easing: 'linear' }).finished.catch(() => undefined);
    // Sweep the frozen city until the new view has loaded.
    do {
      await turn();
    } while (result === null && scanning.current);
    await loading;
    if (!result) {
      // No imagery on this connection: drop the frozen frame (it is the map
      // itself) and say why, rather than revealing the same map again.
      await scanWrap.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: 'forwards' }).finished.catch(() => undefined);
      setScanImg(null);
      scanning.current = false;
      satFailed();
      return;
    }
    // Lock on: the beam fades and the centre flashes...
    const turning = turn();
    wrap?.classList.add('locked');
    const R = wrap ? Math.ceil(Math.hypot(wrap.clientWidth, wrap.clientHeight) / 2) + 80 : 900;
    wrap?.querySelector('.radar-flash')?.animate(
      [{ opacity: 0, transform: 'scale(0.4)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1.6)' }],
      { duration: 520, easing: 'ease-out' },
    );
    // ...and a ping rolls outward, the new view opening inside it.
    const wave = radarWave.current;
    // The ring rides the middle of the reveal's soft edge, so both share one
    // scale-from-zero motion: same duration, same easing, no extra keyframes.
    const W = R + 35;
    if (wave) Object.assign(wave.style, { width: `${2 * W}px`, height: `${2 * W}px`, margin: `${-W}px 0 0 ${-W}px` });
    const PING_MS = 1150;
    const ease = 'cubic-bezier(0.3, 0, 0.15, 1)';
    await Promise.all([
      wave?.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], { duration: PING_MS, easing: ease, fill: 'forwards' }).finished.catch(() => undefined),
      wave?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: PING_MS, fill: 'forwards' }).finished.catch(() => undefined),
      // Phones: the mask redraw is a full-screen repaint every frame, so the
      // frame fades (composited) while the ring rolls out instead.
      isMobile
        ? scanOld.current?.animate([{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: PING_MS, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => undefined)
        : scanOld.current?.animate(
          [{ '--reveal': '0px' }, { '--reveal': `${R + 70}px` }] as Keyframe[],
          { duration: PING_MS, easing: ease, fill: 'forwards' },
        ).finished.catch(() => undefined),
    ]);
    void turning;
    setScanImg(null);
    scanning.current = false;
  };

  // The fallback imagery stops at zoom 15; past about 16 it is only stretched
  // pixels, which looks like loading stalled. Cap the zoom while it is shown.
  const coarseSat = satellite && !googleOk && SAT_SOURCES[satSrc].maxzoom < 17;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setMaxZoom(coarseSat ? SAT_SOURCES[satSrc].maxzoom + 1.5 : 19);
    if (coarseSat) setNote({ text: t('satLowDetail'), kind: 'info' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coarseSat, ready]);

  // Satellite needs the internet; drop back to the offline map when it goes.
  useEffect(() => {
    if (!online) setSatellite(false);
  }, [online]);

  // ---------- search, categories, place cards ----------
  const fitHits = (hs: Hit[]) => {
    const near = [...hs].sort((x, y) => x.distance_m - y.distance_m).slice(0, 8);
    if (near.length && mapRef.current) {
      mapRef.current.fitBounds(bbox(near.map((h) => [h.lon, h.lat] as LngLat)), { padding: { top: 140, bottom: 220, left: 60, right: 60 }, maxZoom: 15.5, duration: ms(500) });
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      if (!cat) {
        setHits([]);
        setListTitle(null);
      }
      setSearching(false);
      return;
    }
    setCat(null);
    setCard(null);
    setSearching(true);
    setListTitle(t('searchPlaceholder'));
    setSnap('half');
    const id = window.setTimeout(() => {
      void api
        .search(q, here ?? center())
        .then((hs) => {
          setHits(hs);
          fitHits(hs);
        })
        .catch(warn)
        .finally(() => setSearching(false));
    }, 160);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const runCategory = async (c: Category) => {
    setCatsOpen(false);
    if (cat === c.id) {
      setCat(null);
      setHits([]);
      setListTitle(null);
      return;
    }
    setCat(c.id);
    setCard(null);
    setQuery('');
    setListTitle(t(c.id));
    setSearching(true);
    setSnap('half');
    try {
      const hs = await api.nearby(c.kinds, center(), 6000);
      setHits(hs);
      fitHits(hs);
    } catch (err) {
      warn(err);
    } finally {
      setSearching(false);
    }
  };

  const openCard = (c: Card) => {
    setCard(c);
    setMoreOpen(false);
    setPlaceName(null);
    setNote(null);
    setSnap('half');
  };

  const cardFromHit = (h: Hit): Card => ({
    at: [h.lon, h.lat],
    name: nameOf(h),
    nameAlt: altOf(h),
    fa: h.name || h.name_en,
    faLine: h.address,
    en: h.name_en || h.name,
    kind: h.kind,
    hit: h,
    pin: false,
  });

  const tapPlace = async (name: string, nameEn: string, kind: string, at: LngLat) => {
    const h = await api.placeAt(name, at).catch(() => null);
    if (h) openCard(cardFromHit(h));
    else
      openCard({
        at, name: lang === 'en' ? nameEn || name : name, nameAlt: lang === 'en' && nameEn ? name : '',
        fa: name, faLine: '', en: nameEn || name, kind, hit: null, pin: false,
      });
  };

  /** Nearest named road, in both scripts, for a dropped pin or a picked route end. */
  const roadLabel = async (at: LngLat) => {
    const rd = await api.roadAt(at).catch(() => null);
    if (!rd) return null;
    return {
      ui: `${t('near')} ${lang === 'en' ? rd.name_en || rd.name : rd.name}`,
      alt: lang === 'en' && rd.name_en ? rd.name : '',
      fa: `نزدیک ${rd.name}`,
      en: `Near ${rd.name_en || rd.name}`,
    };
  };

  const tapEmpty = async (at: LngLat) => {
    const label = await roadLabel(at);
    if (pickMode) {
      const place: Place = { at, label: label?.ui ?? fmtLL(at), fa: label?.fa ?? '' };
      if (pickMode === 'from') setFrom(place);
      else setTo(place);
      setPickMode(pickMode === 'from' && !to ? 'to' : null);
      setNote(null);
      setSnap('half');
      return;
    }
    openCard({
      at, name: label?.ui ?? t('droppedPin'), nameAlt: label?.alt ?? '', fa: label?.fa ?? '', faLine: '',
      en: label?.en ?? '', kind: '', hit: null, pin: true,
    });
  };

  metroRef.current = metro;
  stationTapRef.current = (key) => {
    if (key === null) return setStation(null);
    const s = net?.stations[Number(key)];
    if (s) {
      // Two taps plan a trip: the first is the start, the second the
      // destination. A tap after that starts a new trip.
      if (mFrom !== null && mTo === null && s.id !== mFrom) {
        setMTo(s.id);
        setStation(null);
        setMPick(null);
        setSnap('half');
        return; // the journey framing takes the camera
      }
      setMFrom(s.id);
      setMTo(null);
      setMPick(null);
      setStation(s);
      setSnap('half');
      // Glide it into the open part of the screen, clear of the card that
      // is about to open over it. An offset, not padding: easeTo's padding
      // would stay on the map for every later move.
      const map = mapRef.current;
      const p = framePadding(true);
      map?.easeTo({ center: s.at, zoom: Math.max(map.getZoom(), 12), offset: [(p.left - p.right) / 2, (p.top - p.bottom) / 2], duration: ms(450) });
    }
  };
  tapRef.current = (name, nameEn, kind, at) => void tapPlace(name, nameEn, kind, at);
  emptyRef.current = (at) => void tapEmpty(at);
  pickRef.current = pickMode;
  navRef.current = nav !== null;

  /** Choose a route end: a clean search box, so the pin view shows first. */
  const beginPick = (m: 'from' | 'to') => {
    setQuery('');
    setPickMode(m);
  };

  const chooseHit = (h: Hit) => {
    addRecent({ name: h.name, name_en: h.name_en, kind: h.kind, lon: h.lon, lat: h.lat });
    if (pickMode) {
      const place: Place = { at: [h.lon, h.lat], label: nameOf(h), fa: [h.name || h.name_en, h.address].filter(Boolean).join('، ') };
      if (pickMode === 'from') setFrom(place);
      else setTo(place);
      setPickMode(pickMode === 'from' && !to ? 'to' : null);
      setQuery('');
      setHits([]);
      setListTitle(null);
      setSnap('half');
      return;
    }
    openCard(cardFromHit(h));
    mapRef.current?.flyTo({ center: [h.lon, h.lat], zoom: Math.max(mapRef.current.getZoom(), 15.5), duration: ms(600) });
  };

  const directionsTo = (c: Card) => {
    setTo({ at: c.at, label: c.name || fmtLL(c.at), fa: [c.fa, c.faLine].filter(Boolean).join('، ') });
    setCard(null);
    setArrived(null);
    setSnap('half');
  };

  const showDriverFor = (c: { fa: string; faLine: string; en: string; at: LngLat }) =>
    setDriver({ fa: c.fa || c.en, faLine: c.faLine, en: c.en, distanceM: here ? distM(here, c.at) : null });

  /** The location button: go there now, or explain why it can't. */
  const locateMe = () => {
    setFollow(true);
    const map = mapRef.current;
    if (nav) return;
    if (fix && map) {
      map.flyTo({ center: [fix.lng, fix.lat], zoom: Math.max(map.getZoom(), 15.5), duration: ms(700) });
      return;
    }
    if (locErr && !(isMobile && locProblem === 'error')) setLocAsk(true);
    else setNote({ text: t('locatingHint'), kind: 'info' });
  };
  /** "Allow" must always lead somewhere: the permission prompt, or the
   * settings screen that can actually fix it when the prompt cannot. */
  const allowLocation = async () => {
    setLocAsk(false);
    if (!isMobile) {
      void api.openLocationSettings().catch(warn);
      return;
    }
    // Checked live, not from the last error: the switch may have changed.
    if (!locationSwitchOn()) {
      // The phone's location switch is off: no permission prompt can help.
      awaitingSettings.current = true;
      openPhoneLocationSettings();
      return;
    }
    const { granted } = await requestLocationPermission().catch(() => ({ granted: false }));
    if (!granted) {
      // Refused before with "don't ask again": Android shows no prompt any
      // more, so open the app's own permission page instead of doing nothing.
      awaitingSettings.current = true;
      openAppPermissionSettings();
      return;
    }
    askedLoc.current = false;
    setLocErr(null);
    setLocProblem(null);
    setNote({ text: t('locatingHint'), kind: 'info' });
    setLocTry((n) => n + 1);
  };
  const useMyLocation = () => {
    if (!here) return locateMe();
    setFrom(null);
    setPickMode(to ? null : 'to');
    setSnap('half');
  };
  const startFromCard = (c: Card) => {
    setFrom({ at: c.at, label: c.name || fmtLL(c.at), fa: [c.fa, c.faLine].filter(Boolean).join('، ') });
    setCard(null);
    if (!to) beginPick('to');
    setSnap('half');
  };

  // Pick mode: name the spot under the centre pin as the map settles.
  useEffect(() => {
    const map = mapRef.current;
    if (!pickMode || !map) return;
    let live = true;
    const name = () => {
      const at = map.getCenter().toArray() as LngLat;
      void roadLabel(at).then((l) => live && setPickLabel(l?.ui ?? fmtLL(at)));
    };
    name();
    map.on('moveend', name);
    return () => {
      live = false;
      map.off('moveend', name);
      setPickLabel('');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode, ready]);

  // ---------- routing ----------
  const plan = useCallback(
    async (start: LngLat, dest: LngLat) => {
      setBusy(true);
      setNote(null);
      try {
        const r = await findRoutes(settings, mode, start, dest);
        setRoutes(r.routes);
        setSel(0);
        if (r.note) setNote({ text: humanError(lang, r.note), kind: 'info', raw: r.note });
        return r.routes;
      } catch (err) {
        setRoutes([]);
        warn(err);
        return [];
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings, mode, lang],
  );

  useEffect(() => {
    if (!to || !origin || nav) return;
    // The "finding your route" show: Map screen only, never in Metro.
    const map = mapRef.current;
    const scan = map && !metro ? startRouteScan(map, origin, to.at, mode, { padding: routePadding() }) : null;
    if (map && scan) map.fitBounds(bbox([origin, to.at]), { padding: routePadding(), bearing: 0, pitch: 0, maxZoom: 15, duration: ms(500) });
    let live = true;
    void plan(origin, to.at).then((rs) => {
      if (!live) return;
      const c = rs[0]?.coords;
      // With the show running, it frames the route itself at the reveal.
      if (scan) void scan.resolve(c ?? null);
      else if (mapRef.current && c?.length) {
        mapRef.current.fitBounds(bbox(c), { padding: routePadding(), bearing: 0, pitch: 0, duration: ms(700) });
      }
    });
    return () => {
      live = false;
      scan?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, from, mode, plan]);

  const startNav = () => {
    if (!route) return;
    const p = prepare(route);
    // Real guidance needs a fix near the route's start. Without one (GPS off,
    // or a start picked elsewhere) it opens as a preview rather than nothing.
    const gpsHere = !!fix && (!from || distM([fix.lng, fix.lat], route.coords[0]) < 400);
    setPreview(!gpsHere);
    setSimAlong(0);
    setSimPlay(false);
    lastCam.current = 0;
    setNav(p);
    setFollow(true);
    setHits([]);
    setLayersOpen(false);
    offCount.current = 0;
    void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock
      ?.request('screen')
      .catch(() => undefined);
  };
  const stopNav = () => {
    setNav(null);
    setPreview(false);
    setSimPlay(false);
    setOffer(null);
    mapRef.current?.easeTo({ pitch: 0, bearing: 0, offset: [0, 0], duration: ms(600) });
  };
  const clearAll = () => {
    stopNav();
    setRoutes([]);
    setTo(null);
    setFrom(null);
    setQuery('');
    setNote(null);
    setGoogleUrl(null);
    setHits([]);
    setCat(null);
    setListTitle(null);
    setCard(null);
    setPickMode(null);
    setArrived(null);
    setSnap('peek');
  };

  // Android Back: close the newest thing first, one step per press.
  useBack(() => {
    if (!active) return false;
    if (sv) return setSv(null), true;
    if (locAsk) return setLocAsk(false), true;
    if (driver) return setDriver(null), true;
    if (layersOpen) return setLayersOpen(false), true;
    if (metro) {
      // One step back per press: the destination, then the start.
      if (mPick) return setMPick(null), true;
      if (mTo !== null) return setMTo(null), setStation(mFrom !== null && net ? net.stations[mFrom] : null), true;
      if (mFrom !== null) return setMFrom(null), setStation(null), true;
      if (station) return setStation(null), true;
      return false;
    }
    if (nav) return stopNav(), true;
    if (pickMode) return setPickMode(null), setQuery(''), setSnap('half'), true;
    if (placeName !== null) return setPlaceName(null), true;
    if (card) return setCard(null), true;
    if (catsOpen) return setCatsOpen(false), true;
    if (arrived || to || routes.length) return clearAll(), true;
    if (query || hits.length || cat) return setQuery(''), setHits([]), setCat(null), setListTitle(null), true;
    if (snap !== 'peek') return setSnap('peek'), true;
    return false;
  });

  useEffect(() => {
    if (!nav || !pos || !to || !prog) return;
    const p = prog;
    // A preview standing at the start has not "arrived" on a tiny route yet.
    if ((p.remainingM < 30 || distM([pos.lng, pos.lat], to.at) < 25) && (!preview || simAlong > 0)) {
      stopNav();
      setRoutes([]);
      setArrived(to);
      setTo(null);
      setSnap('half');
      return;
    }
    if (preview) return; // a simulated position never leaves the route
    offCount.current = isOffRoute(p, pos.accuracy) ? offCount.current + 1 : 0;
    if (offCount.current >= 3 && Date.now() - lastReroute.current > 15_000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      setNote({ text: t('offRoute'), kind: 'info' });
      void plan([pos.lng, pos.lat], to.at).then((rs) => rs[0] && setNav(prepare(rs[0])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prog, to, plan, t]);

  useEffect(() => {
    if (!nav || !to || preview || nav.route.provider === 'offline') return;
    const id = window.setInterval(async () => {
      if (!navigator.onLine || !fix || offer) return;
      const r = await findRoutes(settings, mode, [fix.lng, fix.lat], to.at).catch(() => null);
      const best = r?.routes[0];
      const cur = prog?.remainingS ?? Infinity;
      if (best && best.provider !== 'offline' && cur - best.duration_s >= SAVE_GAIN_S) setOffer({ route: best, saves: cur - best.duration_s });
    }, RECHECK_MS);
    return () => window.clearInterval(id);
  }, [nav, to, fix, prog, offer, settings, mode, preview]);

  // ---------- trip recording ----------

  useEffect(() => {
    if (!intent || !ready) return;
    if (intent.kind === 'navigate') document.getElementById('map-search')?.focus();
    if (intent.kind === 'place') {
      openCard({ at: intent.at, name: intent.label, nameAlt: '', fa: intent.label, faLine: '', en: intent.label, kind: '', hit: null, pin: true });
      mapRef.current?.flyTo({ center: intent.at, zoom: 15.5, duration: ms(600) });
    }
    clearIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, ready]);

  const savePlace = async (at: LngLat, nameIn: string) => {
    const name = nameIn.trim();
    if (!name) return;
    await api.placeSave({ name, lat: at[1], lon: at[0], note: '' });
    setPlaceName(null);
    setNote({ text: `${t('savePlace')}: ${name}`, kind: 'ok' });
  };

  const sharePlace = async (c: Card) => {
    const how = await shareText(c.name || t('droppedPin'), placeMessage({ fa: c.fa, en: c.en, line: c.faLine, at: c.at }));
    if (how === 'copied') setNote({ text: t('copied'), kind: 'ok' });
  };
  const shareMine = async () => {
    if (!fix) return locateMe();
    const at: LngLat = [fix.lng, fix.lat];
    const label = await roadLabel(at);
    const how = await shareText(t('myLocationTitle'), placeMessage({ fa: label?.fa, en: label?.en, at }));
    if (how === 'copied') setNote({ text: t('copied'), kind: 'ok' });
  };

  const copyCard = (c: Card) => {
    // What a driver or colleague can use: the Persian name and address first, then coordinates.
    const text = [c.fa, c.faLine, c.en !== c.fa ? c.en : '', `${c.at[1].toFixed(6)}, ${c.at[0].toFixed(6)}`].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(text).then(() => setNote({ text: t('copied'), kind: 'ok' }));
  };

  const providerLabel = (r: Route) =>
    r.provider === 'neshan' ? t('providerNeshan') : r.provider === 'google' ? t('providerGoogle') : t('providerOffline');
  const delay = useMemo(() => (route?.duration_free_s ? route.duration_s - route.duration_free_s : null), [route]);

  useEffect(() => {
    if (!layersOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLayersOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layersOpen]);

  // ---------- metro: load, draw, plan ----------
  useEffect(() => {
    if (!metro || net) return;
    void api.transit().then((lines) => setNet(lines.length ? buildNetwork(lines) : buildNetwork([])));
  }, [metro, net]);

  const journey: Journey | null = useMemo(
    () => (net && mFrom !== null && mTo !== null ? net.plan(mFrom, mTo) : null),
    [net, mFrom, mTo],
  );
  useEffect(() => {
    if (net && journey && mFrom !== null && mTo !== null) setTrips((x) => rememberTrip(x, { from: net.stations[mFrom].name, to: net.stations[mTo].name }));
  }, [journey]); // eslint-disable-line react-hooks/exhaustive-deps
  const byName = (name: string) => net?.stations.find((x) => x.name === name);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setMetroVisible(map, metro);
    setBasemapHidden(map, metro);
    if (!metro || !net) return;
    // A planned journey dims the whole network and redraws its own legs on
    // the lines' real shape, so it reads as one bright path.
    const onJourney = new Set(journey?.legs.flatMap((l) => [l.from.at, l.to.at, ...l.path]) ?? []);
    setData(map, 'tb-metro', fc(net.lines.flatMap((l) => l.geom.map((g) => line(g, { colour: l.colour, dim: journey !== null })))));
    setData(map, 'tb-metro-st', fc(net.stations.map((s) =>
      point(s.at, {
        key: s.id, inter: s.lines.length > 1, colour: net.colourOf(s.lines[0]),
        sel: s.id === mFrom || s.id === mTo || s.id === station?.id,
        dim: journey !== null && !onJourney.has(s.at),
        label: lang === 'en' ? cleanName(s.name_en || s.name) : cleanName(s.name),
      }),
    )));
    setData(map, 'tb-metro-j', fc((journey?.legs ?? []).map((l) =>
      line(sliceLine(net.lines.filter((x) => x.ref === l.line).flatMap((x) => x.geom), l.path), { colour: l.colour }))));
  }, [metro, net, ready, journey, mFrom, mTo, station, lang]);

  // ---------- metro: live trains ----------
  // Arrivals for the station in focus: the open station card, or else the
  // boarding station of a planned journey (and then only its direction).
  const etaFocus = metro && active && !nav ? (station ?? (!mPick ? journey?.legs[0]?.from : undefined) ?? null) : null;
  const etaToward = !station ? journey?.legs[0]?.toward : undefined;
  const arrivals = useArrivals(etaFocus?.name ?? null);
  // Every train on the network, from the slow sweep (lib/metroLive.ts), kept
  // in a ref: readings arrive about once a second and need no re-render, the
  // markers read them on their own tick.
  const sweepRef = useRef(new Map<number, Sighting[]>());
  const sweeping = metro && active && online && !!net;
  useEffect(() => {
    if (!sweeping || !net) return;
    const ctl = new AbortController();
    const seen = sweepRef.current;
    void sweep(net, (id, rows, at) => seen.set(id, sightings(net, net.stations[id], rows, at)), ctl.signal);
    return () => ctl.abort();
  }, [sweeping, net]);

  const trainsRef = useRef<TrainMarkers | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const tm = (trainsRef.current ??= new TrainMarkers(map));
    if (!net || !metro || !active || nav) return tm.run(null);
    const rows = arrivals.rows;
    const focus = etaFocus && Array.isArray(rows) ? sightings(net, etaFocus, rows, arrivals.at, etaToward) : [];
    const seen = sweepRef.current;
    tm.run(
      () => {
        const now = Date.now();
        // Readings older than three minutes have drifted too far to trust.
        const network = [...seen.values()].flat().filter((x) => now - x.at < 180_000);
        return placeAll(net, network, focus, now);
      },
      (m) => (m === 0 ? t('etaArriving') : `${nf(lang, m)} ${t('etaMin')}`),
    );
    return () => tm.run(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivals, net, ready, metro, active, nav, etaFocus?.id, etaToward?.id, lang]);

  // Map and Metro share one map, so the switch is a soft cross-fade of the
  // map and a rise of the panel rather than the layers snapping over.
  const firstMode = useRef(true);
  useEffect(() => {
    if (firstMode.current) { firstMode.current = false; return; }
    if (!active || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    el.current?.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 380, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    el.current?.parentElement?.querySelector('.sheet')?.animate(
      [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }],
      { duration: 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', composite: 'add' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metro]);

  // Metro is a diagram over a quiet city: flat, north up, framed on the
  // network and kept near it, with a little room to zoom out and pan round
  // the edges. Leaving restores the map's own limits.
  const framed = useRef(false);
  const mapLimits = useRef<{ bounds: ReturnType<MlMap['getMaxBounds']>; minZoom: number; maxZoom: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!metro) {
      framed.current = false;
      const saved = mapLimits.current;
      if (saved) {
        mapLimits.current = null;
        map.setMinZoom(saved.minZoom);
        map.setMaxZoom(saved.maxZoom);
        map.setMaxBounds(saved.bounds);
        map.dragRotate.enable();
        map.touchZoomRotate.enableRotation();
        map.touchPitch.enable();
      }
      return;
    }
    if (!net || framed.current || !net.stations.length) return;
    framed.current = true;
    mapLimits.current = { bounds: map.getMaxBounds(), minZoom: map.getMinZoom(), maxZoom: map.getMaxZoom() };
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.touchPitch.disable();
    map.setMaxBounds(null);
    map.setMaxZoom(15.5);
    const all = bbox(net.stations.map((s) => s.at));
    map.jumpTo({ bearing: 0, pitch: 0 }); // fires its own moveend at once, before the lock below
    map.once('moveend', () => {
      if (!metroRef.current) return;
      // Breathing room rather than a hard frame: almost a zoom level out
      // and a margin round the network, but never off into the rest of the
      // country. The bounds must hold the zoomed-out view, or MapLibre
      // would refuse that zoom.
      const v = map.getBounds();
      const [cx, cy] = [(v.getWest() + v.getEast()) / 2, (v.getSouth() + v.getNorth()) / 2];
      const [hw, hh] = [(v.getEast() - v.getWest()) * 1.1, (v.getNorth() - v.getSouth()) * 1.1];
      map.setMinZoom(map.getZoom() - 0.8);
      map.setMaxBounds([
        [Math.min(cx - hw, all[0][0] - 0.05), Math.min(cy - hh, all[0][1] - 0.05)],
        [Math.max(cx + hw, all[1][0] + 0.05), Math.max(cy + hh, all[1][1] + 0.05)],
      ]);
    });
    map.fitBounds(coreBox(net.stations.map((s) => s.at)), { padding: framePadding(), duration: ms(600) });
  }, [metro, net]);

  useEffect(() => {
    if (!journey || !mapRef.current) return;
    mapRef.current.fitBounds(bbox(journey.legs.flatMap((l) => l.path)), { padding: framePadding(true), maxZoom: 13, duration: ms(600) });
  }, [journey]);

  const stationHits = useMemo(() => {
    if (!net || !mQuery.trim()) return [];
    const q = fold(mQuery);
    return net.stations.filter((s) => fold(`${s.name} ${s.name_en}`).includes(q));
  }, [net, mQuery]);

  // Browsing with nothing typed: every station, A to Z, or one line in its
  // running order when a line chip is picked.
  const [mLine, setMLine] = useState<string | null>(null);
  const lineRefs = useMemo(
    () => [...new Set((net?.lines ?? []).map((l) => l.ref))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })),
    [net],
  );
  const browse = useMemo(() => {
    if (!net) return [];
    const label = (x: Station) => cleanName(lang === 'en' ? x.name_en || x.name : x.name);
    if (!mLine) return net.stations.slice().sort((a, b) => label(a).localeCompare(label(b), lang === 'fa' ? 'fa' : 'en'));
    const byName = new Map(net.stations.map((x) => [x.name, x]));
    const seen = new Set<number>();
    const out: Station[] = [];
    for (const st of net.lines.find((l) => l.ref === mLine)?.stops ?? []) {
      const x = byName.get(st.name);
      if (x && x.lines.includes(mLine) && !seen.has(x.id)) { seen.add(x.id); out.push(x); }
    }
    for (const x of net.stations) if (x.lines.includes(mLine) && !seen.has(x.id)) out.push(x);
    return out;
  }, [net, mLine, lang]);

  const nearestToMe = () => {
    if (!net) return;
    const n = net.nearest(here ?? center());
    if (!n) return;
    setMFrom(n.station.id);
    setStation(n.station);
  };

  const walkTo = (s: Station) => {
    setStation(null);
    setMode('walk');
    setTo({ at: s.at, label: stationLabel(s), fa: `ایستگاه مترو ${cleanName(s.name)}` });
  };

  const stationLabel = (s: Station) => cleanName(lang === 'en' ? s.name_en || s.name : s.name);
  /** A terminus named in Persian by the arrivals service, in the UI's language. */
  const towardLabel = (fa: string) => {
    const k = fold(cleanName(fa));
    const s = net?.stations.find((x) => fold(cleanName(x.name)) === k);
    return s ? stationLabel(s) : fa;
  };

  // ---------- bottom sheet drag (phones) ----------
  const drag = useRef<{ y: number; snap: Snap } | null>(null);
  const onHandleDown = (e: RPointerEvent) => {
    drag.current = { y: e.clientY, snap };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onHandleUp = (e: RPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dy = e.clientY - d.y;
    const order: Snap[] = ['peek', 'half', 'full'];
    const i = order.indexOf(d.snap);
    if (Math.abs(dy) < 8) setSnap(order[(i + 1) % 3]);
    else setSnap(order[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
  };

  // ---------- chip row: wheel and drag scroll it sideways ----------
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipDrag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const chipScroll = {
    onWheel: (e: React.WheelEvent) => {
      const elx = chipsRef.current;
      if (elx && Math.abs(e.deltaY) > Math.abs(e.deltaX)) elx.scrollLeft += e.deltaY;
    },
    onPointerDown: (e: RPointerEvent) => {
      if (e.pointerType !== 'mouse' || !chipsRef.current) return;
      chipDrag.current = { x: e.clientX, left: chipsRef.current.scrollLeft, moved: false };
    },
    onPointerMove: (e: RPointerEvent) => {
      const d = chipDrag.current;
      if (!d || !chipsRef.current) return;
      const dx = e.clientX - d.x;
      if (Math.abs(dx) > 4) d.moved = true;
      chipsRef.current.scrollLeft = d.left - dx;
    },
    onPointerUp: () => {
      setTimeout(() => (chipDrag.current = null), 0);
    },
    onClickCapture: (e: React.MouseEvent) => {
      if (chipDrag.current?.moved) e.stopPropagation();
    },
  };

  // ---------- render ----------
  const modeIcon = (m: Mode) => (m === 'car' ? <Car aria-hidden /> : m === 'motorcycle' ? <Bike aria-hidden /> : <Footprints aria-hidden />);
  const gpsText = locErr ? t('locationOff') : fix ? `GPS ±${nf(lang, Math.round(fix.accuracy))} ${lang === 'fa' ? 'متر' : 'm'}` : t('locating');
  const noteView = note && (
    <div className={`note ${note.kind}`} role={note.kind === 'warn' ? 'alert' : 'status'}>
      <span>{note.text}</span>
      {note.raw && (
        <details>
          <summary>{t('details')}</summary>
          <code dir="ltr">{note.raw}</code>
        </details>
      )}
    </div>
  );

  // Searching for an endpoint swaps the pick sheet for the result list.
  const pickSearch = !!pickMode && query.trim().length >= 2;
  // What the sheet is showing; a change replays its entrance, so moving from
  // results to a place to a route reads as one sheet changing page.
  const sheetMode = pickMode && !pickSearch ? 'pick' : arrived ? 'arrived' : to && !pickSearch ? 'plan'
    : card ? `card:${card.at[0]},${card.at[1]}` : catsOpen ? 'cats' : hits.length > 0 || listTitle ? 'list'
    : metro && station ? `st:${station.id}` : metro ? 'metro' : 'idle';
  let sheet: ReactNode = null;
  let sheetLabel = t('route');
  if (!nav && pickMode && !pickSearch) {
    sheetLabel = t(pickMode === 'from' ? 'chooseStartLine' : 'chooseEndLine');
    sheet = (
      <div className="sh-pick">
        <div className="pick-head">
          <i className={`dot ${pickMode}`} aria-hidden />
          <div className="pick-copy">
            <p className="pick-title">{sheetLabel}</p>
            <p className="pick-where" aria-live="polite">{pickLabel || '…'}</p>
          </div>
          <button type="button" className="icon-btn" onClick={() => setPickMode(null)} aria-label={t('cancel')}><X aria-hidden /></button>
        </div>
        <div className="btn-pair">
          {pickMode === 'from' && (
            <button type="button" className="btn lg" onClick={useMyLocation}><LocateFixed aria-hidden /> {t('myLocation')}</button>
          )}
          <button type="button" className="btn primary lg" onClick={() => void tapEmpty(center())}>
            <Check aria-hidden /> {t(pickMode === 'from' ? 'pickSetStart' : 'pickSetEnd')}
          </button>
        </div>
        <p className="muted small pick-help">{t('pickHelp')}</p>
      </div>
    );
  } else if (!nav && arrived) {
    sheetLabel = t('arrivedAt');
    sheet = (
      <div className="sh-arrived">
        <CircleCheck aria-hidden className="arrived-icon" />
        <div>
          <h2>{t('arrivedAt')}</h2>
          <p className="muted">{arrived.label}</p>
        </div>
        <div className="btn-pair">
          <button type="button" className="btn primary lg" onClick={clearAll}>{t('finish')}</button>
          <button type="button" className="btn lg" onClick={() => void savePlace(arrived.at, arrived.label)}><Bookmark aria-hidden /> {t('savePlace')}</button>
        </div>
        {noteView}
      </div>
    );
  } else if (!nav && to && !pickSearch) {
    sheet = (
      <div className="sh-plan">
        <div className="sh-head">
          <button type="button" className="icon-btn" onClick={clearAll} aria-label={t('clear')}><ArrowLeft aria-hidden /></button>
          <div className="endpoints">
            <button type="button" className="ep" onClick={() => beginPick('from')} title={t('chooseOnMap')}>
              <i className="dot from" aria-hidden />
              <span>{from ? from.label : t('myLocation')}</span>
              <MapPin aria-hidden className="ep-pick" />
            </button>
            <button type="button" className="ep" onClick={() => beginPick('to')} title={t('chooseOnMap')}>
              <i className="dot to" aria-hidden />
              <span>{to.label}</span>
              <MapPin aria-hidden className="ep-pick" />
            </button>
          </div>
        </div>
        <div className="seg" role="radiogroup" aria-label={t('defaultMode')}>
          {(['car', 'motorcycle', 'walk'] as Mode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {modeIcon(m)}<span>{t(m)}</span>
            </button>
          ))}
        </div>
        {busy ? (
          <ul className="options" aria-busy="true">
            {[0, 1].map((i) => <li key={i}><div className="opt skeleton" /></li>)}
          </ul>
        ) : (
          <ul className="options">
            {routes.map((r, i) => (
              <li key={i}>
                <button type="button" className={i === sel ? 'opt on' : 'opt'} onClick={() => setSel(i)} aria-pressed={i === sel}>
                  <span className="num big">{fmtDuration(lang, r.duration_s)}</span>
                  <span className="num">{fmtDistance(lang, r.distance_m)}</span>
                  <span className="src">
                    <i className={r.provider === 'offline' ? 'lamp device' : 'lamp live'} aria-hidden />
                    {providerLabel(r)}{sep(lang)}{r.provider === 'offline' ? t('noTraffic') : t('liveTraffic')}
                  </span>
                  {i === sel && delay ? <span className="src">{t('trafficDelay')} <span className="num">{fmtDuration(lang, delay)}</span></span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
        {noteView}
        {!origin && (
          <div className="wait-loc">
            {locErr ? (
              <button type="button" className="btn" onClick={() => setLocAsk(true)}><LocateFixed aria-hidden /> {t('locAskTitle')}</button>
            ) : (
              <p className="muted"><LocateFixed aria-hidden className="inline" /> {t('locatingHint')}</p>
            )}
            <p className="muted small">{t('orChooseStart')}</p>
          </div>
        )}
        {origin && (
          <div className="sh-actions">
            <button type="button" className="btn primary lg go" disabled={!route} onClick={startNav}><Navigation aria-hidden /> {t('start')}</button>
            {to.fa && (
              <button type="button" className="btn lg driver-btn" onClick={() => showDriverFor({ fa: to.fa, faLine: '', en: to.label, at: to.at })}>
                <Users aria-hidden /> {t('showDriver')}
              </button>
            )}
          </div>
        )}
      </div>
    );
  } else if (!nav && card) {
    sheetLabel = card.name;
    const h = card.hit;
    const coordText = `${card.at[1].toFixed(5)}, ${card.at[0].toFixed(5)}`;
    const phone = h?.phone ? h.phone.split(/[;,]/)[0].replace(/\s/g, '') : '';
    sheet = (
      <div className="sh-card">
        <div className="sh-head">
          <div className="card-title">
            <h2>{card.name || t('droppedPin')}</h2>
            {card.nameAlt && <p className="alt"><bdi lang={lang === 'en' ? 'fa' : 'en'}>{card.nameAlt}</bdi></p>}
            <p className="muted">
              {card.kind ? kindLabel(lang, card.kind) : t('droppedPin')}
              {here && <>{sep(lang)}<span className="num">{fmtDistance(lang, distM(here, card.at))}</span></>}
            </p>
          </div>
          {/* From a result list the card goes back to it; otherwise it closes. */}
          <button type="button" className="icon-btn" onClick={() => setCard(null)} aria-label={t('cancel')}>
            {hits.length > 0 ? (lang === 'fa' ? <ArrowLeft aria-hidden style={{ transform: 'scaleX(-1)' }} /> : <ArrowLeft aria-hidden />) : <X aria-hidden />}
          </button>
        </div>
        <div className="acts">
          <button type="button" className="act primary" onClick={() => directionsTo(card)}>
            <span className="act-ic"><Navigation aria-hidden /></span><span className="act-l">{t('directions')}</span>
          </button>
          <button type="button" className="act" onClick={() => startFromCard(card)}>
            <span className="act-ic"><Flag aria-hidden /></span><span className="act-l">{t('setFrom')}</span>
          </button>
          {(card.fa || card.en) && (
            <button type="button" className="act" onClick={() => showDriverFor(card)}>
              <span className="act-ic"><Users aria-hidden /></span><span className="act-l">{t('showDriver')}</span>
            </button>
          )}
          <button type="button" className={placeName !== null ? 'act on' : 'act'} onClick={() => setPlaceName(placeName === null ? card.name || '' : null)}>
            <span className="act-ic"><Bookmark aria-hidden /></span><span className="act-l">{t('savePlace')}</span>
          </button>
          <button type="button" className={moreOpen ? 'act on' : 'act'} onClick={() => setMoreOpen((v) => !v)} aria-expanded={moreOpen}>
            <span className="act-ic"><Ellipsis aria-hidden /></span><span className="act-l">{t('more')}</span>
          </button>
        </div>
        {moreOpen && (
          <div className="card-more">
            {phone && <a className="btn" href={`tel:${phone}`}><Phone aria-hidden /> {t('call')}</a>}
            <button type="button" className="btn" onClick={() => void sharePlace(card)}><Share2 aria-hidden /> {t('shareLocation')}</button>
            <button type="button" className="btn" onClick={() => copyCard(card)}><Copy aria-hidden /> {t('share')}</button>
            {settings.has_mapillary_token && (
              <button type="button" className="btn" onClick={() => setSv({ at: card.at, title: card.name || fmtLL(card.at) })}><Camera aria-hidden /> {t('streetView')}</button>
            )}
          </div>
        )}
        {placeName !== null && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); void savePlace(card.at, placeName); }}>
            <input autoFocus value={placeName} placeholder={t('placeName')} onChange={(e) => setPlaceName(e.target.value)} maxLength={120} />
            <button type="submit" className="btn primary" disabled={!placeName.trim()}>{t('save')}</button>
          </form>
        )}
        <ul className="facts">
          {h?.address && <li><MapPin aria-hidden /><span dir="auto">{h.address}</span></li>}
          {h?.hours && <li><Clock aria-hidden /><span className="num" dir="ltr">{h.hours}</span></li>}
          {h?.phone && <li><Phone aria-hidden /><a className="num" dir="ltr" href={`tel:${phone}`}>{h.phone}</a></li>}
          {h?.website && <li><Globe aria-hidden /><a href={h.website} target="_blank" rel="noreferrer" dir="ltr">{h.website.replace(/^https?:\/\//, '')}</a></li>}
          <li><LocateFixed aria-hidden /><span className="num" dir="ltr">{coordText}</span></li>
        </ul>
        {noteView}
      </div>
    );
  } else if (!nav && catsOpen) {
    sheetLabel = t('allCategories');
    sheet = (
      <div className="sh-cats">
        <p className="sh-title">{t('allCategories')}</p>
        <div className="cat-grid">
          {[...PRIMARY, ...SECONDARY].map((c) => (
            <button key={c.id} type="button" className={cat === c.id ? 'cat-tile on' : 'cat-tile'} onClick={() => void runCategory(c)}>
              <c.Icon aria-hidden /><span>{t(c.id)}</span>
            </button>
          ))}
        </div>
      </div>
    );
  } else if (!nav && (hits.length > 0 || listTitle)) {
    sheetLabel = pickMode ? t(pickMode === 'from' ? 'searchStart' : 'searchEnd') : listTitle ?? t('searchPlaceholder');
    sheet = (
      <div className="sh-list">
        <p className="sh-title">{sheetLabel}</p>
        {searching ? (
          <ul className="hits" aria-busy="true">
            {[0, 1, 2, 3].map((i) => <li key={i}><div className="hit-skeleton" /></li>)}
          </ul>
        ) : hits.length === 0 ? (
          <div className="empty">
            <p><strong>{cat ? t('nearbyNone') : t('noResults')}</strong></p>
            <p className="muted">{t('noResultsHint')}</p>
          </div>
        ) : (
          <ul className="hits">
            {hits.map((h, i) => (
              <li key={i}>
                <button type="button" onClick={() => chooseHit(h)}>
                  <span className="hit-name">{nameOf(h)}</span>
                  {altOf(h) && <span className="hit-fa" lang={lang === 'en' ? 'fa' : 'en'} dir="auto">{altOf(h)}</span>}
                  <span className="hit-meta">
                    {kindLabel(lang, h.kind)}{sep(lang)}<span className="num">{fmtDistance(lang, h.distance_m)}</span>
                    {h.hours && <Clock aria-hidden className="inline" />}
                    {h.phone && <Phone aria-hidden className="inline" />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {noteView}
      </div>
    );
  } else if (!nav && metro && station && net) {
    sheetLabel = stationLabel(station);
    const dist = here ? distM(here, station.at) : null;
    const isFav = favs.includes(station.name);
    sheet = (
      <div className="sh-card">
        <div className="sh-head">
          <div className="card-title">
            <h2>{stationLabel(station)}</h2>
            {lang === 'en' && station.name && <p className="alt"><bdi lang="fa">{cleanName(station.name)}</bdi></p>}
            <p className="line-badges">
              {station.lines.map((l) => <span key={l} className="lbadge" style={{ '--lc': net.colourOf(l) } as React.CSSProperties}>{t('metroLine')} {nf(lang, Number(l) || 0) || l}</span>)}
              {dist !== null && <span className="muted num">{fmtDistance(lang, dist)}</span>}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={() => setStation(null)} aria-label={t('cancel')}><X aria-hidden /></button>
        </div>
        {station.id === mFrom && mTo === null && (
          <p className="trip-hint"><i className="dot from" aria-hidden /> {t('metroTapDest')}</p>
        )}
        <div className="btn-pair">
          <button type="button" className={isFav ? 'btn fav on' : 'btn fav'} aria-pressed={isFav} onClick={() => setFavs((f) => toggleFav(f, station.name))}>
            <Star aria-hidden /> {t(isFav ? 'favSaved' : 'favAdd')}
          </button>
          <button type="button" className="btn" onClick={() => walkTo(station)}><WalkIcon aria-hidden /> {t('metroWalk')}</button>
        </div>
        <MetroArrivals arrivals={arrivals} label={(fa) => towardLabel(fa)} />
      </div>
    );
  } else if (!nav && metro) {
    sheetLabel = t('metroTitle');
    const leg0 = journey?.legs[0];
    const nextRow = leg0 && Array.isArray(arrivals.rows) ? arrivals.rows.find((r) => sameStation(r.toward, leg0.toward.name)) : undefined;
    const nextTrain = nextRow ? minutesLeft(nextRow.minutes, arrivals.at) : null;
    const pickRow = (which: 'from' | 'to') => {
      const id = which === 'from' ? mFrom : mTo;
      const s = id !== null && net ? net.stations[id] : null;
      return (
        <button type="button" className={mPick === which ? 'ep on' : 'ep'} onClick={() => { setMPick(which); setMQuery(''); setSnap('full'); }}>
          <i className={`dot ${which}`} aria-hidden />
          <span>{s ? stationLabel(s) : t(which === 'from' ? 'metroFrom' : 'metroTo')}</span>
          {s && <span className="mini-lines">{s.lines.map((l) => <i key={l} style={{ background: net!.colourOf(l) }} />)}</span>}
        </button>
      );
    };
    sheet = (
      <div className="sh-metro">
        <div className="metro-head">
          <p className="sh-title"><TrainFront aria-hidden className="inline" /> {t('metroTitle')}</p>
          <button type="button" className="btn sm" onClick={nearestToMe}><LocateFixed aria-hidden /> {t('metroNearestTo')}</button>
        </div>
        {!net ? (
          <div className="hit-skeleton" />
        ) : net.stations.length === 0 ? (
          <p className="muted">{t('metroNoData')}</p>
        ) : (
          <>
            <div className="metro-ends">
              <div className="endpoints">{pickRow('from')}{pickRow('to')}</div>
              <button type="button" className="icon-btn" onClick={() => { setMFrom(mTo); setMTo(mFrom); }} aria-label={t('metroSwap')}><ArrowLeftRight aria-hidden /></button>
            </div>
            {mPick && (
              <div className="metro-search">
                <div className="searchbox">
                  <Search aria-hidden />
                  <input autoFocus value={mQuery} onChange={(e) => setMQuery(e.target.value)} placeholder={t('metroPick')} />
                </div>
                {!mQuery.trim() && (
                  <div className="line-filter" role="radiogroup" aria-label={t('metroLine')}>
                    <button type="button" role="radio" aria-checked={mLine === null} className={mLine === null ? 'lchip on' : 'lchip'} onClick={() => setMLine(null)}>{t('allLines')}</button>
                    {lineRefs.map((ref) => (
                      <button key={ref} type="button" role="radio" aria-checked={mLine === ref} className={mLine === ref ? 'lchip on' : 'lchip'} style={{ '--lc': net.colourOf(ref) } as React.CSSProperties} onClick={() => setMLine(ref)}>
                        <i aria-hidden />{`${t('metroLine')} ${lang === 'fa' && /^\d+$/.test(ref) ? nf(lang, Number(ref)) : ref}`}
                      </button>
                    ))}
                  </div>
                )}
                {mQuery.trim() && stationHits.length === 0 && <p className="muted small">{t('noResults')}</p>}
                <ul className="hits">
                  {(mQuery.trim() ? stationHits : browse).map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => { if (mPick === 'from') setMFrom(s.id); else setMTo(s.id); setMPick(null); setSnap('half'); }}>
                        <span className="hit-name">{stationLabel(s)}</span>
                        {lang === 'en' && s.name && <span className="hit-fa" lang="fa">{cleanName(s.name)}</span>}
                        <span className="mini-lines">{s.lines.map((l) => <i key={l} style={{ background: net.colourOf(l) }} />)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!mPick && journey && (
              <div className="journey">
                <p className="journey-sum"><span className="num big">{fmtDuration(lang, journey.minutes * 60)}</span><span className="muted">{nf(lang, journey.stops)} {t('metroStops')}{sep(lang)}{journey.legs.length > 1 ? `${nf(lang, journey.legs.length - 1)} ${t(journey.legs.length === 2 ? 'metroChanges1' : 'metroChangesN')}` : t('metroDirect')}</span></p>
                <ol className="legs">
                  {journey.legs.map((l, i) => (
                    <li key={i} style={{ '--lc': l.colour } as React.CSSProperties}>
                      <span className="lbadge" style={{ '--lc': l.colour } as React.CSSProperties}>{t('metroLine')} {l.line}</span>
                      <div>
                        <strong>{i === 0 ? t('metroRide') : `${t('metroChange')} ${stationLabel(l.from)}`}</strong>
                        <span className="muted">{stationLabel(l.from)} → {stationLabel(l.to)}</span>
                        <span className="muted small">{t('metroToward')} {stationLabel(l.toward)}{sep(lang)}{nf(lang, l.stops)} {t('metroStops')}</span>
                        {i === 0 && nextTrain !== null && (
                          <span className="next-train"><Radio aria-hidden className="inline" /> {t('etaNext')}{sep(lang)}<span className="num">{nextTrain === 0 ? t('etaArriving') : `${nf(lang, nextTrain)} ${t('etaMin')}`}</span></span>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {!mPick && mFrom !== null && mTo !== null && !journey && <p className="muted">{t('metroNoRoute')}</p>}
            {!mPick && !journey && (
              <>
                <p className="trip-hint"><i className={`dot ${mFrom === null ? 'from' : 'to'}`} aria-hidden /> {t(mFrom === null ? 'metroTapStart' : 'metroTapDest')}</p>
                {favs.length > 0 && (
                  <section className="metro-saved">
                    <p className="label">{t('metroFavs')}</p>
                    <div className="fav-chips">
                      {favs.map((n) => byName(n)).filter((x): x is Station => !!x).map((x) => (
                        <button key={x.id} type="button" className="fav-chip" onClick={() => stationTapRef.current(String(x.id))}>
                          <Star aria-hidden className="inline" /> {stationLabel(x)}
                          <span className="mini-lines">{x.lines.map((l) => <i key={l} style={{ background: net.colourOf(l) }} />)}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {trips.length > 0 && (
                  <section className="metro-saved">
                    <p className="label">{t('metroRecent')}</p>
                    <ul className="hits recent-list">
                      {trips.map((tr) => ({ a: byName(tr.from), b: byName(tr.to) })).filter((x): x is { a: Station; b: Station } => !!x.a && !!x.b).map(({ a, b }) => (
                        <li key={`${a.id}-${b.id}`}>
                          <button type="button" onClick={() => { setStation(null); setMFrom(a.id); setMTo(b.id); }}>
                            <History aria-hidden className="inline" />
                            <span className="hit-name">{stationLabel(a)} → {stationLabel(b)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
            <p className="muted small">{t('metroBrtNote')}</p>
          </>
        )}
      </div>
    );
  } else if (!nav) {
    sheetLabel = t('navMap');
    sheet = (
      <div className="sh-idle">
        <p className="status">
          <span><i className={online ? 'lamp live' : 'lamp device'} aria-hidden />{online ? t('online') : t('offline')}</span>
          {locErr && !fix ? (
            <button type="button" className="loc-off" onClick={() => setLocAsk(true)}><span className="warn">{gpsText}</span>{t('locFix')}</button>
          ) : (
            <span>{gpsText}</span>
          )}
          {noPack && <span className="warn">{t('noPacks')}</span>}
        </p>
        {fix && (
          <button type="button" className="btn share-mine" onClick={() => void shareMine()}>
            <Share2 aria-hidden /> {t('shareMine')}
          </button>
        )}
        <div className="recent">
          <div className="recent-head">
            <p className="sh-title"><History aria-hidden className="inline" /> {t('recentSearches')}</p>
            {recent.length > 0 && <button type="button" className="btn ghost sm" onClick={clearRecent}>{t('clear')}</button>}
          </div>
          {recent.length === 0 ? (
            <p className="muted small">{t('recentEmpty')}</p>
          ) : (
            <ul className="hits recent-list">
              {recent.slice(0, 5).map((r) => {
                const at: LngLat = [r.lon, r.lat];
                return (
                  <li key={`${r.name}-${r.t}`}>
                    <button type="button" onClick={() => { void tapPlace(r.name, r.name_en, r.kind, at); mapRef.current?.flyTo({ center: at, zoom: Math.max(mapRef.current.getZoom(), 15.5), duration: ms(600) }); }}>
                      <span className="hit-name">{nameOf(r)}</span>
                      <span className="hit-meta">
                        {kindLabel(lang, r.kind)}
                        {here && <>{sep(lang)}<span className="num">{fmtDistance(lang, distM(here, at))}</span></>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {noteView}
      </div>
    );
  }

  const nextName = prog?.next ? (lang === 'en' ? prog.next.name_en || '' : prog.next.name) : '';
  const nextFa = prog?.next && lang === 'en' && prog.next.name && prog.next.name !== prog.next.name_en ? prog.next.name : '';
  const announce = prog?.next && nav ? instruction(lang, prog.next, nav.route.provider) : '';

  return (
    <div className={`gmap ${nav ? 'is-nav' : ''} ${metro ? 'is-metro' : ''}`} hidden={!active}>
      <div ref={el} className="map" />
      {scanImg && (
        <div ref={scanWrap} className={scanFade ? 'radar-wrap fade-only' : 'radar-wrap'} aria-hidden>
          <div ref={scanOld} className="scan-old" style={{ backgroundImage: `url(${scanImg})` }} />
          <div className="radar-rings" />
          <div ref={radarBeam} className="radar-beam" />
          <div ref={radarWave} className="radar-wave" />
          <div className="radar-flash" />
        </div>
      )}

      {nav && prog ? (
        <div className="nav-top">
          {prog.next && <TurnIcon step={prog.next} />}
          <div className="nav-copy">
            <div className="num nav-dist">{fmtDistance(lang, prog.toNext)}</div>
            <div className="nav-text">{announce}</div>
            {(nextName || nextFa) && (
              <div className="nav-street">
                {nextName && <span>{nextName}</span>}
                {nextFa && <span lang="fa" dir="rtl">{nextFa}</span>}
              </div>
            )}
          </div>
        </div>
      ) : metro ? null : (
        <div className="topbar">
          <div className="searchpill">
            <Search aria-hidden />
            <input id="map-search" type="search" value={query} placeholder={t(pickMode === 'from' ? 'searchStart' : pickMode === 'to' ? 'searchEnd' : 'searchPlaceholder')} onChange={(e) => setQuery(e.target.value)} onFocus={() => { if (!query && !to && !card && !pickMode && !catsOpen) setSnap('half'); }} autoComplete="off" aria-label={t('searchPlaceholder')} />
            {(query || to || hits.length > 0 || card) && (
              <button type="button" className="icon-btn" onClick={clearAll} aria-label={t('clear')}><X aria-hidden /></button>
            )}
          </div>
          {!to && !pickMode && !metro && (
            <div className="chips-row" role="toolbar" aria-label={t('allCategories')} ref={chipsRef} {...chipScroll}>
              {PRIMARY.map((c) => (
                <button key={c.id} type="button" className={`cat${cat === c.id ? ' on' : ''}${c.id === 'catHotels' ? ' wide-only' : ''}`} onClick={() => void runCategory(c)} aria-pressed={cat === c.id}>
                  <c.Icon aria-hidden />{t(c.id)}
                </button>
              ))}
              <button type="button" className={catsOpen || SECONDARY.some((c) => c.id === cat) ? 'cat on' : 'cat'} onClick={() => { setCatsOpen((v) => !v); setCard(null); setSnap('half'); }} aria-expanded={catsOpen}>
                <LayoutGrid aria-hidden />{t('more')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Screen readers hear the manoeuvre once when it changes, not every GPS tick. */}
      <div className="sr-only" aria-live="polite">{announce}</div>

      <div className="fabs-top">
        {(Math.abs(bearing) > 0.5 || pitch > 1) && (
          <button type="button" className="fab" onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: ms(500) })} aria-label={t('compass')} title={t('compass')}>
            <Compass aria-hidden style={{ transform: `rotate(${-bearing - 45}deg)` }} />
          </button>
        )}
        <button type="button" className={layersOpen ? 'fab on' : 'fab'} onClick={() => setLayersOpen((v) => !v)} aria-label={t('layers')} aria-expanded={layersOpen}>
          <Layers aria-hidden />
        </button>
        {layersOpen && (
          <div className="layers-pop" role="group" aria-label={t('layers')}>
            <div className="layer-types">
              <button type="button" className={!satellite ? 'ltype on' : 'ltype'} onClick={() => void switchBase(false)} aria-pressed={!satellite}>
                <span className="lt-thumb map" aria-hidden /> {t('mapDefault')}
              </button>
              <button type="button" className={satellite ? 'ltype on' : 'ltype'} disabled={!online} onClick={() => void switchBase(true)} aria-pressed={satellite}>
                <span className="lt-thumb sat" aria-hidden /><span><Satellite aria-hidden className="inline" /> {t('satellite')}</span>
              </button>
            </div>
            {!online && <p className="muted small">{t('satelliteOffline')}</p>}
            {settings.has_neshan_web_key && (
              <label className="check"><input type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} /><TrafficCone aria-hidden className="inline" /> {t('trafficLayer')}</label>
            )}
            <label className="check"><input type="checkbox" checked={b3d} onChange={(e) => toggle3d(e.target.checked)} /><Box aria-hidden className="inline" /> {t('buildings3d')}</label>
          </div>
        )}
      </div>


      {pickMode && !pickSearch && !nav && <div className="pick-pin" aria-hidden><MapPin /></div>}

      <div className={`fabs-bottom snap-${nav ? 'nav' : !sheet ? 'none' : pickMode && !pickSearch ? 'pick' : snap}`}>
        <button type="button" className={`fab${follow && fix ? ' on' : ''}${locErr && !fix ? ' off' : ''}`} onClick={locateMe} aria-label={nav ? t('recenter') : t('myLocation')} title={t('myLocation')}>
          <LocateFixed aria-hidden />
        </button>
      </div>

      {nav && prog && (
        <div className="nav-bottom">
          {offer && (
            <div className="offer" role="alert">
              <span><strong>{t('fasterFound')}</strong>{sep(lang)}{t('saves')} <span className="num">{fmtDuration(lang, offer.saves)}</span></span>
              <span className="row">
                <button type="button" className="btn primary" onClick={() => { setRoutes([offer.route]); setSel(0); setNav(prepare(offer.route)); setOffer(null); }}>{t('switchRoute')}</button>
                <button type="button" className="btn" onClick={() => setOffer(null)}>{t('keep')}</button>
              </span>
            </div>
          )}
          {preview && (
            <div className="preview-bar">
              <span className="preview-tag"><i className="lamp device" aria-hidden />{t(from ? 'previewFromStart' : 'previewNoGps')}</span>
              <button type="button" className={simPlay ? 'btn sm' : 'btn primary sm'} onClick={() => { if (prog && prog.remainingM < 30) setSimAlong(0); setSimPlay((v) => !v); setFollow(true); }}>
                {simPlay ? <Pause aria-hidden /> : <Play aria-hidden />} {t(simPlay ? 'previewPause' : 'previewPlay')}
              </button>
            </div>
          )}
          <button type="button" className="icon-btn stop" onClick={stopNav} aria-label={t('stop')}><X aria-hidden /></button>
          <div className="eta">
            <span className="num eta-time">{fmtDuration(lang, prog.remainingS)}</span>
            <span className="muted"><span className="num">{fmtDistance(lang, prog.remainingM)}</span>{sep(lang)}{t('arrive')} <span className="num">{fmtClock(lang, prog.remainingS)}</span></span>
          </div>
          {!follow && <button type="button" className="btn" onClick={() => setFollow(true)}><Navigation aria-hidden /> {t('recenter')}</button>}
        </div>
      )}

      {!nav && sheet && (
        <section className={`sheet snap-${pickMode && !pickSearch ? 'pick' : snap}`} aria-label={sheetLabel}>
          {!pickMode && (
            <button type="button" className="grab" onPointerDown={onHandleDown} onPointerUp={onHandleUp} aria-label={sheetLabel}>
              <i aria-hidden />
            </button>
          )}
          <div className="sheet-body" key={sheetMode}>{sheet}</div>
        </section>
      )}

      {driver && <DriverView target={driver} onClose={() => setDriver(null)} />}
      {sv && <StreetView at={sv.at} title={sv.title} onClose={() => setSv(null)} />}
      {locAsk && (
        <div className="qa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setLocAsk(false); }}>
          <section className="qa loc-ask" role="dialog" aria-modal="true" aria-labelledby="loc-ask-title">
            <span className="loc-ask-ic" aria-hidden><LocateFixed /></span>
            <h2 id="loc-ask-title">{t('locAskTitle')}</h2>
            <p>{t('locAskWhy')}</p>
            <p className="muted">{t(!isMobile ? 'locAskPc' : locProblem === 'off' ? 'locOffPhone' : locProblem === 'denied' ? 'locDeniedPhone' : 'locAskPhone')}</p>
            <footer className="qa-foot">
              <button type="button" className="btn" onClick={() => setLocAsk(false)}>{t('notNow')}</button>
              <button type="button" className="btn primary" onClick={() => void allowLocation()}>
                <LocateFixed aria-hidden /> {t(!isMobile ? 'locOpenSettings' : locProblem === 'off' ? 'locOpenPhoneSettings' : 'locAllow')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

/** A finger covers about 40 px, a station dot or an icon 6 to 20: querying
 * the exact tapped pixel misses most taps on a phone. Search a square around
 * the tap (larger for touch) and take the feature nearest its centre. */
const TAP_SLOP = isMobile ? 22 : 10;
function nearestFeature(map: MlMap, p: { x: number; y: number }, layerIds: string[], ok: (f: MapGeoJSONFeature) => boolean): MapGeoJSONFeature | undefined {
  const layers = layerIds.filter((id) => map.getLayer(id));
  if (!layers.length) return undefined;
  const box: [[number, number], [number, number]] = [[p.x - TAP_SLOP, p.y - TAP_SLOP], [p.x + TAP_SLOP, p.y + TAP_SLOP]];
  let best: MapGeoJSONFeature | undefined;
  let bestD = Infinity;
  for (const f of map.queryRenderedFeatures(box, { layers })) {
    if (!ok(f)) continue;
    let d = 0;
    if (f.geometry.type === 'Point') {
      const q = map.project(f.geometry.coordinates as LngLat);
      d = Math.hypot(q.x - p.x, q.y - p.y);
    } else d = TAP_SLOP; // areas and labels: fine to pick, but a point beats them
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/** Preview drive speed in metres per second: a brisk run-through, not real time. */
function simSpeed(mode: Mode): number {
  return mode === 'walk' ? 7 : mode === 'motorcycle' ? 30 : 34;
}

/** Heading for the camera and arrow: the compass while really moving, else the road ahead. */
function navHeading(p: Prepared, pr: Progress, f: Fix): number {
  return f.heading !== null && (f.speed ?? 0) > 1.5 ? f.heading : routeBearing(p, pr.along);
}

/** Direction of travel along the route just ahead of `along` metres. */
function routeBearing(p: Prepared, along: number): number {
  const c = p.route.coords;
  let i = p.cum.findIndex((m) => m > along + 15);
  if (i <= 0) i = Math.min(1, c.length - 1);
  const a = c[Math.max(0, i - 1)];
  const b = c[i];
  const y = Math.sin(((b[0] - a[0]) * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180);
  const x =
    Math.cos((a[1] * Math.PI) / 180) * Math.sin((b[1] * Math.PI) / 180) -
    Math.sin((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.cos(((b[0] - a[0]) * Math.PI) / 180);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** OSM station names often carry "metro station" / "ایستگاه مترو"; the UI says it already. */
function cleanName(n: string): string {
  return n.replace(/\s*metro station$/i, '').replace(/^ایستگاه\s+(مترو\s+)?/, '').trim();
}


function fmtLL(p: LngLat): string {
  return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}

function bbox(c: LngLat[]): [[number, number], [number, number]] {
  let [w, s, e, n] = [c[0][0], c[0][1], c[0][0], c[0][1]];
  for (const [x, y] of c) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [[w, s], [e, n]];
}
