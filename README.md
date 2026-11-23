<p align="center"><img src="app/public/logo.png" width="96" alt="YOT logo"></p>

<h1 align="center">YOT — Your Own Tasks</h1>

<p align="center">An offline-first map, metro, reminder and task app for field work in Tehran.<br>
Android and Windows, English and Persian (RTL), one codebase.</p>

---

## What it does

**Map and navigation**
- Full offline vector map of Tehran, with a light overview of all of Iran underneath that hands over seamlessly at city zoom.
- Offline search over streets, places and stations (English and Persian, tolerant of spelling and digit variants).
- Offline turn-by-turn routing by car and on foot, computed on the device by a Rust A\* router.
- A "finding your route" animation: the router's real search is played back as glowing threads spreading along the actual streets until one reaches the destination, then the chosen route draws itself in.
- Live traffic and traffic-aware routes through Neshan when online; satellite view with an optional Google key.
- Driver view with spoken-style turn instructions and a turn icon set.

**Metro**
- Every Tehran metro line and all 136 stations, drawn over a dimmed city underlay.
- Station browser (A–Z with line chips) and station-to-station trip planning.

**Reminders, calendar and tasks**
- Reminders with repeats (daily, weekly, monthly), multiple alerts, snooze, and place reminders that fire when you arrive.
- Calendar with Gregorian and Jalali (Persian) dates side by side.
- **Quick add**: type a list, one item per line ("Call supplier tomorrow 3pm", "Site visit every Monday 9", "!Pay invoice Friday"), see a live preview, save them all at once. Understands English and Persian dates and times.
- Home screen "today at a glance": day progress, timeline of today's reminders, anytime tasks, and the rest of the week.
- Five built-in notification tones, one Android notification channel each.

**Everywhere**
- Works with no connection: maps, search, routes, metro, reminders and tasks.
- Dark and light themes, emerald on evergreen-black.
- Full Persian translation with right-to-left layout.

## Tech

| Part | Stack |
| --- | --- |
| Shell | [Tauri 2](https://tauri.app) (Windows + Android) |
| UI | React 19, TypeScript, Vite |
| Map | MapLibre GL, PMTiles (Protomaps basemap), Neshan Maps SDK for live data |
| Routing and search | Rust: `crates/geo-core` (graph format, A\*, search, normalisation) |
| Data packer | Rust: `crates/packer` turns an OpenStreetMap `.osm.pbf` into routing, search and transit packs |
| Storage | SQLite (on device) |
| Notifications | `tauri-plugin-notification`, synthesised WAV tones |

```
app/                 React front end (src/) and Tauri shell (src-tauri/)
  src/screens/       Home, Map, Calendar, Tasks, Settings
  src/map/           Map style setup and the route search animation
  src/lib/           API bridge, i18n, Jalali calendar, quick-add parser, reminder engine
  src-tauri/         Rust commands, Android project (gen/android), icons, tones
crates/geo-core/     Offline routing and search library
crates/packer/       OSM -> .graph / .places / .transit
tools/               PMTiles extraction and a debug pack pusher
```

## Getting started

### Requirements
- Node.js 20+ and Rust (stable)
- Windows: WebView2 (preinstalled on Windows 10/11)
- Android: JDK 17, Android SDK and NDK 28 (see the [Tauri Android guide](https://tauri.app/start/prerequisites/))

### Setup
```sh
cp env.example.sh env.sh        # set your JDK / Android SDK paths
cp .env.example .env.local      # add your Neshan keys (optional, for live traffic)
cd app && npm install
```

### Map data
The map packs are not in the repo (they are large and derived from OpenStreetMap). Build them yourself:

```sh
# 1. Vector tiles: cut Tehran (and optionally Iran) out of a Protomaps planet build
python -I tools/pmtiles_extract.py <planet.pmtiles URL> maps/data/tehran.pmtiles <min_lon> <min_lat> <max_lon> <max_lat>
python -I tools/pmtiles_extract.py <planet.pmtiles URL> maps/data/iran.pmtiles 44 25 63.4 39.8 8

# 2. Routing, search and metro packs from an OSM extract (e.g. Geofabrik's Iran file)
cargo run --release -p packer -- maps/data/tehran.osm.pbf packs/tehran <min_lon> <min_lat> <max_lon> <max_lat>
```

Put the files in the app's pack folder (shown under **Settings → Offline maps**), or copy all five into `release-packs/` to bundle them into a release build.

### Run
```sh
. ./env.sh
cd app
npx tauri dev                   # Windows
npx tauri android dev           # Android device or emulator
```

### Release builds
See [DEPLOY.md](DEPLOY.md) for versioning, bundling the maps (`-f bundled-packs`), Android signing and installing on phones.

## Keys

Neshan keys are optional and only needed for live traffic. They are read from `.env.local` at build time and never committed. Anything compiled into an app can be extracted from it, so restrict your keys to your own package name in the Neshan panel.

## Data and attribution

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the Open Database License. Basemap tiles and style by [Protomaps](https://protomaps.com). Live traffic by [Neshan](https://platform.neshan.org).

## License

[MIT](LICENSE) © NERFLESS
