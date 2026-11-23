import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../app/ctx';

/** ISO date for a day offset from today, local time. */
function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const toShown = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

/** Parse "dd/mm/yyyy" (also accepts - . or spaces, and Persian digits) to ISO, or null. */
function parse(text: string): string | null {
  const ascii = text.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  const m = ascii.trim().match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * The app's own date field. The native one takes its day/month order from the
 * operating system's locale, which the page cannot override, so an en-GB app
 * showed US mm/dd/yyyy. This one is always day/month/year, plus one-tap days.
 */
export function DateField({ value, onChange, label }: { value: string; onChange: (iso: string) => void; label: string }) {
  const { lang } = useApp();
  const [text, setText] = useState(toShown(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(toShown(value));
    setBad(false);
  }, [value]);

  const quick: [string, string][] = [
    [lang === 'fa' ? 'امروز' : 'Today', isoIn(0)],
    [lang === 'fa' ? 'فردا' : 'Tomorrow', isoIn(1)],
    [lang === 'fa' ? 'هفتهٔ بعد' : 'Next week', isoIn(7)],
  ];

  return (
    <div className="datefield">
      <span className="field-label">{label}</span>
      <input
        className="num"
        dir="ltr"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        aria-label={label}
        aria-invalid={bad}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!text.trim()) {
            setBad(false);
            onChange('');
            return;
          }
          const iso = parse(text);
          setBad(iso === null);
          if (iso) onChange(iso);
        }}
      />
      <div className="chips">
        {quick.map(([name, iso]) => (
          <button key={name} type="button" className={value === iso ? 'chip on' : 'chip'} onClick={() => onChange(iso)}>
            {name}
          </button>
        ))}
        {value && (
          <button type="button" className="chip" onClick={() => onChange('')} aria-label={lang === 'fa' ? 'حذف تاریخ' : 'Clear date'}>
            <X aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
