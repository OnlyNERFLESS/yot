import { useEffect, useState, type CSSProperties } from 'react';
import {
  AlertTriangle, Bell, CalendarCheck2, CalendarClock, Check, ChevronRight, Circle, Clock3, History, Flag, ListChecks,
  Map as MapIcon, MapPin, Navigation, Repeat as RepeatIcon, Sun, TrainFront, Zap, type LucideIcon,
} from 'lucide-react';
import { useApp } from '../app/ctx';
import { api, type PackInfo, type Reminder, type Repeat, type Task } from '../lib/api';
import { recentList, type Recent } from '../lib/recent';
import { JALALI_MONTHS, JALALI_MONTHS_EN, toJalali } from '../lib/jalali';
import { eventsOn } from '../lib/events';
import { occurrences } from '../lib/recur';
import { QuickAdd } from '../ui/QuickAdd';
import { fmtDuration, kindLabel, nf } from '../lib/i18n';

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const PACK_NAMES: Record<string, { en: string; fa: string }> = {
  iran: { en: 'Iran (overview)', fa: 'ایران (نمای کلی)' },
  tehran: { en: 'Tehran (full detail)', fa: 'تهران (با جزئیات کامل)' },
};

const DAY_MS = 86_400_000;
/** 22 Nov 2026 is a Sunday: adding a weekday index (0 = Sunday) names that day. */
const SUNDAY = new Date(2026, 10, 22);

interface Occ {
  r: Reminder;
  at: number;
}

export function Home({ active }: { active: boolean }) {
  const { t, lang, online, go } = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [last, setLast] = useState<Recent | null>(() => recentList()[0] ?? null);
  const [packs, setPacks] = useState<PackInfo[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [quick, setQuick] = useState(false);
  // Re-render each minute so "now", "next" and the day bar keep moving.
  const [now, setNow] = useState(() => Date.now());
  const loadReminders = () => void api.reminders().then(setReminders);
  const loadTasks = () => void api.tasks().then(setTasks);

  useEffect(() => {
    if (!active) return;
    loadTasks();
    setLast(recentList()[0] ?? null);
    void api.packs().then(setPacks);
    loadReminders();
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), 60_000);
    const onChange = () => loadReminders();
    window.addEventListener('yot:reminders', onChange);
    return () => {
      window.clearInterval(tick);
      window.removeEventListener('yot:reminders', onChange);
    };
  }, [active]);

  const loc = lang === 'fa' ? 'fa-IR' : 'en-GB';
  const nowD = new Date(now);
  const start = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate()).getTime();
  const end = start + DAY_MS;
  const d = today();

  const live = reminders.filter((r) => !r.done);
  const todayOcc: Occ[] = live
    .flatMap((r) => occurrences(r, start, end, 50).map((at) => ({ r, at })))
    .sort((a, b) => Number(b.r.all_day) - Number(a.r.all_day) || a.at - b.at);
  const weekOcc: Occ[] = live
    .flatMap((r) => occurrences(r, end, end + 6 * DAY_MS, 10).map((at) => ({ r, at })))
    .sort((a, b) => a.at - b.at)
    .slice(0, 5);
  const dueTasks = tasks
    .filter((x) => !x.done && x.due !== null && x.due <= d)
    .sort((a, b) => b.priority - a.priority || (a.due ?? '').localeCompare(b.due ?? ''));
  const lateCount = dueTasks.filter((x) => x.due! < d).length;
  const next = todayOcc.find((o) => !o.r.all_day && o.at > now);
  const dayPct = Math.min(100, Math.max(0, ((now - start) / DAY_MS) * 100));

  const time = (ms: number) => new Date(ms).toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  const weekday = (i: number, style: 'long' | 'short' = 'long') =>
    new Date(SUNDAY.getTime() + i * DAY_MS).toLocaleDateString(loc, { weekday: style });
  const repeatLabel = (rp: Repeat): string | null => {
    switch (rp.freq) {
      case 'daily': return t('rDaily');
      case 'weekdays': return t('rWeekdays');
      case 'weekly': return `${t('everyN')} ${(rp.days ?? []).map((x) => weekday(x)).join(', ')}`;
      case 'monthly': return t('rMonthly');
      case 'yearly': return t('rYearly');
      case 'interval': return `${t('everyN')} ${nf(lang, rp.interval ?? 1)} ${t('days')}`;
      default: return null;
    }
  };

  const toggleTask = async (x: Task) => {
    await api.taskSave({ ...x, done: !x.done });
    loadTasks();
  };

  // The date block: the day large, the other calendar underneath.
  const j = toJalali(nowD);
  // The day's holiday, else its first Iranian occasion.
  const todayEv = eventsOn(nowD)[0] ?? null;
  const jYear = j.jy.toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB', { useGrouping: false });
  const jText = lang === 'fa'
    ? `${nf(lang, j.jd)} ${JALALI_MONTHS[j.jm - 1]} ${jYear}`
    : `${j.jd} ${JALALI_MONTHS_EN[j.jm - 1]} ${j.jy}`;
  const gMonth = nowD.toLocaleDateString(loc, { month: 'long', year: 'numeric' });
  // The other calendar's date, in the reader's language: ۲۵ نوامبر ۲۰۲۶ in Persian.
  const alt = lang === 'fa' ? nowD.toLocaleDateString('fa-IR-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }) : jText;
  const big = lang === 'fa' ? nf(lang, j.jd) : String(nowD.getDate());
  const bigMonth = lang === 'fa' ? `${JALALI_MONTHS[j.jm - 1]} ${jYear}` : gMonth;

  const timed = todayOcc.filter((o) => !o.r.all_day);
  const allDay = todayOcc.filter((o) => o.r.all_day);
  const nowIndex = timed.findIndex((o) => o.at > now);
  const empty = todayOcc.length === 0 && dueTasks.length === 0;

  const row = (o: Occ, past: boolean) => {
    const Icon: LucideIcon = o.r.all_day ? Sun : o.r.place ? MapPin : Bell;
    const rep = repeatLabel(o.r.repeat);
    return (
      <li key={`${o.r.id}-${o.at}`} className={past ? 'tlt past' : 'tlt'}>
        <span className="tlt-time num">{o.r.all_day ? t('allDay') : time(o.at)}</span>
        <span className={`tlt-icon${o.r.place ? ' geo' : ''}`} aria-hidden>
          {past ? <Check /> : <Icon />}
        </span>
        <button type="button" className="tlt-body" onClick={() => go('calendar')}>
          <span className="tlt-title">{o.r.title}</span>
          {(rep || o.r.place || o.r.notes) && (
            <span className="tlt-meta">
              {rep && <span className="tag"><RepeatIcon aria-hidden />{rep}</span>}
              {o.r.place && <span className="tag"><MapPin aria-hidden />{o.r.place.name}</span>}
              {o.r.notes && <span className="tlt-note">{o.r.notes}</span>}
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div className="page home" hidden={!active}>
      <header className="page-head home-head">
        <img src="/logo.png" alt="" className="home-logo" width={56} height={56} />
        <div className="grow">
          <h1>{t('today')}</h1>
        </div>
        <span className={online ? 'pill ok' : 'pill'}><i className={online ? 'lamp live' : 'lamp'} aria-hidden />{online ? t('online') : t('offline')}</span>
      </header>

      {/* ---- The day at a glance ---- */}
      <section className="today-hero" aria-label={t('today')}>
        <div className="th-date">
          <span className="th-big num">{big}</span>
          <div className="th-date-text">
            <b>{nowD.toLocaleDateString(loc, { weekday: 'long' })}</b>
            <span>{bigMonth}</span>
            <span className="th-alt" dir={lang === 'fa' ? 'ltr' : undefined}>{alt}</span>
            {todayEv && <span className={`th-ev ${todayEv.kind}`}>{lang === 'fa' ? todayEv.fa : todayEv.en}</span>}
          </div>
        </div>

        <div className="th-stats">
          <Stat Icon={Bell} n={todayOcc.length} label={t('reminders')} lang={lang} onClick={() => go('calendar')} />
          <Stat Icon={ListChecks} n={dueTasks.length} label={t('navTasks')} lang={lang} onClick={() => go('tasks')} />
          <Stat Icon={AlertTriangle} n={lateCount} label={t('overdue')} lang={lang} tone={lateCount ? 'warn' : 'calm'} onClick={() => go('tasks')} />
        </div>

        <div className="th-next">
          <span className="th-next-icon" aria-hidden><Clock3 /></span>
          {next ? (
            <p>
              <span className="th-label">{t('nextUp')}</span>
              <b className="num">{time(next.at)}</b>
              <span className="th-next-title">{next.r.title}</span>
              <span className="th-in">{t('inTime').replace('{t}', fmtDuration(lang, (next.at - now) / 1000))}</span>
            </p>
          ) : (
            <p><span className="th-next-title">{todayOcc.length ? t('allDoneToday') : t('dayClear')}</span></p>
          )}
        </div>

        <div className="th-bar" role="img" aria-label={`${nf(lang, Math.round(dayPct))}% ${t('dayGone')}`}>
          <i style={{ '--p': `${dayPct}%` } as CSSProperties} />
          {timed.map((o) => (
            <b key={`${o.r.id}-${o.at}`} className={o.at <= now ? 'done' : ''} style={{ '--p': `${((o.at - start) / DAY_MS) * 100}%` } as CSSProperties} />
          ))}
        </div>
        <div className="th-bar-ticks num" aria-hidden>
          <span>{time(start)}</span><span>{time(start + DAY_MS / 2)}</span><span>{time(end - 60_000)}</span>
        </div>
      </section>

      <div className="quick">
        <button type="button" className="btn primary" onClick={() => setQuick(true)}><Zap aria-hidden /> {t('quickAdd')}</button>
        <button type="button" className="btn" onClick={() => go('map', { kind: 'navigate' })}><Navigation aria-hidden /> {t('quickNavigate')}</button>
        <button type="button" className="btn" onClick={() => go('metro')}><TrainFront aria-hidden /> {t('navMetro')}</button>
        <button type="button" className="btn" onClick={() => go('map')}><History aria-hidden /> {t('recentSearches')}</button>
      </div>
      <QuickAdd open={quick} kind="reminder" defaultDate={d} onClose={() => setQuick(false)} onSaved={() => { loadReminders(); loadTasks(); }} />

      {/* ---- Today's timeline ---- */}
      <section className="card today-card">
        <h2 className="card-title-row">
          <span><CalendarClock aria-hidden className="h-icon" /> {t('today')}</span>
          <button type="button" className="link-btn" onClick={() => go('calendar')}>{t('allReminders')} <ChevronRight aria-hidden /></button>
        </h2>

        {empty ? (
          <div className="day-empty">
            <span className="de-icon" aria-hidden><CalendarCheck2 /></span>
            <b>{t('dayClear')}</b>
            <p>{t('dayClearSub')}</p>
            <button type="button" className="btn primary" onClick={() => setQuick(true)}><Zap aria-hidden /> {t('quickAdd')}</button>
          </div>
        ) : (
          <>
            {(allDay.length > 0 || timed.length > 0) && (
              <ol className="tl-today">
                {allDay.map((o) => row(o, false))}
                {timed.map((o, i) => (
                  <FragmentWithNow key={`${o.r.id}-${o.at}`} showNow={i === nowIndex} label={t('nowLine')} at={time(now)}>
                    {row(o, o.at <= now)}
                  </FragmentWithNow>
                ))}
                {nowIndex === -1 && timed.length > 0 && <NowLine label={t('nowLine')} at={time(now)} />}
              </ol>
            )}

            {dueTasks.length > 0 && (
              <>
                <h3 className="tl-sub">{t('anytimeToday')}</h3>
                <ul className="tl-today tasks-today">
                  {dueTasks.map((x) => {
                    const late = x.due! < d;
                    return (
                      <li key={x.id} className="tlt">
                        <button type="button" className="tlt-check" onClick={() => void toggleTask(x)} aria-label={`${t('markDone')}: ${x.title}`}>
                          <Circle aria-hidden className="off" /><Check aria-hidden className="on" />
                        </button>
                        <span className={`tlt-icon task${x.priority === 2 ? ' hi' : ''}`} aria-hidden>
                          {x.priority === 2 ? <Flag /> : <ListChecks />}
                        </span>
                        <button type="button" className="tlt-body" onClick={() => go('tasks')}>
                          <span className="tlt-title">{x.title}</span>
                          {(late || x.priority === 2) && (
                            <span className="tlt-meta">
                              {late && <span className="tag warn"><AlertTriangle aria-hidden />{t('late')}</span>}
                              {x.priority === 2 && <span className="tag hi"><Flag aria-hidden />{t('high')}</span>}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      {/* ---- The rest of the week ---- */}
      {weekOcc.length > 0 && (
        <section className="card">
          <h2 className="card-title-row"><span><Bell aria-hidden className="h-icon" /> {t('laterThisWeek')}</span></h2>
          <ul className="plain week-list">
            {weekOcc.map(({ r, at }) => {
              const day = new Date(at);
              return (
                <li key={`${r.id}-${at}`}>
                  <span className="day-tile" aria-hidden>
                    <small>{day.toLocaleDateString(loc, { weekday: 'short' })}</small>
                    <b className="num">{lang === 'fa' ? nf(lang, toJalali(day).jd) : day.getDate()}</b>
                  </span>
                  <span className="wk-title">{r.title}</span>
                  <span className="wk-time num">{r.all_day ? t('allDay') : time(at)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ---- Trips and offline maps, side by side ---- */}
      <div className="mini-tiles">
        <section className="card mini">
          <span className="mini-icon" aria-hidden><History /></span>
          <div>
            <h2>{t('lastSearch')}</h2>
            {last ? (
              <button type="button" className="link-row" onClick={() => go('map', { kind: 'place', at: [last.lon, last.lat], label: lang === 'en' ? last.name_en || last.name : last.name })}>
                <span>{lang === 'en' ? last.name_en || last.name : last.name}</span>
                <span className="muted">{kindLabel(lang, last.kind)}</span>
              </button>
            ) : (
              <p className="muted">{t('recentEmpty')}</p>
            )}
          </div>
        </section>
        <section className="card mini">
          <span className="mini-icon" aria-hidden><MapIcon /></span>
          <div>
            <h2>{t('mapData')}</h2>
            {packs.length === 0 ? (
              <p className="muted">{t('noPacks')}</p>
            ) : (
              <ul className="plain">
                {packs.map((p) => (
                  <li key={p.name}><span className="pack-name">{PACK_NAMES[p.name]?.[lang] ?? p.name}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ Icon, n, label, lang, tone = 'calm', onClick }: {
  Icon: LucideIcon; n: number; label: string; lang: 'en' | 'fa'; tone?: 'calm' | 'warn'; onClick: () => void;
}) {
  return (
    <button type="button" className={`th-stat ${tone}${n === 0 ? ' zero' : ''}`} onClick={onClick}>
      <span className="th-stat-icon" aria-hidden><Icon /></span>
      <b className="num">{nf(lang, n)}</b>
      <span>{label}</span>
    </button>
  );
}

function NowLine({ label, at }: { label: string; at: string }) {
  return (
    <li className="now-line" aria-label={`${label} ${at}`}>
      <span className="num">{at}</span><i aria-hidden /><b>{label}</b>
    </li>
  );
}

function FragmentWithNow({ showNow, label, at, children }: { showNow: boolean; label: string; at: string; children: React.ReactNode }) {
  return (
    <>
      {showNow && <NowLine label={label} at={at} />}
      {children}
    </>
  );
}
