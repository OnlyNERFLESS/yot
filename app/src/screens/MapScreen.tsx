import React, { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Map as MlMap, MapGeoJSONFeature } from 'maplibre-gl';
import {
  ArrowLeftRight, Footprints as WalkIcon,
  ArrowLeft, Banknote, BedDouble, Bike, Bookmark, Box, Car, Check, CircleCheck, Clock, History, Coffee, Compass, Ellipsis, Flag,
  Footprints, Fuel, Globe, Hospital, Landmark, Layers, LayoutGrid, LocateFixed, MapPin, Navigation, Phone, Pill, Satellite,
  Search, Share2, ShoppingCart, SquareParking, TrafficCone, TrainFront, Utensils, Users, X, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../app/ctx';
import { api, type Hit, type LngLat, type Mode, type Route } from '../lib/api';
import { fmtClock, fmtDistance, fmtDuration, humanError, instruction, kindLabel, nf, sep, type Key } from '../lib/i18n';
import { isMobile, watch, type Fix } from '../lib/location';
import { distM, isOffRoute, prepare, progress, type Prepared, type Progress } from '../lib/nav';
import { findRoutes } from '../lib/routing';
import { googleTiles, inIran } from '../lib/online';
import {
  add3dBuildings, addMetro, addOverlays, addTraffic, baseStyle, createMap, fc, forgetBasemapState, line, point, registerPack,
  set3dVisible, setBasemapHidden, setData, setGoogleBase, setMetroVisible, setTrafficVisible, type BasePacks,
} from '../map/setup';
import { TurnIcon } from '../ui/TurnIcon';
import { addRecent, clearRecent, onRecentChange, recentList, type Recent } from '../lib/recent';
import { DriverView, type DriverTarget } from '../ui/DriverView';
import { startRouteScan } from '../map/routeScan';
import { buildNetwork, type Journey, type Network, type Station } from '../lib/metro';
import { fold } from '../lib/fold';

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
  const packUrl = useRef<BasePacks>({ city: null, country: null });
  const [ready, setReady] = useState(false);
  const [noPack, setNoPack] = useState(false);

  const [fix, setFix] = useState<Fix | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
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
  const [from, setFrom] = useState<Place | null>(null); // null = my location
  const [to, setTo] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>(settings.default_mode);

  const [routes, setRoutes] = useState<Route[]>([]);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [arrived, setArrived] = useState<Place | null>(null);

  const [nav, setNav] = useState<Prepared | null>(null);
  const [prog, setProg] = useState<Progress | null>(null);
  const offCount = useRef(0);
  const lastReroute = useRef(0);
  const [offer, setOffer] = useState<{ route: Route; saves: number } | null>(null);

  const [layersOpen, setLayersOpen] = useState(false);
  const [traffic, setTraffic] = useState(true);
  const [satellite, setSatellite] = useState(false);
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
  const metroRef = useRef(false);
  const stationTapRef = useRef<(name: string) => void>(() => {});

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
        setReady(false);
        setReady(true);
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
          const st = map.queryRenderedFeatures(e.point, { layers: ['tb-metro-st', 'tb-metro-label'].filter((id) => map.getLayer(id)) })[0];
          if (st?.properties?.key) {
            stationTapRef.current(String(st.properties.key));
            return;
          }
        }
        const layers = ['pois', 'places_subplace', 'places_locality'].filter((id) => map.getLayer(id));
        const f: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(e.point, { layers }).find((x) => x.properties?.name);
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
    void watch(
      (f) => {
        setFix(f);
        setLocErr(null);
      },
      (m) => setLocErr(m),
    ).then((s) => (alive ? (stop = s) : s()));
    return () => {
      alive = false;
      stop();
    };
  }, [locTry]);

  // Location refused or switched off: say so once, as a prompt with a way to
  // fix it, instead of a grey status line nobody reads.
  useEffect(() => {
    if (active && !metro && locErr && !fix && !askedLoc.current) {
      askedLoc.current = true;
      setLocAsk(true);
    }
  }, [active, metro, locErr, fix]);
  useEffect(() => {
    if (fix) setLocAsk(false);
  }, [fix]);
  // Windows: coming back from Location settings retries on its own. Not on
  // phones, where retrying re-opens the permission dialog in a loop.
  useEffect(() => {
    if (!locErr || isMobile) return;
    const again = () => {
      if (document.visibilityState === 'visible') setLocTry((n) => n + 1);
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
      ...(card && !to && !pickMode ? [point(card.at, { role: 'to' })] : []),
    ];
    setData(map, 'tb-pins', fc(pins));
  }, [hits, from, to, card, nav, ready, pickMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fix) return;
    const draw = () => {
      const mpp = (156543.03392 * Math.cos((fix.lat * Math.PI) / 180)) / 2 ** map.getZoom();
      const at: LngLat = nav && prog && prog.offBy < 30 ? prog.snapped : [fix.lng, fix.lat];
      setData(map, 'tb-pos', fc([point(at, { kind: 'acc', px: Math.min(200, fix.accuracy / mpp) }), point(at, { kind: 'dot' })]));
    };
    draw();
    map.on('zoom', draw);
    if (follow) {
      const at: LngLat = nav && prog && prog.offBy < 30 ? prog.snapped : [fix.lng, fix.lat];
      if (nav && prog) {
        const heading = fix.heading !== null && (fix.speed ?? 0) > 1.5 ? fix.heading : routeBearing(nav, prog.along);
        map.easeTo({ center: at, bearing: heading, pitch: 55, zoom: Math.max(map.getZoom(), 16.5), duration: ms(800), offset: [0, map.getContainer().clientHeight * 0.22] });
      } else {
        map.easeTo({ center: at, duration: ms(600), zoom: Math.max(map.getZoom(), 14) });
      }
    }
    return () => {
      map.off('zoom', draw);
    };
  }, [fix, ready, follow, nav, prog]);

  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) setTrafficVisible(map, traffic && online && !satellite);
  }, [traffic, online, satellite, ready]);

  // Buildings off while driving: towers otherwise stand between the camera and the car.
  useEffect(() => {
    const map = mapRef.current;
    if (map && ready) set3dVisible(map, b3d && !satellite && nav === null);
  }, [b3d, satellite, ready, nav]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const want: 'roadmap' | 'satellite' | null = satellite ? 'satellite' : route?.provider === 'google' ? 'roadmap' : null;
    if (!want) {
      setGoogleBase(map, null);
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
  }, [satellite, route, googleUrl, ready, lang]);

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
    const s = net?.stations[Number(key)];
    if (s) {
      setStation(s);
      setSnap('half');
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
    if (locErr) setLocAsk(true);
    else setNote({ text: t('locatingHint'), kind: 'info' });
  };
  const allowLocation = () => {
    setLocAsk(false);
    if (isMobile) {
      setLocErr(null);
      setLocTry((n) => n + 1);
    } else void api.openLocationSettings().catch(warn);
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
    setNav(prepare(route));
    setFollow(true);
    setHits([]);
    offCount.current = 0;
    void (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock
      ?.request('screen')
      .catch(() => undefined);
  };
  const stopNav = () => {
    setNav(null);
    setProg(null);
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

  useEffect(() => {
    if (!nav || !fix || !to) return;
    const p = progress(nav, [fix.lng, fix.lat]);
    setProg(p);
    if (p.remainingM < 30 || distM([fix.lng, fix.lat], to.at) < 25) {
      stopNav();
      setRoutes([]);
      setArrived(to);
      setTo(null);
      setSnap('half');
      return;
    }
    offCount.current = isOffRoute(p, fix.accuracy) ? offCount.current + 1 : 0;
    if (offCount.current >= 3 && Date.now() - lastReroute.current > 15_000) {
      lastReroute.current = Date.now();
      offCount.current = 0;
      setNote({ text: t('offRoute'), kind: 'info' });
      void plan([fix.lng, fix.lat], to.at).then((rs) => rs[0] && setNav(prepare(rs[0])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, nav, to, plan, t]);

  useEffect(() => {
    if (!nav || !to || nav.route.provider === 'offline') return;
    const id = window.setInterval(async () => {
      if (!navigator.onLine || !fix || offer) return;
      const r = await findRoutes(settings, mode, [fix.lng, fix.lat], to.at).catch(() => null);
      const best = r?.routes[0];
      const cur = prog?.remainingS ?? Infinity;
      if (best && best.provider !== 'offline' && cur - best.duration_s >= SAVE_GAIN_S) setOffer({ route: best, saves: cur - best.duration_s });
    }, RECHECK_MS);
    return () => window.clearInterval(id);
  }, [nav, to, fix, prog, offer, settings, mode]);

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

  const copyCard = (c: Card) => {
    // What a driver or colleague can use: the Persian name and address first, then coordinates.
    const text = [c.fa, c.faLine, c.en !== c.fa ? c.en : '', `${c.at[1].toFixed(6)}, ${c.at[0].toFixed(6)}`].filter(Boolean).join('\n');
    void navigator.clipboard.writeText(text).then(() => setNote({ text: t('copied'), kind: 'ok' }));
  };

  const providerLabel = (r: Route) =>
    r.provider === 'neshan' ? t('providerNeshan') : r.provider === 'google' ? t('providerGoogle') : t('providerOffline');
  const delay = useMemo(() => (route?.duration_free_s ? route.duration_s - route.duration_free_s : null), [route]);
  const googleOk = settings.has_google_key && online && !inIran(here ?? center());

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
    const map = mapRef.current;
    if (!map || !ready) return;
    setMetroVisible(map, metro);
    setBasemapHidden(map, metro);
    if (!metro || !net) return;
    const onJourney = new Set(journey?.legs.map((l) => l.line) ?? []);
    setData(map, 'tb-metro', fc(net.lines.flatMap((l) => l.geom.map((g) => line(g, { colour: l.colour, dim: journey !== null && !onJourney.has(l.ref) })))));
    setData(map, 'tb-metro-st', fc(net.stations.map((s) =>
      point(s.at, {
        key: s.id, inter: s.lines.length > 1, colour: net.colourOf(s.lines[0]),
        sel: s.id === mFrom || s.id === mTo || s.id === station?.id,
        label: lang === 'en' ? cleanName(s.name_en || s.name) : cleanName(s.name),
      }),
    )));
    setData(map, 'tb-metro-j', fc((journey?.legs ?? []).map((l) => line(l.path, { colour: l.colour }))));
  }, [metro, net, ready, journey, mFrom, mTo, station, lang]);

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

  // Entering metro mode frames the whole network once.
  const framed = useRef(false);
  useEffect(() => {
    if (!metro) {
      framed.current = false;
      return;
    }
    if (!net || !mapRef.current || framed.current || !net.stations.length) return;
    framed.current = true;
    mapRef.current.fitBounds(coreBox(net.stations.map((s) => s.at)), { padding: framePadding(), duration: ms(600) });
  }, [metro, net]);

  useEffect(() => {
    if (!journey || !mapRef.current) return;
    mapRef.current.fitBounds(bbox(journey.legs.flatMap((l) => l.path)), { padding: framePadding(true), maxZoom: 14.5, duration: ms(600) });
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
          <button type="button" className="icon-btn" onClick={() => setCard(null)} aria-label={t('cancel')}><X aria-hidden /></button>
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
            <button type="button" className="btn" onClick={() => copyCard(card)}><Share2 aria-hidden /> {t('share')}</button>
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
        <div className="btn-pair three">
          <button type="button" className="btn" onClick={() => { setMFrom(station.id); setStation(null); }}><TrainFront aria-hidden /> {t('metroFromHere')}</button>
          <button type="button" className="btn primary" onClick={() => { setMTo(station.id); setStation(null); }}><Flag aria-hidden /> {t('metroToHere')}</button>
          <button type="button" className="btn" onClick={() => walkTo(station)}><WalkIcon aria-hidden /> {t('metroWalk')}</button>
        </div>
      </div>
    );
  } else if (!nav && metro) {
    sheetLabel = t('metroTitle');
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
                <p className="journey-sum"><span className="num big">{fmtDuration(lang, journey.minutes * 60)}</span><span className="muted">{nf(lang, journey.stops)} {t('metroStops')}{sep(lang)}{nf(lang, journey.legs.length - 1)} ×</span></p>
                <ol className="legs">
                  {journey.legs.map((l, i) => (
                    <li key={i} style={{ '--lc': l.colour } as React.CSSProperties}>
                      <span className="lbadge" style={{ '--lc': l.colour } as React.CSSProperties}>{t('metroLine')} {l.line}</span>
                      <div>
                        <strong>{i === 0 ? t('metroRide') : `${t('metroChange')} ${stationLabel(l.from)}`}</strong>
                        <span className="muted">{stationLabel(l.from)} → {stationLabel(l.to)}</span>
                        <span className="muted small">{t('metroToward')} {stationLabel(l.toward)}{sep(lang)}{nf(lang, l.stops)} {t('metroStops')}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {!mPick && mFrom !== null && mTo !== null && !journey && <p className="muted">{t('metroNoRoute')}</p>}
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
              <button type="button" className={!satellite ? 'ltype on' : 'ltype'} onClick={() => setSatellite(false)} aria-pressed={!satellite}>
                <span className="lt-thumb map" aria-hidden /> {t('mapDefault')}
              </button>
              <button type="button" className={satellite ? 'ltype on' : 'ltype'} disabled={!googleOk} onClick={() => setSatellite(true)} aria-pressed={satellite}>
                <span className="lt-thumb sat" aria-hidden /><span><Satellite aria-hidden className="inline" /> {t('satellite')}</span>
              </button>
            </div>
            {!googleOk && <p className="muted small">{t('satelliteNeedsKey')}</p>}
            {settings.has_neshan_web_key && (
              <label className="check"><input type="checkbox" checked={traffic} onChange={(e) => setTraffic(e.target.checked)} /><TrafficCone aria-hidden className="inline" /> {t('trafficLayer')}</label>
            )}
            <label className="check"><input type="checkbox" checked={b3d} onChange={(e) => setB3d(e.target.checked)} /><Box aria-hidden className="inline" /> {t('buildings3d')}</label>
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
          <div className="sheet-body">{sheet}</div>
        </section>
      )}

      {driver && <DriverView target={driver} onClose={() => setDriver(null)} />}
      {locAsk && (
        <div className="qa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setLocAsk(false); }}>
          <section className="qa loc-ask" role="dialog" aria-modal="true" aria-labelledby="loc-ask-title">
            <span className="loc-ask-ic" aria-hidden><LocateFixed /></span>
            <h2 id="loc-ask-title">{t('locAskTitle')}</h2>
            <p>{t('locAskWhy')}</p>
            <p className="muted">{t(isMobile ? 'locAskPhone' : 'locAskPc')}</p>
            <footer className="qa-foot">
              <button type="button" className="btn" onClick={() => setLocAsk(false)}>{t('notNow')}</button>
              <button type="button" className="btn primary" onClick={allowLocation}>
                <LocateFixed aria-hidden /> {t(isMobile ? 'locAllow' : 'locOpenSettings')}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
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
