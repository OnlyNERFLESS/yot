import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../app/ctx';
import { fmtDistance } from '../lib/i18n';

export interface DriverTarget {
  /** Persian name or label, the line the driver reads. */
  fa: string;
  /** Persian address or "نزدیک <street>", when known. */
  faLine: string;
  /** English name for the agent's own reference. */
  en: string;
  distanceM: number | null;
}

type WakeLock = { release: () => Promise<void> };

/**
 * Full-screen card for handing the phone to a taxi driver: the destination in
 * Persian at a size readable from the driver's seat, nothing else competing.
 */
export function DriverView({ target, onClose }: { target: DriverTarget; onClose: () => void }) {
  const { t } = useApp();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    let lock: WakeLock | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (k: 'screen') => Promise<WakeLock> } };
    void nav.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => undefined);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void lock?.release().catch(() => undefined);
    };
  }, [onClose]);

  return (
    <div className="driver" role="dialog" aria-modal="true" aria-label={t('driverHint')}>
      <p className="driver-hint">{t('driverHint')}</p>
      <div className="driver-body" lang="fa" dir="rtl">
        <p className="driver-name">{target.fa}</p>
        {target.faLine && <p className="driver-line">{target.faLine}</p>}
        {target.distanceM !== null && <p className="driver-dist num">{fmtDistance('fa', target.distanceM)}</p>}
      </div>
      {/[A-Za-z]{3}/.test(target.en.replace(/^Near /, '')) && target.en !== target.fa && <p className="driver-en" lang="en" dir="ltr">{target.en}</p>}
      <button ref={closeRef} type="button" className="btn primary driver-done" onClick={onClose}>
        <X aria-hidden /> {t('finish')}
      </button>
    </div>
  );
}
