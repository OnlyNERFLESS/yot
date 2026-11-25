import { useEffect, useRef, useState } from 'react';
import { onBackButtonPress } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { runBack, useBack } from './lib/back';
import { isMobile } from './lib/location';
import { Bell, CalendarDays, House, ListChecks, Map as MapIcon, MapPin, Settings, TrainFront, X, type LucideIcon } from 'lucide-react';
import { AppProvider, useApp, type Screen } from './app/ctx';
import { Calendar } from './screens/Calendar';
import { Home } from './screens/Home';
import { MapScreen } from './screens/MapScreen';
import { Panel } from './screens/Panel';
import { Tasks } from './screens/Tasks';
import type { Key } from './lib/i18n';
import { UpdatePrompt } from './ui/UpdatePrompt';
import { onInAppAlert, snoozeReminder, SNOOZE_MINUTES, startReminderEngine, type InAppAlert } from './lib/reminderEngine';

const NAV: { id: Screen; label: Key; Icon: LucideIcon }[] = [
  { id: 'home', label: 'navDashboard', Icon: House },
  { id: 'map', label: 'navMap', Icon: MapIcon },
  { id: 'metro', label: 'navMetro', Icon: TrainFront },
  { id: 'calendar', label: 'navCalendar', Icon: CalendarDays },
  { id: 'tasks', label: 'navTasks', Icon: ListChecks },
  { id: 'panel', label: 'navPanel', Icon: Settings },
];

/** A reminder firing while the app is open: Snooze, open its place, or dismiss. */
function AlertBanner() {
  const { t, lang, go } = useApp();
  const [alert, setAlert] = useState<InAppAlert | null>(null);
  useEffect(() => onInAppAlert(setAlert), []);
  useBack(() => (alert ? (setAlert(null), true) : false));
  if (!alert) return null;
  const r = alert.reminder;
  return (
    <div className="alert-banner" role="alert">
      <Bell aria-hidden className="ab-icon" />
      <div className="ab-copy">
        <strong>{r.title}</strong>
        <span className="muted small">
          {alert.byPlace && r.place ? `${t('nearPlace')} ${r.place.name}` : new Date(alert.occurrence).toLocaleTimeString(lang === 'fa' ? 'fa-IR' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <div className="ab-actions">
        {SNOOZE_MINUTES.map((m) => (
          <button key={m} type="button" className="btn sm" onClick={() => { void snoozeReminder(r.id, m); setAlert(null); }}>
            {t('snoozeMin').replace('{n}', String(m))}
          </button>
        ))}
        {r.place && (
          <button type="button" className="btn sm primary" onClick={() => { go('map', { kind: 'place', at: [r.place!.lon, r.place!.lat], label: r.place!.name }); setAlert(null); }}>
            <MapPin aria-hidden /> {t('openPlace')}
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => setAlert(null)} aria-label={t('cancel')}><X aria-hidden /></button>
      </div>
    </div>
  );
}

function Shell() {
  const { t, lang, screen, go } = useApp();
  useEffect(
    () => startReminderEngine(() => lang, (m) => t('snoozeMin').replace('{n}', String(m))),
    // The engine runs for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Android Back: close what is open; else go Home; on Home, press twice to exit.
  const screenRef = useRef(screen);
  screenRef.current = screen;
  const goRef = useRef(go);
  goRef.current = go;
  const lastBack = useRef(0);
  const [exitHint, setExitHint] = useState(false);
  useEffect(() => {
    if (!isMobile) return;
    let alive = true;
    let stop = () => {};
    void onBackButtonPress(() => {
      if (runBack()) return;
      if (screenRef.current !== 'home') return goRef.current('home');
      const now = Date.now();
      if (now - lastBack.current < 2000) return void invoke('app_quit');
      lastBack.current = now;
      setExitHint(true);
      window.setTimeout(() => setExitHint(false), 2000);
    }).then((l) => {
      if (alive) stop = () => void l.unregister();
      else void l.unregister();
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Waymate">
        <span className="mark" aria-label="Waymate">
          <img src="/logo.png" alt="" width={40} height={40} />
          <span aria-hidden>Waymate</span>
        </span>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} type="button" className={screen === id ? 'on' : ''} aria-current={screen === id ? 'page' : undefined} onClick={() => go(id)}>
            <Icon aria-hidden strokeWidth={1.8} />
            <span>{t(label)}</span>
          </button>
        ))}
      </nav>
      <main className="main">
        <Home active={screen === 'home'} />
        <MapScreen active={screen === 'map' || screen === 'metro'} metro={screen === 'metro'} />
        <Calendar active={screen === 'calendar'} />
        <Tasks active={screen === 'tasks'} />
        <Panel active={screen === 'panel'} />
        <AlertBanner />
        <UpdatePrompt />
        {exitHint && <div className="toast" role="status">{t('backToExit')}</div>}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
