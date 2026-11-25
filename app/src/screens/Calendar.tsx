import { useEffect, useMemo, useState } from 'react';
import {
  Bell, CalendarDays, Check, ChevronLeft, ChevronRight, ListChecks, MapPin, Navigation, Plus, Repeat as RepeatIcon, Trash2, X, Zap,
} from 'lucide-react';
import { useBack } from '../lib/back';
import { useApp } from '../app/ctx';
import { api, type Reminder, type ReminderInput, type Repeat, type SavedPlace, type Task } from '../lib/api';
import { eventsOn, type CalEvent } from '../lib/events';
import { fromJalali, JALALI_MONTHS, JALALI_MONTHS_EN, jalaliMonthLength, toJalali } from '../lib/jalali';
import { dict, nf, type Lang } from '../lib/i18n';
import { dayKey, occurrences } from '../lib/recur';
import { remindersChanged } from '../lib/reminderEngine';
import { DateField } from '../ui/DateField';
import { QuickAdd } from '../ui/QuickAdd';
import { ConfirmButton } from '../ui/ConfirmButton';

type System = 'g' | 'j';
const WEEK_EN = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEK_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALERT_CHOICES = [0, 5, 15, 30, 60, 1440];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

const SYSTEM_KEY = 'yot.calSystem';

/** The calendar's content speaks the calendar on screen: on the Persian
 * (Solar Hijri) calendar the numbers, month and day names and the holiday and
 * event details are Persian; on Gregorian they are English. The app's own
 * language (buttons, headings, layout direction) never changes with it. */
export function Calendar({ active }: { active: boolean }) {
  const { lang } = useApp();
  const [system, setSystemState] = useState<System>(() => {
    const saved = localStorage.getItem(SYSTEM_KEY);
    return saved === 'g' || saved === 'j' ? saved : lang === 'fa' ? 'j' : 'g';
  });
  const setSystem = (v: System) => {
    localStorage.setItem(SYSTEM_KEY, v);
    setSystemState(v);
  };
  return <CalendarBody active={active} system={system} setSystem={setSystem} />;
}

function CalendarBody({ active, system, setSystem }: { active: boolean; system: System; setSystem: (s: System) => void }) {
  const { t, lang, go } = useApp();
  /** The calendar content's language (numbers, names, events); `lang` stays the UI's. */
  const cl: Lang = system === 'j' ? 'fa' : 'en';
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => new Date());
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [editing, setEditing] = useState<ReminderInput | null>(null);
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [quick, setQuick] = useState(false);
  useBack(() => (active && editing ? (setEditing(null), true) : false));

  const load = () => {
    void api.reminders().then(setReminders);
    void api.places().then(setPlaces);
    void api.tasks().then(setTasks);
  };
  useEffect(() => {
    if (active) load();
  }, [active]);

  // The month being shown, as a list of real dates, in the chosen system.
  const month = useMemo(() => {
    if (system === 'g') {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const n = new Date(y, m + 1, 0).getDate();
      const days = Array.from({ length: n }, (_, i) => new Date(y, m, i + 1));
      const title = cursor.toLocaleDateString(cl === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-GB', { month: 'long', year: 'numeric' });
      return { days, title };
    }
    const j = toJalali(cursor);
    const n = jalaliMonthLength(j.jy, j.jm);
    const days = Array.from({ length: n }, (_, i) => fromJalali(j.jy, j.jm, i + 1));
    // A year is not a quantity: no thousands separator (۱۴۰۵, not ۱٬۴۰۵).
    const title = cl === 'fa' ? `${JALALI_MONTHS[j.jm - 1]} ${j.jy.toLocaleString('fa-IR', { useGrouping: false })}` : `${JALALI_MONTHS_EN[j.jm - 1]} ${j.jy}`;
    return { days, title };
  }, [system, cursor, cl]);

  const lead = (month.days[0].getDay() + 1) % 7; // weeks start on Saturday
  const from = month.days[0].getTime();
  const to = new Date(month.days[month.days.length - 1]).setHours(24, 0, 0, 0);

  const byDay = useMemo(() => {
    const map = new Map<string, { r: Reminder; at: number }[]>();
    for (const r of reminders) {
      for (const at of occurrences(r, from, to)) {
        const k = dayKey(new Date(at));
        map.set(k, [...(map.get(k) ?? []), { r, at }]);
      }
    }
    map.forEach((v) => v.sort((a, b) => a.at - b.at));
    return map;
  }, [reminders, from, to]);

  const shift = (n: number) => {
    if (system === 'g') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));
    else {
      const j = toJalali(cursor);
      const m0 = j.jm - 1 + n;
      setCursor(fromJalali(j.jy + Math.floor(m0 / 12), ((m0 % 12) + 12) % 12 + 1, 1));
    }
  };

  const secondary = (d: Date) => (system === 'g' ? nf(cl, toJalali(d).jd) : nf(cl, d.getDate()));
  const primary = (d: Date) => (system === 'g' ? nf(cl, d.getDate()) : nf(cl, toJalali(d).jd));

  const startNew = () =>
    setEditing({
      title: '', notes: '', start_ms: new Date(selected).setHours(9, 0, 0, 0), all_day: false,
      repeat: { freq: 'none' }, alerts: [0, 15], place: null, task_id: null, done: false,
    });

  const monthEvents = useMemo(() => new Map(month.days.map((d) => [d.getTime(), eventsOn(d)] as const)), [month]);
  const agenda = byDay.get(dayKey(selected)) ?? [];
  const today = new Date();
  const selEvents = eventsOn(selected);
  // The day in the calendar on screen, then the same day in the other one.
  const selJ = toJalali(selected);
  const selG = selected.toLocaleDateString(cl === 'fa' ? 'fa-IR-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const selTitle = system === 'j'
    ? `${selected.toLocaleDateString('fa-IR', { weekday: 'long' })} ${nf('fa', selJ.jd)} ${JALALI_MONTHS[selJ.jm - 1]}`
    : selected.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  const selOther = system === 'j' ? `${selG} میلادی` : `${selJ.jd} ${JALALI_MONTHS_EN[selJ.jm - 1]} ${selJ.jy} (Persian)`;

  return (
    <div className="page cal" hidden={!active}>
      <header className="page-head">
        <h1>{t('navCalendar')}</h1>
        <div className="seg cal-sys" role="radiogroup" aria-label={t('navCalendar')}>
          <button type="button" role="radio" aria-checked={system === 'g'} className={system === 'g' ? 'on' : ''} onClick={() => setSystem('g')}>{t('gregorian')}</button>
          <button type="button" role="radio" aria-checked={system === 'j'} className={system === 'j' ? 'on' : ''} onClick={() => setSystem('j')}>{t('persian')}</button>
        </div>
      </header>

      <section className="card cal-card">
        <div className="cal-bar">
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label={t('prevMonth')}>{lang === 'fa' ? <ChevronRight aria-hidden /> : <ChevronLeft aria-hidden />}</button>
          <h2 className="cal-title" lang={cl} dir="auto">{month.title}</h2>
          <button type="button" className="icon-btn" onClick={() => shift(1)} aria-label={t('nextMonth')}>{lang === 'fa' ? <ChevronLeft aria-hidden /> : <ChevronRight aria-hidden />}</button>
          <button type="button" className="btn sm" onClick={() => { setCursor(new Date()); setSelected(new Date()); }}>{t('todayBtn')}</button>
        </div>
        <div className="cal-grid" role="grid">
          {(cl === 'fa' ? WEEK_FA : WEEK_EN).map((w, i) => <div key={w} className={i === 6 ? 'cal-wd fri' : 'cal-wd'} role="columnheader">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} className="cal-pad" />)}
          {month.days.map((d) => {
            const items = byDay.get(dayKey(d)) ?? [];
            const evs = monthEvents.get(d.getTime()) ?? [];
            const hol = evs.some((e) => e.kind === 'holiday');
            const occ = evs.some((e) => e.kind === 'occasion');
            const cls = ['cal-day', d.getDay() === 5 || hol ? 'off' : '', hol ? 'hol' : '', sameDay(d, today) ? 'today' : '', sameDay(d, selected) ? 'sel' : ''].join(' ');
            return (
              <button key={d.getTime()} type="button" className={cls} onClick={() => { setSelected(d); setEditing(null); }} aria-label={[d.toLocaleDateString(cl === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'full' }), ...evs.map((e) => (cl === 'fa' ? e.fa : e.en))].join(', ')} aria-pressed={sameDay(d, selected)}>
                <span className="num cal-n">{primary(d)}</span>
                <span className="cal-s">{secondary(d)}</span>
                {occ && !hol && <i className="cal-ev occ" aria-hidden />}
                {items.length > 0 && <span className="cal-dots" aria-hidden>{items.slice(0, 3).map((x, i) => <i key={i} className={x.r.place ? 'geo' : ''} />)}</span>}
              </button>
            );
          })}
        </div>
      </section>

      {editing ? (
        <ReminderEditor
          value={editing}
          places={places}
          tasks={tasks}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); remindersChanged(); }}
        />
      ) : (
        <section className="card agenda">
          <div className="agenda-head">
            <div>
              <h2 lang={cl} dir="auto">{selTitle}</h2>
              <p className="muted small" lang={cl} dir="auto">{selOther}</p>
            </div>
            <div className="agenda-btns">
              <button type="button" className="btn primary" onClick={() => setQuick(true)}><Zap aria-hidden /> {t('quickAdd')}</button>
              <button type="button" className="btn" onClick={startNew}><Plus aria-hidden /> {t('newReminder')}</button>
            </div>
          </div>
          {selEvents.length > 0 && (
            <ul className="plain day-events" aria-label={t('dayEvents')}>
              {selEvents.map((e, i) => <EventRow key={i} e={e} cl={cl} />)}
            </ul>
          )}
          {agenda.length === 0 ? (
            <p className="muted">{t('noReminders')}</p>
          ) : (
            <ul className="plain agenda-list">
              {agenda.map(({ r, at }) => (
                <li key={`${r.id}-${at}`} className={r.done ? 'rem done' : 'rem'}>
                  <button type="button" className="rem-main" onClick={() => setEditing({ ...r })}>
                    <span className="num rem-time">{r.all_day ? t('allDay') : new Date(at).toLocaleTimeString(lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                    <span className="rem-title">{r.title}</span>
                    <span className="rem-meta">
                      {r.repeat.freq !== 'none' && <RepeatIcon aria-hidden />}
                      {r.alerts.length > 0 && <Bell aria-hidden />}
                      {r.place && <><MapPin aria-hidden />{r.place.name}</>}
                      {r.task_id && <ListChecks aria-hidden />}
                    </span>
                  </button>
                  <span className="rem-actions">
                    {r.place && (
                      <button type="button" className="btn sm" onClick={() => go('map', { kind: 'place', at: [r.place!.lon, r.place!.lat], label: r.place!.name })}>
                        <Navigation aria-hidden /> {t('openPlace')}
                      </button>
                    )}
                    {r.task_id && <button type="button" className="btn sm" onClick={() => go('tasks')}><ListChecks aria-hidden /> {t('openTask')}</button>}
                    {r.repeat.freq === 'none' && !r.done && (
                      <button type="button" className="btn sm" onClick={() => void api.reminderSave({ ...r, done: true }).then(() => { load(); remindersChanged(); })}>
                        <Check aria-hidden /> {t('markDone')}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <QuickAdd open={quick} kind="reminder" defaultDate={iso(selected)} onClose={() => setQuick(false)} onSaved={() => load()} />
    </div>
  );
}

function ReminderEditor({ value, places, tasks, onCancel, onSaved }: {
  value: ReminderInput; places: SavedPlace[]; tasks: Task[]; onCancel: () => void; onSaved: () => void;
}) {
  const { t, lang } = useApp();
  const start = new Date(value.start_ms);
  const [title, setTitle] = useState(value.title);
  const [notes, setNotes] = useState(value.notes);
  const [day, setDay] = useState(iso(start));
  const [time, setTime] = useState(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`);
  const [allDay, setAllDay] = useState(value.all_day);
  const [repeat, setRepeat] = useState<Repeat>(value.repeat);
  const [endMode, setEndMode] = useState<'never' | 'on' | 'after'>(value.repeat.until_ms ? 'on' : value.repeat.count ? 'after' : 'never');
  const [endDay, setEndDay] = useState(value.repeat.until_ms ? iso(new Date(value.repeat.until_ms)) : '');
  const [alerts, setAlerts] = useState<number[]>(value.alerts);
  const [placeId, setPlaceId] = useState<string>(() => {
    const p = value.place;
    const hit = p && places.find((x) => Math.abs(x.lat - p.lat) < 1e-6 && Math.abs(x.lon - p.lon) < 1e-6);
    return hit ? String(hit.id) : '';
  });
  const [radius, setRadius] = useState(value.place?.radius_m ?? 200);
  const [taskId, setTaskId] = useState<string>(value.task_id ? String(value.task_id) : '');
  const [err, setErr] = useState<string | null>(null);

  const toggleAlert = (m: number) => setAlerts((a) => (a.includes(m) ? a.filter((x) => x !== m) : [...a, m].sort((x, y) => x - y)));
  const toggleDay = (d: number) => {
    const days = repeat.days ?? [];
    setRepeat({ ...repeat, days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort() });
  };
  const alertLabel = (m: number) =>
    m === 0 ? t('atTime') : m < 60 ? `${nf(lang, m)} ${t('minBefore')}` : m < 1440 ? `${nf(lang, m / 60)} ${t('hourBefore')}` : `${nf(lang, m / 1440)} ${t('dayBefore')}`;

  const save = async () => {
    if (!title.trim() || !day) return;
    const [y, mo, d] = day.split('-').map(Number);
    const [hh, mm] = allDay ? [9, 0] : time.split(':').map(Number);
    const rep: Repeat = { ...repeat };
    rep.until_ms = endMode === 'on' && endDay ? new Date(endDay + 'T23:59:59').getTime() : null;
    rep.count = endMode === 'after' ? Math.max(1, repeat.count ?? 10) : null;
    if (rep.freq !== 'interval') rep.interval = rep.freq === 'weekly' ? repeat.interval ?? 1 : null;
    if (rep.freq !== 'weekly') rep.days = null;
    const p = places.find((x) => String(x.id) === placeId);
    try {
      await api.reminderSave({
        id: value.id, title, notes, start_ms: new Date(y, mo - 1, d, hh, mm).getTime(), all_day: allDay, repeat: rep, alerts,
        place: p ? { name: p.name, lat: p.lat, lon: p.lon, radius_m: radius } : null,
        task_id: taskId ? Number(taskId) : null, done: value.done,
      });
      onSaved();
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <section className="card editor-card">
      <div className="agenda-head">
        <h2><CalendarDays aria-hidden className="inline" /> {value.id ? t('editReminder') : t('newReminder')}</h2>
        <button type="button" className="icon-btn" onClick={onCancel} aria-label={t('cancel')}><X aria-hidden /></button>
      </div>
      <form className="rem-form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('reminderTitle')} maxLength={200} autoFocus />

        <div className="row when">
          <DateField label={t('date')} value={day} onChange={setDay} />
          {!allDay && (
            <label className="time-field"><span className="field-label">{t('time')}</span><input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="num" /></label>
          )}
          <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> {t('allDay')}</label>
        </div>

        <fieldset className="opt-group">
          <legend>{t('repeat')}</legend>
          <select value={repeat.freq} onChange={(e) => setRepeat({ ...repeat, freq: e.target.value as Repeat['freq'], interval: e.target.value === 'interval' ? repeat.interval ?? 2 : repeat.interval })}>
            <option value="none">{t('rNone')}</option>
            <option value="daily">{t('rDaily')}</option>
            <option value="weekdays">{t('rWeekdays')}</option>
            <option value="weekly">{t('rWeekly')}</option>
            <option value="monthly">{t('rMonthly')}</option>
            <option value="yearly">{t('rYearly')}</option>
            <option value="interval">{t('rInterval')}</option>
          </select>
          {repeat.freq === 'weekly' && (
            <div className="day-chips">
              {[6, 0, 1, 2, 3, 4, 5].map((d) => (
                <button key={d} type="button" className={(repeat.days ?? []).includes(d) ? 'chip on' : 'chip'} onClick={() => toggleDay(d)} aria-pressed={(repeat.days ?? []).includes(d)}>
                  {lang === 'fa' ? WEEK_FA[(d + 1) % 7] : DAY_NAMES_EN[d]}
                </button>
              ))}
            </div>
          )}
          {repeat.freq === 'interval' && (
            <label className="inline-field">{t('everyN')} <input type="number" min={1} max={366} value={repeat.interval ?? 2} onChange={(e) => setRepeat({ ...repeat, interval: Number(e.target.value) })} className="num narrow" /> {t('days')}</label>
          )}
          {repeat.freq !== 'none' && (
            <div className="row ends">
              <span className="field-label">{t('ends')}</span>
              <div className="seg">
                {(['never', 'on', 'after'] as const).map((m) => (
                  <button key={m} type="button" className={endMode === m ? 'on' : ''} onClick={() => setEndMode(m)}>
                    {m === 'never' ? t('endNever') : m === 'on' ? t('endOn') : t('endAfter')}
                  </button>
                ))}
              </div>
              {endMode === 'on' && <DateField label={t('date')} value={endDay} onChange={setEndDay} />}
              {endMode === 'after' && (
                <label className="inline-field"><input type="number" min={1} max={10000} value={repeat.count ?? 10} onChange={(e) => setRepeat({ ...repeat, count: Number(e.target.value) })} className="num narrow" /> {t('times')}</label>
              )}
            </div>
          )}
        </fieldset>

        <fieldset className="opt-group">
          <legend>{t('alerts')}</legend>
          <div className="day-chips">
            {ALERT_CHOICES.map((m) => (
              <button key={m} type="button" className={alerts.includes(m) ? 'chip on' : 'chip'} onClick={() => toggleAlert(m)} aria-pressed={alerts.includes(m)}>
                <Bell aria-hidden /> {alertLabel(m)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="opt-group">
          <legend>{t('place')}</legend>
          <select value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">{t('noPlace')}</option>
            {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {placeId && (
            <label className="inline-field">
              <MapPin aria-hidden className="inline" /> {t('remindNear')} · {t('radius')}
              <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="narrow">
                {[100, 200, 500, 1000].map((r) => <option key={r} value={r}>{r < 1000 ? `${nf(lang, r)} m` : `${nf(lang, r / 1000)} km`}</option>)}
              </select>
            </label>
          )}
        </fieldset>

        <fieldset className="opt-group">
          <legend>{t('linkTask')}</legend>
          <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">{t('noTask')}</option>
            {tasks.filter((x) => !x.done).map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
          </select>
        </fieldset>

        <label><span className="field-label">{t('notes')}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={5000} /></label>
        {err && <p className="note warn">{err}</p>}
        <div className="row">
          <button type="submit" className="btn primary lg" disabled={!title.trim() || !day}><Check aria-hidden /> {t('save')}</button>
          {value.id && (
            <ConfirmButton className="btn ghost danger" onConfirm={() => void api.reminderDelete(value.id!).then(onSaved)}><Trash2 aria-hidden /> {t('delete')}</ConfirmButton>
          )}
        </div>
      </form>
    </section>
  );
}

/** A holiday or occasion, in the calendar's language rather than the app's. */
function EventRow({ e, cl }: { e: CalEvent; cl: Lang }) {
  return (
    <li className={`ev-row ${e.kind}`} lang={cl} dir="auto">
      <span className="ev-chip">{dict[cl][e.kind === 'holiday' ? 'evHoliday' : 'evOccasion']}</span>
      <span className="ev-name">{cl === 'fa' ? e.fa : e.en}</span>
    </li>
  );
}
