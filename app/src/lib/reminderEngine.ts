// Delivers reminders. Android: alerts for the next week are handed to the OS
// scheduler, so they fire with the app closed, with Snooze actions on the
// notification. Desktop: the OS cannot schedule, so a light ticker fires them
// while the app runs. Location reminders fire while the app has a GPS fix.
import {
  cancelAll, createChannel, Importance, isPermissionGranted, onAction, registerActionTypes, requestPermission, Schedule, sendNotification,
} from '@tauri-apps/plugin-notification';
import { api, RINGTONES, type Reminder, type Ringtone } from './api';
import { alertTimes } from './recur';
import { watch, type Fix } from './location';
import { distM } from './nav';

const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
// Android schedules ahead so alerts fire with the app closed; it is refreshed
// whenever the app opens. A week ran dry for anyone who did not open it for a
// week, so look 30 days ahead, soonest first, within the OS's alarm budget.
const HORIZON = 30 * 86_400_000;
const MAX_SCHEDULED = 400;
const FIRED_KEY = 'yot.fired';
export const SNOOZE_MINUTES = [5, 15, 60] as const;

// ---------- sounds ----------
const audio = new Map<string, HTMLAudioElement>();
/** Plays a tone from the bundled set. Also used by Settings to preview. */
export function playTone(name: Ringtone) {
  if (name === 'silent') return;
  let a = audio.get(name);
  if (!a) {
    a = new Audio(`/sounds/${name}.wav`);
    audio.set(name, a);
  }
  a.currentTime = 0;
  void a.play().catch(() => undefined);
}
/** Android channels are immutable once created, so each tone gets its own. */
const channelOf = (tone: Ringtone) => `yot-${tone}`;

/** In-app alert, shown as a banner with Snooze / Open while the app is open. */
export interface InAppAlert {
  reminder: Reminder;
  occurrence: number;
  byPlace: boolean;
}
type Listener = (a: InAppAlert) => void;
const listeners = new Set<Listener>();
export const onInAppAlert = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Ask other parts of the app to reschedule after an edit. */
export const remindersChanged = () => window.dispatchEvent(new Event('yot:reminders'));

const notifId = (rid: number, slot: number) => (rid % 2_000_000) * 1000 + (slot % 1000);
const ridOf = (nid: number) => Math.floor(nid / 1000);

function fired(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}
function markFired(key: string) {
  const s = fired();
  s.add(key);
  localStorage.setItem(FIRED_KEY, JSON.stringify([...s].slice(-500)));
}

function bodyOf(r: Reminder, occ: number, lang: 'en' | 'fa'): string {
  const when = new Date(occ).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', ...(r.all_day ? {} : { hour: '2-digit', minute: '2-digit' }),
  });
  return [when, r.place?.name, r.notes].filter(Boolean).join(' · ').slice(0, 240);
}

async function ensurePermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === 'granted';
}

let started = false;

export function startReminderEngine(getLang: () => 'en' | 'fa', snoozeLabel: (m: number) => string) {
  if (started) return () => {};
  started = true;
  let reminders: Reminder[] = [];
  let permitted = false;
  let lastTick = Date.now();
  let stopGeo: (() => void) | null = null;
  let tone: Ringtone = 'emerald';

  const fire = (r: Reminder, occ: number, byPlace: boolean, key: string) => {
    if (fired().has(key)) return;
    markFired(key);
    listeners.forEach((l) => l({ reminder: r, occurrence: occ, byPlace }));
    // In front of the user: the banner plus our tone. Otherwise the OS
    // notification carries the tone. Android already holds the scheduled time
    // alerts, so only place alerts are sent from here.
    const seen = document.visibilityState === 'visible' && document.hasFocus();
    if (seen) playTone(tone);
    if (!permitted || (seen && !isMobile) || (isMobile && !byPlace)) return;
    const base = { id: notifId(r.id, 999), title: r.title, body: bodyOf(r, occ, getLang()), actionTypeId: 'reminder' };
    if (isMobile) sendNotification({ ...base, channelId: channelOf(tone) });
    else if (tone === 'silent') sendNotification(base);
    else void api.soundFile(tone).then((sound) => sendNotification({ ...base, sound }), () => sendNotification(base));
  };

  const scheduleMobile = async () => {
    await cancelAll().catch(() => undefined);
    const now = Date.now();
    const all: { r: Reminder; at: number; occ: number; slot: number }[] = [];
    for (const r of reminders) {
      if (r.done) continue;
      alertTimes(r, now, now + HORIZON).slice(0, 120).forEach(([at, occ], slot) => all.push({ r, at, occ, slot }));
    }
    all.sort((a, b) => a.at - b.at);
    for (const { r, at, occ, slot } of all.slice(0, MAX_SCHEDULED)) {
      sendNotification({
        id: notifId(r.id, slot), title: r.title, body: bodyOf(r, occ, getLang()),
        schedule: Schedule.at(new Date(at), false, true), actionTypeId: 'reminder', channelId: channelOf(tone),
      });
    }
  };

  // Location reminders: once per reminder per 6 hours, while inside its radius.
  const onFix = (f: Fix) => {
    const here: [number, number] = [f.lng, f.lat];
    for (const r of reminders) {
      if (r.done || !r.place) continue;
      if (distM(here, [r.place.lon, r.place.lat]) <= r.place.radius_m + Math.min(f.accuracy, 100)) {
        fire(r, Date.now(), true, `geo:${r.id}:${Math.floor(Date.now() / 21_600_000)}`);
      }
    }
  };

  const reload = async () => {
    reminders = await api.reminders().catch(() => []);
    tone = (await api.settings().catch(() => null))?.ringtone ?? tone;
    if (isMobile && permitted) await scheduleMobile();
    const wantsGeo = reminders.some((r) => !r.done && r.place);
    if (wantsGeo && !stopGeo) stopGeo = await watch(onFix, () => undefined);
    if (!wantsGeo && stopGeo) {
      stopGeo();
      stopGeo = null;
    }
  };

  // Time alerts while the app is open (desktop always; mobile as a backup to
  // the OS schedule, de-duplicated by the fired set).
  const tick = () => {
    const now = Date.now();
    for (const r of reminders) {
      if (r.done) continue;
      for (const [at, occ] of alertTimes(r, lastTick, now + 1)) fire(r, occ, false, `t:${r.id}:${at}`);
    }
    lastTick = now;
  };

  const snooze = async (rid: number, minutes: number) => {
    await api.reminderSnooze(rid, Date.now() + minutes * 60_000);
    await reload();
  };

  void (async () => {
    permitted = await ensurePermission().catch(() => false);
    if (permitted && isMobile) {
      for (const t of RINGTONES) {
        await createChannel({ id: channelOf(t), name: `Reminders · ${t[0].toUpperCase()}${t.slice(1)}`, sound: t, importance: Importance.High, vibration: true }).catch(() => undefined);
      }
      await createChannel({ id: channelOf('silent'), name: 'Reminders · Silent', importance: Importance.Low, vibration: false }).catch(() => undefined);
      await registerActionTypes([
        { id: 'reminder', actions: SNOOZE_MINUTES.map((m) => ({ id: `snooze${m}`, title: snoozeLabel(m) })) },
      ]).catch(() => undefined);
      await onAction((ev) => {
        const m = /^snooze(\d+)$/.exec(ev.actionId);
        const nid = ev.notification?.id;
        if (m && typeof nid === 'number') void snooze(ridOf(nid), Number(m[1]));
      }).catch(() => undefined);
    }
    await reload();
  })();

  const timer = window.setInterval(tick, 20_000);
  const onChange = () => void reload();
  window.addEventListener('yot:reminders', onChange);
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('yot:reminders', onChange);
    stopGeo?.();
    started = false;
  };
}

export async function snoozeReminder(rid: number, minutes: number) {
  await api.reminderSnooze(rid, Date.now() + minutes * 60_000);
  remindersChanged();
}
