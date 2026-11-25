// Street view from Mapillary: the street-level photos taken nearest a point,
// one at a time, with swipe and arrows to step through them. A photo viewer
// rather than MapillaryJS's 3D player: it costs no bundle weight and is all an
// agent needs to recognise a door or a corner before arriving.
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Compass, ImageOff, Loader2, X } from 'lucide-react';
import { useApp } from '../app/ctx';
import { api, type LngLat } from '../lib/api';
import { distM } from '../lib/nav';
import { fmtDistance, nf } from '../lib/i18n';
import { useBack } from '../lib/back';

interface Shot {
  id: string;
  url: string;
  at: LngLat;
  takenMs: number;
  heading: number | null;
  distanceM: number;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; shots: Shot[] }
  | { kind: 'none' }
  | { kind: 'failed'; raw: string };

const RADIUS_M = 150;

async function nearbyShots(token: string, at: LngLat, signal: AbortSignal): Promise<Shot[]> {
  const dLat = RADIUS_M / 111_320;
  const dLng = dLat / Math.cos((at[1] * Math.PI) / 180);
  const bbox = [at[0] - dLng, at[1] - dLat, at[0] + dLng, at[1] + dLat].map((v) => v.toFixed(6)).join(',');
  const url = `https://graph.mapillary.com/images?fields=id,thumb_2048_url,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry&bbox=${bbox}&limit=60`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${token}` }, signal });
  const body = (await res.json()) as {
    data?: {
      id: string; thumb_2048_url?: string; captured_at?: number; compass_angle?: number; computed_compass_angle?: number;
      geometry?: { coordinates: LngLat }; computed_geometry?: { coordinates: LngLat };
    }[];
    error?: { message: string };
  };
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `Mapillary ${res.status}`);
  return (body.data ?? [])
    .filter((d) => d.thumb_2048_url && (d.computed_geometry ?? d.geometry))
    .map((d) => {
      const p = (d.computed_geometry ?? d.geometry)!.coordinates;
      return {
        id: d.id, url: d.thumb_2048_url!, at: p, takenMs: d.captured_at ?? 0,
        heading: d.computed_compass_angle ?? d.compass_angle ?? null, distanceM: distM(at, p),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 30);
}

export function StreetView({ at, title, onClose }: { at: LngLat; title: string; onClose: () => void }) {
  const { t, lang } = useApp();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [i, setI] = useState(0);
  const [imgReady, setImgReady] = useState(false);
  useBack(() => (onClose(), true));

  useEffect(() => {
    const ctl = new AbortController();
    void (async () => {
      try {
        const token = await api.secret('mapillary_token');
        if (!token) throw new Error('no token');
        const shots = await nearbyShots(token, at, ctl.signal);
        setState(shots.length ? { kind: 'ready', shots } : { kind: 'none' });
      } catch (e) {
        if (!ctl.signal.aborted) setState({ kind: 'failed', raw: e instanceof Error ? e.message : String(e) });
      }
    })();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') step(lang === 'fa' ? -1 : 1);
      if (e.key === 'ArrowLeft') step(lang === 'fa' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      ctl.abort();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at[0], at[1]]);

  const shots = state.kind === 'ready' ? state.shots : [];
  const shot = shots[i];
  // The key handler is bound once; it reads the current count through this.
  const count = useRef(0);
  count.current = shots.length;
  function step(d: number) {
    setI((n) => {
      const next = Math.max(0, Math.min(Math.max(0, count.current - 1), n + d));
      if (next !== n) setImgReady(false);
      return next;
    });
  }

  // Swipe between photos.
  const swipe = useRef<number | null>(null);
  const onDown = (e: RPointerEvent) => (swipe.current = e.clientX);
  const onUp = (e: RPointerEvent) => {
    if (swipe.current === null) return;
    const dx = e.clientX - swipe.current;
    swipe.current = null;
    if (Math.abs(dx) > 40) step((dx < 0 ? 1 : -1) * (lang === 'fa' ? -1 : 1));
  };

  return (
    <div className="sv" role="dialog" aria-modal="true" aria-label={t('streetView')}>
      <header className="sv-head">
        <div className="sv-title">
          <strong>{t('streetView')}</strong>
          <span className="muted small">{title}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t('cancel')}><X aria-hidden /></button>
      </header>

      <div className="sv-stage" onPointerDown={onDown} onPointerUp={onUp}>
        {state.kind === 'loading' && <div className="sv-msg"><Loader2 className="sv-spin" aria-hidden /><p>{t('svLoading')}</p></div>}
        {state.kind === 'none' && <div className="sv-msg"><ImageOff aria-hidden /><p><strong>{t('svNone')}</strong></p><p className="muted small">{t('svNoneHint')}</p></div>}
        {state.kind === 'failed' && (
          <div className="sv-msg">
            <ImageOff aria-hidden />
            <p><strong>{t('svFailed')}</strong></p>
            <details className="muted small"><summary>{t('details')}</summary><code dir="ltr">{state.raw}</code></details>
          </div>
        )}
        {shot && (
          <>
            {!imgReady && <div className="sv-msg sv-under"><Loader2 className="sv-spin" aria-hidden /></div>}
            <img key={shot.id} className={imgReady ? 'sv-img in' : 'sv-img'} src={shot.url} alt="" onLoad={() => setImgReady(true)} draggable={false} />
            {i > 0 && (
              <button type="button" className="sv-nav prev" onClick={() => step(-1)} aria-label={t('svPrev')}>
                {lang === 'fa' ? <ChevronRight aria-hidden /> : <ChevronLeft aria-hidden />}
              </button>
            )}
            {i < shots.length - 1 && (
              <button type="button" className="sv-nav next" onClick={() => step(1)} aria-label={t('svNext')}>
                {lang === 'fa' ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}
              </button>
            )}
          </>
        )}
      </div>

      {shot && (
        <footer className="sv-foot">
          <span className="num">{nf(lang, i + 1)} / {nf(lang, shots.length)}</span>
          <span>
            <span className="num">{fmtDistance(lang, shot.distanceM)}</span>
            {shot.takenMs > 0 && <> · {new Date(shot.takenMs).toLocaleDateString(lang === 'fa' ? 'fa-IR' : 'en-GB', { month: 'short', year: 'numeric' })}</>}
            {shot.heading !== null && <> · <Compass aria-hidden className="inline" style={{ transform: `rotate(${shot.heading - 45}deg)` }} /></>}
          </span>
          <a className="sv-credit" href={`https://www.mapillary.com/app/?pKey=${shot.id}`} target="_blank" rel="noreferrer">© Mapillary, CC BY-SA</a>
        </footer>
      )}
    </div>
  );
}
