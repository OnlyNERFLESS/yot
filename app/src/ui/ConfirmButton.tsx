// A destructive button that needs a second tap: the first turns it into
// "Tap again to delete" for a few seconds. Deleting the offline map or a saved
// place used to happen on a single, easily accidental tap.
import { useEffect, useState, type ReactNode } from 'react';
import { useApp } from '../app/ctx';

export function ConfirmButton({ onConfirm, className, children }: { onConfirm: () => void; className?: string; children: ReactNode }) {
  const { t } = useApp();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(id);
  }, [armed]);
  return (
    <button
      type="button"
      className={`${className ?? ''}${armed ? ' armed' : ''}`}
      aria-live="polite"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? t('tapAgainDelete') : children}
    </button>
  );
}
