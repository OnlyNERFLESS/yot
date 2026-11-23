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

export type FixHandler = (fix: Fix) => void;
export type ErrorHandler = (message: string) => void;

const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);

/** Start watching; returns a stop function. */
export async function watch(onFix: FixHandler, onError: ErrorHandler): Promise<() => void> {
  if (isMobile) {
    const geo = await import('@tauri-apps/plugin-geolocation');
    let perm = await geo.checkPermissions();
    if (perm.location !== 'granted') perm = await geo.requestPermissions(['location']);
    if (perm.location !== 'granted') {
      onError('Location permission was not granted');
      return () => {};
    }
    const id = await geo.watchPosition({ enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }, (pos, err) => {
      if (err || !pos) {
        onError(String(err ?? 'no position'));
        return;
      }
      const c = pos.coords;
      onFix({ lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: c.speed ?? null, heading: c.heading ?? null, t: pos.timestamp });
    });
    return () => void geo.clearWatch(id);
  }
  if (!('geolocation' in navigator)) {
    onError('Location is not available on this device');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      onFix({ lng: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, t: pos.timestamp });
    },
    (err) => onError(err.message),
    { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
