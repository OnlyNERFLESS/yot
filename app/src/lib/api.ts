// Typed bridge to the Rust core. Every command the UI calls is declared here,
// so a renamed field is a compile error rather than a silent `undefined`.
import { invoke } from '@tauri-apps/api/core';

export type Mode = 'car' | 'motorcycle' | 'walk';
export type Provider = 'offline' | 'neshan' | 'google';
export type LngLat = [number, number];

export type StepKind = 'depart' | 'turn' | 'continue' | 'arrive' | 'roundabout' | 'merge' | 'fork';
export type Modifier =
  | 'straight' | 'slight_left' | 'left' | 'sharp_left'
  | 'slight_right' | 'right' | 'sharp_right' | 'uturn';

export interface Step {
  kind: StepKind;
  modifier: Modifier;
  name: string;
  name_en: string;
  /** Ready-made sentence from an online provider (Persian for Neshan). Empty offline. */
  instruction?: string;
  distance_m: number;
  duration_s: number;
  at: LngLat;
}

export interface Route {
  provider: Provider;
  mode: Mode;
  distance_m: number;
  /** With live traffic for online providers, free-flow offline. */
  duration_s: number;
  /** Same route without traffic, when the provider reports it. */
  duration_free_s?: number | null;
  coords: LngLat[];
  steps: Step[];
}

export interface RouteRequest {
  provider: Provider;
  mode: Mode;
  from: LngLat;
  to: LngLat;
  alternatives: boolean;
  avoid_traffic_zone: boolean;
  avoid_odd_even: boolean;
}

export interface Hit {
  name: string;
  name_en: string;
  kind: string;
  lat: number;
  lon: number;
  distance_m: number;
  /** From the map data; empty strings when unknown. */
  phone: string;
  hours: string;
  website: string;
  address: string;
}

export interface PackInfo {
  name: string;
  has_tiles: boolean;
  has_graph: boolean;
  has_places: boolean;
  size_bytes: number;
  bounds: [number, number, number, number] | null;
}

export interface Track {
  id: number;
  name: string;
  started_at: number;
  ended_at: number | null;
  distance_m: number;
  points: number;
}

export interface TrackPoint {
  lat: number;
  lon: number;
  t: number;
  speed: number | null;
  accuracy: number | null;
}

export type Priority = 0 | 1 | 2;
export interface Task {
  id: number;
  title: string;
  notes: string;
  due: string | null; // YYYY-MM-DD
  done: boolean;
  priority: Priority;
  created_at: number;
}
export type TaskInput = Omit<Task, 'id' | 'created_at'> & { id?: number };

export interface Repeat {
  freq: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' | 'interval';
  interval?: number | null;
  /** 0 = Sunday … 6 = Saturday, for weekly. */
  days?: number[] | null;
  until_ms?: number | null;
  count?: number | null;
}

export interface ReminderPlace {
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
}

export interface Reminder {
  id: number;
  title: string;
  notes: string;
  start_ms: number;
  all_day: boolean;
  repeat: Repeat;
  /** Minutes before each occurrence; 0 = at the time. */
  alerts: number[];
  place: ReminderPlace | null;
  task_id: number | null;
  snooze_until: number | null;
  done: boolean;
}
export type ReminderInput = Omit<Reminder, 'id' | 'snooze_until'> & { id?: number };

export interface TransitStop {
  name: string;
  name_en: string;
  lng: number;
  lat: number;
}
export interface TransitLine {
  kind: 'metro' | 'brt';
  ref: string;
  name: string;
  name_en: string;
  colour: string;
  geom: LngLat[][];
  stops: TransitStop[];
}

export interface SavedPlace {
  id: number;
  name: string;
  lat: number;
  lon: number;
  note: string;
}

/** Settings keys and their value types. Secrets are write-only from the UI. */
export interface Settings {
  lang: 'en' | 'fa';
  theme: 'system' | 'light' | 'dark';
  provider_pref: 'auto' | 'offline';
  default_mode: Mode;
  avoid_traffic_zone: boolean;
  avoid_odd_even: boolean;
  has_neshan_service_key: boolean;
  has_neshan_web_key: boolean;
  has_google_key: boolean;
  ringtone: Ringtone;
}
export const RINGTONES = ['emerald', 'pulse', 'bloom', 'marimba', 'beacon'] as const;
export type Ringtone = (typeof RINGTONES)[number] | 'silent';
export type SecretName = 'neshan_service_key' | 'neshan_web_key' | 'google_key';

export const api = {
  packs: () => invoke<PackInfo[]>('packs_list'),
  packDir: () => invoke<string>('packs_dir'),
  packWrite: (file: string, offset: number, data: Uint8Array, done: boolean) =>
    invoke<void>('packs_write', data, {
      headers: { 'x-file': file, 'x-offset': String(offset), 'x-done': done ? '1' : '0' },
    }),
  packDelete: (name: string) => invoke<void>('packs_delete', { name }),
  readRange: (name: string, offset: number, length: number) =>
    invoke<ArrayBuffer>('pack_read_range', { name, offset, length }),

  routeOffline: (mode: Mode, from: LngLat, to: LngLat) => invoke<Route>('route_offline', { mode, from, to }),
  /** The road search, segment by segment in the order it was reached. */
  exploreRoads: async (mode: Mode, from: LngLat, to: LngLat): Promise<{ reached: boolean; lines: Float32Array[] }> => {
    const buf = await invoke<ArrayBuffer>('route_explore', { mode, from, to });
    const v = new DataView(buf);
    const reached = v.getUint8(0) === 1;
    const n = v.getUint32(1, true);
    const lines: Float32Array[] = [];
    let o = 5;
    for (let i = 0; i < n; i++) {
      const c = v.getUint16(o, true);
      o += 2;
      // Copied out: the buffer offset is not 4-byte aligned for a view.
      const line = new Float32Array(c * 2);
      for (let k = 0; k < c * 2; k++) line[k] = v.getFloat32(o + k * 4, true);
      o += c * 8;
      lines.push(line);
    }
    return { reached, lines };
  },
  search: (query: string, near: LngLat | null) => invoke<Hit[]>('search', { query, near }),
  nearby: (kinds: string[], near: LngLat, radiusM: number) => invoke<Hit[]>('nearby', { kinds, near, radiusM }),
  placeAt: (name: string, at: LngLat) => invoke<Hit | null>('place_at', { name, at }),
  roadAt: (at: LngLat) => invoke<{ name: string; name_en: string; distance_m: number } | null>('road_at', { at }),

  settings: () => invoke<Settings>('settings_get'),
  /** Desktop: path of the tone on disk, for the OS notification. */
  soundFile: (name: Exclude<Ringtone, 'silent'>) => invoke<string>('sound_file', { name }),
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) =>
    invoke<void>('settings_set', { key, value: JSON.stringify(value) }),
  setSecret: (name: SecretName, value: string) => invoke<void>('secret_set', { name, value }),
  secret: (name: SecretName) => invoke<string | null>('secret_get', { name }),

  trackStart: (name: string) => invoke<number>('track_start', { name }),
  trackPoint: (id: number, p: TrackPoint) => invoke<void>('track_point', { id, p }),
  trackStop: (id: number) => invoke<Track>('track_stop', { id }),
  tracks: () => invoke<Track[]>('tracks_list'),
  trackPoints: (id: number) => invoke<TrackPoint[]>('track_points', { id }),
  trackDelete: (id: number) => invoke<void>('track_delete', { id }),
  trackGpx: (id: number) => invoke<string>('track_gpx', { id }),

  tasks: () => invoke<Task[]>('tasks_list'),
  taskSave: (task: TaskInput) => invoke<Task>('task_save', { task }),
  taskDelete: (id: number) => invoke<void>('task_delete', { id }),

  reminders: () => invoke<Reminder[]>('reminders_list'),
  reminderSave: (r: ReminderInput) => invoke<Reminder>('reminder_save', { r }),
  reminderDelete: (id: number) => invoke<void>('reminder_delete', { id }),
  reminderSnooze: (id: number, untilMs: number | null) => invoke<void>('reminder_snooze', { id, untilMs }),
  transit: async (): Promise<TransitLine[]> =>
    (await invoke<string[]>('transit_list')).flatMap((doc) => (JSON.parse(doc) as { lines: TransitLine[] }).lines),

  places: () => invoke<SavedPlace[]>('places_list'),
  placeSave: (p: Omit<SavedPlace, 'id'>) => invoke<SavedPlace>('place_save', { p }),
  placeDelete: (id: number) => invoke<void>('place_delete', { id }),
};
