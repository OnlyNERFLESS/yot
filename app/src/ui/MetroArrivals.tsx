// "Next trains" on a metro station card: live arrivals per direction,
// refreshed every 30 s while the card is open, from an unofficial source
// (see lib/metroEta.ts), so it is labelled as such and fails quietly.
import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { useApp } from '../app/ctx';
import { arrivalsAt, etaIdsFor, type Arrival } from '../lib/metroEta';
import { nf } from '../lib/i18n';

const REFRESH_MS = 30_000;

export function MetroArrivals({ name, label }: { name: string; label: (towardFa: string) => string }) {
  const { t, lang, online } = useApp();
  const covered = etaIdsFor(name).length > 0;
  const [rows, setRows] = useState<Arrival[] | null | 'loading'>('loading');

  useEffect(() => {
    if (!covered || !online) return;
    let ctl = new AbortController();
    const load = () => {
      ctl.abort();
      ctl = new AbortController();
      void arrivalsAt(name, ctl.signal).then(setRows, () => setRows(null));
    };
    setRows('loading');
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      window.clearInterval(id);
      ctl.abort();
    };
  }, [name, covered, online]);

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
          {rows.map((r) => (
            <li key={r.toward} className={r.minutes === 0 ? 'now' : ''}>
              <span className="arr-to">{t('metroToward')} {label(r.toward)}</span>
              <span className="num arr-min">{when(r.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
