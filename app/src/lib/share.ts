// Sharing a place the way other map apps do: the system share sheet on
// Android (through the YotShare bridge in MainActivity, because the WebView
// has no navigator.share), the browser's share where it exists, and the
// clipboard as the last resort.
import type { LngLat } from './api';

type Native = { YotShare?: { text(subject: string, body: string): void } };

export type ShareResult = 'shared' | 'copied';

export async function shareText(subject: string, body: string): Promise<ShareResult> {
  const native = (window as unknown as Native).YotShare;
  if (native?.text) {
    native.text(subject, body);
    return 'shared';
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: subject, text: body });
      return 'shared';
    } catch (e) {
      // The person closed the sheet: that is a choice, not a failure.
      if (e instanceof Error && e.name === 'AbortError') return 'shared';
    }
  }
  await navigator.clipboard.writeText(body);
  return 'copied';
}

/** The message a place is shared as: names in both scripts (a driver in Iran
 * reads the Persian one), the address, coordinates and a link that opens in
 * any maps app. */
export function placeMessage(p: { fa?: string; en?: string; line?: string; at: LngLat }): string {
  const [lng, lat] = p.at;
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  return [
    p.fa,
    p.en && p.en !== p.fa ? p.en : '',
    p.line,
    ll,
    `https://maps.google.com/?q=${ll}`,
  ].filter(Boolean).join('\n');
}
