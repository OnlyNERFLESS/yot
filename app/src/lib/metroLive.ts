// The network sweep behind the always-on live trains. The arrivals service
// only answers "next train at this station", so seeing every train means
// asking many stations. This asks about every second station on each covered
// line, one request at a time about a second apart: the same gentle rate the
// station IDs were mapped at. A full pass takes about a minute and repeats
// while the metro screen is open, online and in the foreground. After a run
// of failures it backs off, since the service is unofficial.
import type { Network } from './metro';
import { arrivalsAt, etaIdsFor, type Arrival } from './metroEta';

const GAP_MS = 1100;
const FAILS_BEFORE_PAUSE = 5;
const PAUSE_MS = 3 * 60_000;

/** Stations worth asking: every second stop of each direction, plus its last
 * stop, among those the service knows. Trains run more than two stops apart
 * outside the busiest minutes, so each is next for one of these. */
export function sweepStations(net: Network): number[] {
  const pick = new Set<number>();
  for (const d of net.dirs) {
    d.seq.forEach((id, i) => {
      if (i % 2 === 1 || i === d.seq.length - 1) pick.add(id);
    });
  }
  return [...pick].filter((id) => etaIdsFor(net.stations[id].name).length > 0);
}

/** Sweep until `signal` aborts, reporting each station's arrivals. */
export async function sweep(net: Network, onResult: (station: number, rows: Arrival[], at: number) => void, signal: AbortSignal) {
  const ids = sweepStations(net);
  const wait = (ms: number) => new Promise<void>((r) => {
    const t = window.setTimeout(r, ms);
    signal.addEventListener('abort', () => (window.clearTimeout(t), r()), { once: true });
  });
  let fails = 0;
  while (!signal.aborted && ids.length) {
    for (const id of ids) {
      if (signal.aborted) return;
      const rows = await arrivalsAt(net.stations[id].name, signal).catch(() => null);
      if (signal.aborted) return;
      if (rows) {
        fails = 0;
        onResult(id, rows, Date.now());
      } else if (++fails >= FAILS_BEFORE_PAUSE) {
        fails = 0;
        await wait(PAUSE_MS);
      }
      await wait(GAP_MS);
    }
  }
}
