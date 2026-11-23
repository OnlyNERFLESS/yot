# Product


## Platform

web

(One React UI in a Tauri 2 WebView, shipped as an Android APK and a Windows app. It has its own design language; it is not native Material or Fluent.)

## Users

- **Primary: field agents** of a company, travelling to Iran (mostly Tehran) for work. They read English first, struggle with local Iranian apps, and work in cars, taxis and on foot, often with poor or no internet.
- **Secondary: the owner**, on the Windows desktop, planning trips and managing the app's keys, maps and data.

## Product Purpose

**YOT (Your Own Tasks)**: one dependable app that gets an agent around Tehran and keeps their day's work in order, without relying on local apps or a constant connection.

Success: an agent can find a place, get a route and arrival time, follow turn-by-turn directions, record where they went, and track their tasks, all in English and with no internet if necessary.

## Positioning

Offline-first by design. The full Greater Tehran map, routing (car, motorcycle, walking), search in English and Persian, navigation, trip recording and tasks all run on the device. Live traffic is an optional extra: Neshan inside Iran, Google elsewhere. Local apps are Persian-only or depend on a connection; global apps (Google Maps) do not work for phones on Iranian networks.

## Operating Context

- Used in moving cars and taxis, in daylight, often one-handed; glanceable navigation matters more than dense information.
- Internet in Iran is slow, filtered or cut; the app must never look broken when offline.
- Agents show Persian street names and addresses to drivers and locals, so Persian names stay visible beside English.
- Distributed as a direct APK install, not through an app store.

## Capabilities and Constraints

- Screens: Home (dashboard), Map (search, route options, turn-by-turn navigation, traffic layer, trip recording, saved places), Tasks, Settings (panel: language, theme, routing source, API keys, offline maps, trips, saved places).
- Bilingual: English (default) and Persian with full right-to-left layout and Persian digits. Light and dark themes.
- Performance and size are hard constraints: small installer, fast start, 60 fps map, no heavy assets.
- Live traffic costs money per use (Neshan in Iran, Google outside); the free offline mode must always be complete on its own.
- Android 7+ phones of all sizes, plus Windows desktop.

## Brand Commitments

- Name: **YOT**, expanded as "Your Own Tasks".
- Carries the **DigiDev** (digidev.pro) brand. The DigiDev brand as implemented in `digidev-web`: emerald/malachite (`#16db65`) on near-black (`#020202`, evergreen grounds `#050f09`–`#0d2818`); in light mode the accent deepens to sea-green `#058c42` / black-forest `#04471c`. Type: Bricolage Grotesque (display), Inter (body), JetBrains Mono (machine-shaped text). Mark: the DigiDev favicon (white letter with an emerald dot on a near-black rounded square).

## Evidence on Hand

- Real data: Greater Tehran OpenStreetMap packs (143k searchable places and streets, 393k road segments), tested routes and Neshan live-traffic results.
- No users, testimonials, or usage numbers exist yet; none should be implied.

## Product Principles

1. **Works with nothing.** Every core job completes offline; online only adds live traffic.
2. **Glance, don't read.** In motion, the next action and the time left must be readable in under a second.
3. **Two scripts, one place.** English for the agent, Persian beside it for the people they ask.
4. **Light on the phone.** Every megabyte and millisecond is justified.
5. **Honest about money.** Paid features are visible and optional; the free path is never degraded to push them.

## Accessibility & Inclusion

- Large touch targets for use in vehicles; legible in direct sunlight (strong contrast in both themes).
- Full RTL correctness in Persian; WCAG AA contrast for all text.
