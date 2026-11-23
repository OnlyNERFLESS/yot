#!/usr/bin/env bash
# Copy offline map packs onto a USB-connected Android phone running a DEBUG
# build of the app (run-as only works for debuggable builds).
#
#   tools/push-packs.sh [pack-dir-on-phone]
#
# The pack folder on the phone is shown in the app under Settings > Offline maps.
# Default matches Tauri's app data dir on Android.
set -euo pipefail
ID=pro.nerfless.toolbox
ADB="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}/platform-tools/adb"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/data/user/0/$ID/packs}"

"$ADB" get-state >/dev/null || { echo "No phone found: enable USB debugging and accept the prompt on the phone."; exit 1; }
"$ADB" shell run-as "$ID" mkdir -p "$DEST"
for f in "$ROOT/packs/tehran.graph" "$ROOT/packs/tehran.places" "$ROOT/maps/data/tehran.pmtiles" "$ROOT/maps/data/iran.pmtiles" "$ROOT/packs/tehran.transit"; do
  name="$(basename "$f")"
  echo "pushing $name ($(du -h "$f" | cut -f1))"
  "$ADB" push "$f" "/data/local/tmp/$name" >/dev/null
  "$ADB" shell run-as "$ID" cp "/data/local/tmp/$name" "$DEST/$name"
  "$ADB" shell rm "/data/local/tmp/$name"
done
"$ADB" shell run-as "$ID" ls -l "$DEST"
echo "Done. Reopen the app's Map tab."
