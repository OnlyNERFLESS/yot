import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Settings } from '../lib/api';
import { dict, type Key, type Lang } from '../lib/i18n';

export type Screen = 'home' | 'map' | 'metro' | 'calendar' | 'tasks' | 'panel';

/** A request from one screen to the map, e.g. the dashboard's "Navigate" button. */
export type MapIntent =
  | { kind: 'navigate' }
  | { kind: 'record' }
  | { kind: 'track'; id: number }
  | { kind: 'place'; at: [number, number]; label: string }
  | null;

interface Ctx {
  settings: Settings;
  reload: () => Promise<void>;
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => Promise<void>;
  t: (k: Key) => string;
  lang: Lang;
  dark: boolean;
  online: boolean;
  screen: Screen;
  go: (s: Screen, intent?: MapIntent) => void;
  intent: MapIntent;
  clearIntent: () => void;
}

const DEFAULTS: Settings = {
  lang: 'en',
  theme: 'system',
  provider_pref: 'auto',
  default_mode: 'car',
  avoid_traffic_zone: false,
  avoid_odd_even: false,
  has_neshan_service_key: false,
  has_neshan_web_key: false,
  has_google_key: false,
  ringtone: 'emerald',
};

const C = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

function useMedia(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [online, setOnline] = useState(navigator.onLine);
  const [screen, setScreen] = useState<Screen>('home');
  const [intent, setIntent] = useState<MapIntent>(null);
  const systemDark = useMedia('(prefers-color-scheme: dark)');

  const reload = useCallback(async () => setSettings(await api.settings()), []);
  useEffect(() => {
    void reload();
  }, [reload]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, []);

  const update = useCallback(async <K extends keyof Settings>(k: K, v: Settings[K]) => {
    await api.setSetting(k, v);
    setSettings((s) => ({ ...s, [k]: v }));
  }, []);

  const lang = settings.lang;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [lang, dark]);

  const value = useMemo<Ctx>(
    () => ({
      settings,
      reload,
      update,
      t: (k) => dict[lang][k],
      lang,
      dark,
      online,
      screen,
      go: (s, i = null) => {
        setScreen(s);
        if (i) setIntent(i);
      },
      intent,
      clearIntent: () => setIntent(null),
    }),
    [settings, reload, update, lang, dark, online, screen, intent],
  );
  return <C.Provider value={value}>{children}</C.Provider>;
}
