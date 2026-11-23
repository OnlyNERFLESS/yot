import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CalendarDays, Check, ListChecks, Repeat as RepeatIcon, X, Zap } from 'lucide-react';
import { useApp } from '../app/ctx';
import { api } from '../lib/api';
import { parseLines, startOf, type QuickItem } from '../lib/quickparse';
import { remindersChanged } from '../lib/reminderEngine';
import { nf } from '../lib/i18n';

export type QuickKind = 'reminder' | 'task';

/** Add many reminders or tasks at once: one per line, read into a live preview. */
export function QuickAdd({ open, kind: initialKind, defaultDate, onClose, onSaved }: {
  open: boolean;
  kind: QuickKind;
  /** Day to use when a line names none (the calendar's selected day). */
  defaultDate?: string;
  onClose: () => void;
  onSaved?: (kind: QuickKind, n: number) => void;
}) {
  const { t, lang } = useApp();
  const [kind, setKind] = useState<QuickKind>(initialKind);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // Callers pass inline arrows; reading the latest through a ref keeps the
  // open effect from re-running (and resetting the kind) on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setKind(initialKind);
    setErr(null);
    const id = window.setTimeout(() => area.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(id); window.removeEventListener('keydown', onKey); };
  }, [open, initialKind]);

  const items = useMemo(
    () => parseLines(text).map((q) => (q.date || !defaultDate ? q : { ...q, date: defaultDate })),
    [text, defaultDate],
  );

  if (!open) return null;

  const loc = lang === 'fa' ? 'fa-IR' : 'en-GB';
  const when = (q: QuickItem): string => {
    const parts: string[] = [];
    if (q.repeat.freq === 'daily') parts.push(t('rDaily'));
    else if (q.repeat.freq === 'monthly') parts.push(t('rMonthly'));
    else if (q.repeat.freq === 'weekly') {
      const d = new Date(2026, 10, 22 + (q.repeat.days?.[0] ?? 0)); // 22 Nov 2026 is a Sunday
      parts.push(`${t('everyN')} ${d.toLocaleDateString(loc, { weekday: 'long' })}`);
    }
    if (kind === 'task') {
      if (q.date) parts.push(new Date(`${q.date}T00:00`).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' }));
      else if (!parts.length) parts.push(t('noDate'));
      return parts.join(' · ');
    }
    const at = new Date(startOf(q));
    if (q.repeat.freq === 'none') parts.push(at.toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' }));
    parts.push(at.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' }));
    return parts.join(' · ');
  };

  const removeLine = (i: number) => {
    // Drop the i-th non-empty line, so the preview and the text stay in step.
    let n = -1;
    setText(text.split(/\r?\n/).filter((l) => (l.trim() ? ++n !== i : true)).join('\n'));
  };

  const save = async () => {
    if (!items.length || busy) return;
    setBusy(true);
    setErr(null);
    try {
      for (const q of items) {
        if (kind === 'task') {
          await api.taskSave({ title: q.title.slice(0, 200), notes: '', due: q.date, done: false, priority: q.high ? 2 : 1 });
        } else {
          await api.reminderSave({
            title: q.title.slice(0, 200), notes: '', start_ms: startOf(q), all_day: false, repeat: q.repeat,
            alerts: [0], place: null, task_id: null, done: false,
          });
        }
      }
      if (kind === 'reminder') remindersChanged();
      onSaved?.(kind, items.length);
      setText('');
      onClose();
    } catch (x) {
      setErr(String(x));
    } finally {
      setBusy(false);
    }
  };

  const n = items.length;
  return (
    <div className="qa-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="qa" role="dialog" aria-modal="true" aria-labelledby="qa-title">
        <header className="qa-head">
          <h2 id="qa-title"><Zap aria-hidden /> {t('quickAdd')}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('cancel')}><X aria-hidden /></button>
        </header>

        <div className="seg qa-kind" role="radiogroup" aria-label={t('quickAdd')}>
          <button type="button" role="radio" aria-checked={kind === 'reminder'} className={kind === 'reminder' ? 'on' : ''} onClick={() => setKind('reminder')}>
            <Bell aria-hidden /> {t('reminders')}
          </button>
          <button type="button" role="radio" aria-checked={kind === 'task'} className={kind === 'task' ? 'on' : ''} onClick={() => setKind('task')}>
            <ListChecks aria-hidden /> {t('navTasks')}
          </button>
        </div>

        <label className="sr-only" htmlFor="qa-text">{t('quickAddLabel')}</label>
        <textarea
          id="qa-text" ref={area} value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder={t(kind === 'task' ? 'quickAddExampleTask' : 'quickAddExample')}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); } }}
          data-lenis-prevent
        />
        <p className="qa-hint">{t('quickAddHint')}</p>

        {n > 0 && (
          <ol className="qa-list" aria-label={t('quickAddPreview')} data-lenis-prevent>
            {items.map((q, i) => (
              <li key={`${i}-${q.title}`}>
                <span className="qa-n num" aria-hidden>{i + 1}</span>
                <div className="qa-body">
                  <span className="qa-title">{q.high && <b className="qa-hi">!</b>}{q.title}</span>
                  <span className={q.date || q.time || q.repeat.freq !== 'none' ? 'qa-when' : 'qa-when soft'}>
                    {q.repeat.freq !== 'none' ? <RepeatIcon aria-hidden /> : <CalendarDays aria-hidden />}
                    {when(q)}
                  </span>
                </div>
                <button type="button" className="icon-btn sm" onClick={() => removeLine(i)} aria-label={`${t('delete')}: ${q.title}`}><X aria-hidden /></button>
              </li>
            ))}
          </ol>
        )}
        {err && <p className="error">{err}</p>}

        <footer className="qa-foot">
          <button type="button" className="btn" onClick={onClose}>{t('cancel')}</button>
          <button type="button" className="btn primary" disabled={!n || busy} onClick={() => void save()}>
            <Check aria-hidden />
            {n ? t(kind === 'task' ? 'quickAddTasksN' : 'quickAddRemindersN').replace('{n}', nf(lang, n)) : t('quickAddEmpty')}
          </button>
        </footer>
      </section>
    </div>
  );
}
