// Updates come from this project's GitHub releases. The app asks for the
// latest release, compares versions, and offers the right file for the device:
// Windows downloads and runs the installer itself (update_install), Android
// hands the APK to the browser, because only an app store may update silently.
import { getVersion } from '@tauri-apps/api/app';
import { openUrl } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { isMobile } from './location';

const LATEST = 'https://api.github.com/repos/OnlyNERFLESS/yot/releases/latest';
const SKIP_KEY = 'yot.update.skip';

export interface Update {
  current: string;
  version: string;
  notes: string[];
  /** The installer for this device, or null if the release has none. */
  file: string | null;
}

/** 1.2.10 > 1.2.9; anything after a hyphen is ignored. */
export function isNewer(a: string, b: string): boolean {
  const p = (v: string) => v.replace(/^v/, '').split('-')[0].split('.').map((n) => Number(n) || 0);
  const [x, y] = [p(a), p(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

interface GhRelease {
  tag_name: string;
  body: string | null;
  assets: { name: string; browser_download_url: string }[];
}

/** The newer release, or null when this copy is current. Throws when offline. */
export async function findUpdate(): Promise<Update | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 10_000);
  try {
    const [current, res] = await Promise.all([
      getVersion(),
      fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal }),
    ]);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const r = (await res.json()) as GhRelease;
    const version = r.tag_name.replace(/^v/, '');
    if (!isNewer(version, current)) return null;
    const want = isMobile ? (n: string) => n.endsWith('.apk') : (n: string) => n.endsWith('-setup.exe');
    // The release's bullet points, minus markdown, are the "what's new" list.
    const notes = (r.body ?? '')
      .split(/\r?\n/)
      .filter((l) => /^\s*[-*] /.test(l))
      .map((l) => l.replace(/^\s*[-*] /, '').replace(/[*_`]/g, '').trim())
      .slice(0, 6);
    return { current, version, notes, file: r.assets.find((a) => want(a.name))?.browser_download_url ?? null };
  } finally {
    window.clearTimeout(timer);
  }
}

export const skippedVersion = () => localStorage.getItem(SKIP_KEY);
export const skipVersion = (v: string) => localStorage.setItem(SKIP_KEY, v);

/**
 * Windows: resolves only if something went wrong, because on success the
 * installer closes this app. Android: opens the download in the browser.
 */
export async function installUpdate(u: Update): Promise<void> {
  if (!u.file) throw new Error('This release has no installer for this device');
  if (isMobile) await openUrl(u.file);
  else await invoke('update_install', { url: u.file });
}
