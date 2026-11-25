// One location API over two backends: the native geolocation plugin on
// Android (the WebView's own navigator.geolocation is not wired to GPS there),
// navigator.geolocation on desktop, where Windows estimates from Wi-Fi.
export interface Fix {
  lng: number;
  lat: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  t: number;
}

/** Why location is not available, so the app can offer the right fix:
 * `off` the phone's location switch is off, `denied` permission refused,
 * `error` anything else (no signal yet, a plugin error). */
export type LocProblem = 'off' | 'denied' | 'error';

export type FixHandler = (fix: Fix) => void;
export type ErrorHandler = (message: string, problem: LocProblem) => void;

export const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

type Sys = { YotSys?: { locationOn(): boolean; locationGranted?(): string; openLocationSettings(): void; openAppSettings(): void } };
const sys = () => (window as unknown as Sys).YotSys;

/** Android: is the phone's own location switch on? (true where unknown) */
export const locationSwitchOn = () => sys()?.locationOn() ?? true;
export const openPhoneLocationSettings = () => sys()?.openLocationSettings();
export const openAppPermissionSettings = () => sys()?.openAppSettings();

/** Android: ask for location; "Approximate" counts as yes. Returns whether
 * any location permission is now granted and whether it is precise.
 *
 * Android's own answer comes first. The plugin's permission calls reject
 * whenever the phone's location switch is off, so asking the plugin alone
 * reported a granted permission as refused and sent people to the app's
 * permission page for nothing. */
export async function requestLocationPermission(): Promise<{ granted: boolean; precise: boolean }> {
  const native = sys()?.locationGranted?.();
  if (native === 'fine' || native === 'coarse') return { granted: true, precise: native === 'fine' };
  const geo = await import('@tauri-apps/plugin-geolocation');
  let perm = await geo.checkPermissions();
  const ok = (p: typeof perm) => p.location === 'granted' || p.coarseLocation === 'granted';
  if (!ok(perm)) perm = await geo.requestPermissions(['location', 'coarseLocation']);
  return { granted: ok(perm), precise: perm.location === 'granted' };
}

/** Start watching; returns a stop function. */
export async function watch(onFix: FixHandler, onError: ErrorHandler): Promise<() => void> {
  if (isMobile) {
    // Any failure here (location services off, permission refused) must reach
    // onError: a rejected promise used to vanish and the map just sat waiting.
    try {
      const geo = await import('@tauri-apps/plugin-geolocation');
      // The switch first: with it off, no permission prompt can help, and the
      // plugin rejects its permission calls anyway.
      if (!locationSwitchOn()) {
        onError('Location is switched off on this phone', 'off');
        return () => {};
      }
      const { granted, precise } = await requestLocationPermission();
      if (!granted) {
        onError('Location permission was not granted', 'denied');
        return () => {};
      }
      // The last known position, if recent, puts the dot down at once while
      // the watch below waits for a fresh fix.
      let live = false;
      void geo.getCurrentPosition({ enableHighAccuracy: false, maximumAge: 5 * 60_000, timeout: 10_000 }).then((pos) => {
        if (live) return; // a fresh fix already arrived
        const c = pos.coords;
        onFix({ lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: null, heading: null, t: pos.timestamp });
      }, () => undefined);
      // The plugin uses `timeout` as the update interval, not as a timeout:
      // at 15 s the first fix waited up to 15 s and navigation moved in jumps.
      const id = await geo.watchPosition({ enableHighAccuracy: precise, timeout: 1_000, maximumAge: 0 }, (pos, err) => {
        if (err || !pos) {
          onError(String(err ?? 'no position'), locationSwitchOn() ? 'error' : 'off');
          return;
        }
        live = true;
        const c = pos.coords;
        onFix({ lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: c.speed ?? null, heading: c.heading ?? null, t: pos.timestamp });
      });
      return () => void geo.clearWatch(id);
    } catch (e) {
      onError(String(e instanceof Error ? e.message : e), 'error');
      return () => {};
    }
  }
  if (!('geolocation' in navigator)) {
    onError('Location is not available on this device', 'error');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      onFix({ lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, t: pos.timestamp });
    },
    (err) => onError(err.message, err.code === err.PERMISSION_DENIED ? 'denied' : 'error'),
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
