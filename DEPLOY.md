# Deploying YOT

Release builds carry everything an agent needs: the offline maps (Iran overview,
Tehran in full detail), routing, search, the metro network and the Neshan keys.
Nothing has to be configured on the device.

## Before every release

1. Bump the version in **three** places, kept equal:
   `app/package.json`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`.
   Android derives its versionCode from it, and a phone refuses an update whose
   versionCode is not higher.
2. Refresh the data if it changed: copy the five files into `release-packs/`
   (`iran.pmtiles`, `tehran.pmtiles`, `tehran.graph`, `tehran.places`, `tehran.transit`).
   On launch the app replaces any pack whose size differs from the bundled one.
3. Keys come from `.env.local` at build time (`NESHAN_SERVICE_KEY`,
   `NESHAN_WEB_KEY`, optional `GOOGLE_KEY`). Rotate them there and rebuild.
   Anything compiled in can be extracted from the APK, so keep the keys
   restricted to this app (package `pro.nerfless.toolbox`) in the Neshan panel.

## Build

```sh
. ./env.sh   # copy env.example.sh to env.sh first
cd app
# Windows installer -> target/release/bundle/nsis/YOT_<version>_x64-setup.exe
npx tauri build -f bundled-packs
# Android APK (64-bit phones) -> app/src-tauri/gen/android/app/build/outputs/apk/universal/release/
npx tauri android build --apk --target aarch64 -f bundled-packs
```

`-f bundled-packs` is what puts the map data inside the app. Without it the
build is small but empty, which is right for development and wrong for agents.

## Signing (Android)

- Keystore: `keys/yot-release.jks`, alias `yot`. Password and path are in
  `keys/keystore.properties`, copied to `app/src-tauri/gen/android/keystore.properties`.
- **Back up both files somewhere safe and private.** Every future update must
  be signed with this same key; if it is lost, installed copies can never be
  updated and every agent has to uninstall and reinstall.
- Neither file is committed (`.gitignore`).

## Installing on agents' phones

Send the APK file (messaging app, email, USB). On the phone: open it, allow
"install unknown apps" for the app it was opened from when asked, install.
On first launch YOT unpacks its maps (a few seconds), then asks for location
and notification permission. Both are needed: location for the blue dot,
navigation and place reminders; notifications for reminders.

## What still needs the internet

Live traffic and traffic-aware routes (Neshan) and satellite view (Google,
only with a Google key). Maps, search, offline routes, metro, reminders and
tasks all work with no connection.

## Publishing a release (and how apps update)

Installed copies check `https://api.github.com/repos/OnlyNERFLESS/yot/releases/latest`
on launch and offer anything newer. Windows downloads `*-setup.exe` and installs
it in place (`/P /R /UPDATE`); Android opens `*.apk` in the browser.

1. Bump the version (above) and build both.
2. Create a GitHub release tagged `v<version>` with bullet-point notes; the
   bullets become the "What's new" list in the update popup.
3. Attach the files with these exact names, so the README links and the
   update check always find them: `YOT-android.apk`, `YOT-windows-setup.exe`,
   `YOT-all.zip`, plus `SHA256SUMS.txt`.

Copies older than 1.0.1 have no update check and must be updated by hand once.
