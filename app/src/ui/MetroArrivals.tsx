// "Next trains" on a metro station card: live arrivals per direction,
// refreshed every 30 s while the card is open, from an unofficial source
// (see lib/metroEta.ts), so it is labelled as such and fails quietly.
// The same fetch also places the approaching trains on the map.
import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { useApp } from '../app/ctx';
import { arrivalsAt, etaIdsFor, type Arrival } from '../lib/metroEta';
import { nf } from '../lib/i18n';

const REFRESH_MS = 30_000;

export interface Arrivals {
  /** False when the service has no such station: show nothing at all. */
  covered: boolean;
  rows: Arrival[] | null | 'loading';
  /** When `rows` was fetched, so minutes can count down between refreshes. */
  at: number;
}

const NONE: Arrivals = { covered: false, rows: null, at: 0 };

/** Live arrivals for one station while `name` is set and the app is online. */
export function useArrivals(name: string | null): Arrivals {
  const { online } = useApp();
  const covered = name !== null && etaIdsFor(name).length > 0;
  const [state, setState] = useState<Arrivals>(NONE);

  useEffect(() => {
    if (!covered || !online || name === null) {
      setState(covered ? { covered, rows: null, at: 0 } : NONE);
      return;
    }
    let ctl = new AbortController();
    const load = () => {
      ctl.abort();
      ctl = new AbortController();
      void arrivalsAt(name, ctl.signal).then(
        (rows) => setState({ covered, rows, at: Date.now() }),
        (e: unknown) => {
          if ((e as Error)?.name !== 'AbortError') setState({ covered, rows: null, at: Date.now() });
        },
      );
    };
    setState({ covered, rows: 'loading', at: 0 });
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      ctl.abort();
    };
  }, [name, covered, online]);

  return state;
}

/** Minutes left now, counting down from the fetch. */
export const minutesLeft = (m: number | null, at: number, now = Date.now()) =>
  m === null ? null : Math.max(0, Math.round(m - (now - at) / 60_000));

export function MetroArrivals({ arrivals, label }: { arrivals: Arrivals; label: (towardFa: string) => string }) {
  const { t, lang, online } = useApp();
  const { covered, rows, at } = arrivals;
  if (!covered) return null;
  const when = (m: number | null) => (m === null ? t('etaNone') : m === 0 ? t('etaArriving') : `${nf(lang, m)} ${t('etaMin')}`);

  return (
    <section className="arrivals" aria-live="polite">
      <p className="arr-head">
        <span><Radio aria-hidden className="inline" /> {t('etaTitle')}</span>
        <span className="muted small">{t('etaUnofficial')}</span>
      </p>
      {!online ? (
        <p className="muted small">{t('etaOffline')}</p>
      ) : rows === 'loading' ? (
        <div className="arr-skel" />
      ) : rows === null || rows.length === 0 ? (
        <p className="muted small">{t('etaUnavailable')}</p>
      ) : (
        <ul className="arr-list">
          {rows.map((r) => {
            const m = minutesLeft(r.minutes, at);
            return (
              <li key={r.toward} className={m === 0 ? 'now' : ''}>
                <span className="arr-to">{t('metroToward')} {label(r.toward)}</span>
                <span className="num arr-min">{when(m)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
