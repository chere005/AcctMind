#!/bin/sh
# The platforms this repo ships that deploy.sh does not: the macOS desktop
# bundle, an iOS build installed on the connected iPhone, and an Android build
# on an emulator. Windows is CI's (.github/workflows/desktop-windows.yml) —
# Tauri does not cross-compile.
#
#   sh tools/build-platforms.sh              all three
#   sh tools/build-platforms.sh --mac        just the desktop bundle
#   sh tools/build-platforms.sh --ios        just the phone
#   sh tools/build-platforms.sh --android    just the emulator
#   sh tools/build-platforms.sh --dry-run    print the plan
#
# Flags compose, and naming none means all three — the same positive selection
# CoreMind's script uses, because zeroing the OTHERS per flag does not compose
# past two.
#
# WHY THIS LIVES HERE. Until 2026-08-23 these three builds lived only in
# CoreMind's shared bin/build-platforms.sh (its AcctMind row: apps/app,
# @acctmind/desktop, iOS installs to the phone), so this repo's own lane
# shipped the web, dispatched Windows CI, and stopped — a release could tag
# and push with the Mac bundle still built from whatever was last lying
# around. ChefMind's did exactly that, and the fix is suite-wide on Sean's
# word (2026-08-23): "all apps should have a deploy on their own mechanism
# inside their repo". So the machinery is HERE, the dtp lane runs it, and
# CoreMind orchestrates ACROSS apps by calling each app's own lane rather
# than reaching into it.
#
# This is a copy-down, like packages/core — CoreMind's script is the origin
# and its comments are the record of what each line cost to learn. Keep them.
set -e
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
APPDIR="apps/app"
DESKTOP_WS="@acctmind/desktop"

# ------------------------------------------------------------------- argv
DRY=0; PICKED=0; WANT_MAC=0; WANT_IOS=0; WANT_ANDROID=0
while [ $# -gt 0 ]; do
  case "$1" in
    --mac)        WANT_MAC=1;     PICKED=1 ;;
    --ios)        WANT_IOS=1;     PICKED=1 ;;
    --android)    WANT_ANDROID=1; PICKED=1 ;;
    --dry-run)    DRY=1 ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done
[ "$PICKED" = 1 ] || { WANT_MAC=1; WANT_IOS=1; WANT_ANDROID=1; }

# Xcode derivedData and gradle's home stay on the INTERNAL disk, deliberately.
# A scratch volume mounted exFAT was tried on 2026-08-22 and reverted: exFAT
# cannot store the extended attributes codesign needs, so any signed product
# gets a "._<name>" AppleDouble sidecar that codesign then tries to sign as a
# subcomponent and fails on. The same root cause broke gradle's cache there in
# the same session. Large and untracked is a real cost; it has to be paid.
BUILD_SCRATCH="$ROOT/$APPDIR/ios"

if [ "$DRY" = 1 ]; then
  [ "$WANT_MAC" = 1 ]     && echo "would: clean export:web, npm -w $DESKTOP_WS run build, then install to /Applications"
  [ "$WANT_IOS" = 1 ]     && echo "would: prebuild $APPDIR (ios), test:version:device, xcodebuild Release, devicectl install"
  [ "$WANT_ANDROID" = 1 ] && echo "would: prebuild $APPDIR (android), gradlew assembleRelease, adb install"
  exit 0
fi

# The export the desktop shell stages: a CLEAN one, through export:web.
#
# export:web is the export PLUS tools/patch-web-html.mjs — the head patch and
# the build stamp. A bare `expo export` ships an index.html that renders a
# white strip above a dark app and carries no build.json, and the shell's own
# stage-dist.sh refuses a dist without the stamp — the README's "Nothing
# should call it directly" is enforced, not advisory. The desktop build then
# stages the export UNDER /AcctMind (desktop/stage-dist.sh says why: the base
# path is baked into the JS, so the window opens the path the export was
# built for and not one byte differs from what the website serves).
#
# CLEAN because `expo export` does not empty the directory, so a dist left by
# deploy.sh (or by a previous run of this) would be copied along with whatever
# else is in it. The export is deterministic — the same source produces the
# same content-hashed bundle name — which is what makes it possible to check a
# .app against the live site at all, and it costs about thirty seconds.
ensure_dist() {
  rm -rf "$ROOT/$APPDIR/dist"
  npm run -s export:web >/dev/null || { echo "the web export failed" >&2; return 1; }
}

# --------------------------------------------------------------- the iOS project
IOS_WS=""
prebuild_ios() {
  [ -n "$IOS_WS" ] && return 0
  IOS_WS=$(ls -d "$ROOT/$APPDIR"/ios/*.xcworkspace 2>/dev/null | head -1)
  [ -n "$IOS_WS" ] && return 0
  # LANG is not optional: CocoaPods dies in unicode_normalize without a UTF-8
  # locale, naming nothing useful (AGENTS.md — every script here that runs
  # pod install exports it).
  ( cd "$ROOT/$APPDIR" && LANG=en_US.UTF-8 npx expo prebuild --platform ios --clean ) \
    || { echo "prebuild failed" >&2; return 1; }
  IOS_WS=$(ls -d "$ROOT/$APPDIR"/ios/*.xcworkspace 2>/dev/null | head -1)
  [ -n "$IOS_WS" ] || { echo "prebuild produced no xcworkspace" >&2; return 1; }
}

# ------------------------------------------------------------------- macOS
if [ "$WANT_MAC" = 1 ]; then
  echo "==> macOS desktop bundle"
  ensure_dist || exit 1
  ( cd "$ROOT" && npm -w "$DESKTOP_WS" run build ) \
    || { echo "the macOS bundle failed to build" >&2; exit 1; }
  # The .app is the shipped artifact — no dmg in bundle.targets, because
  # create-dmg needs Finder/AppleScript and dies on this machine AFTER a
  # perfectly good bundle (AGENTS.md, "tauri.conf.json takes no notes").
  APPBUNDLE=$(ls -d "$ROOT"/desktop/src-tauri/target/release/bundle/macos/*.app 2>/dev/null | head -1)
  [ -n "$APPBUNDLE" ] || { echo "the build reported success and produced no .app" >&2; exit 1; }
  echo "    $APPBUNDLE"
  if [ -f "$ROOT/desktop/smoke.sh" ]; then
    ( cd "$ROOT" && sh desktop/smoke.sh ) || { echo "the macOS smoke failed" >&2; exit 1; }
  fi
  # INSTALL IT, and verify the copy landed. A build sitting in
  # target/release/bundle/macos/ is not a deploy — it is the thing nobody
  # looks at while the app in /Applications goes stale. The verify step was
  # missing everywhere until 2026-08-22, so every app's macOS build had
  # succeeded and none of them was installed (AGENTS.md).
  rm -rf "/Applications/$(basename "$APPBUNDLE")"
  cp -R "$APPBUNDLE" /Applications/ \
    || { echo "copying the .app into /Applications failed" >&2; exit 1; }
  INSTALLED="/Applications/$(basename "$APPBUNDLE")"
  [ -d "$INSTALLED" ] || { echo "copy reported success but $INSTALLED is not there" >&2; exit 1; }
  echo "    installed: $INSTALLED"
fi

# --------------------------------------------------------------------- iOS
if [ "$WANT_IOS" = 1 ]; then
  echo "==> iOS"
  DEVJSON=$(mktemp -t acctmind-devices)
  xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 \
    || { echo "devicectl cannot list devices — is Xcode installed?" >&2; exit 1; }
  # The UDID, not the CoreDevice identifier: xcodebuild's -destination matches
  # a physical device by UDID, and handing it the other one finds nothing.
  # WHICH PHONE, when more than one is paired. Requiring EXACTLY one made a
  # second paired handset refuse every install on this machine — three releases
  # in a row reported "no single reachable iPhone" with the right phone sitting
  # there the whole time (2026-08-23). One device is used as before; several are
  # disambiguated by NAME, defaulting to Sean's. An ambiguous set still fails,
  # and now says what it saw.
  UDID=$(IOS_DEVICE="${IOS_DEVICE:-iPhoooooone}" python3 - "$DEVJSON" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
import os
avail = [(x.get('deviceProperties', {}).get('name', '?'), x['hardwareProperties']['udid'])
         for x in d.get('result', {}).get('devices', [])
         if x.get('hardwareProperties', {}).get('platform') == 'iOS'
         and x.get('connectionProperties', {}).get('tunnelState') in ('connected', 'available')
         and x.get('hardwareProperties', {}).get('udid')]
want = os.environ.get('IOS_DEVICE', '')
named = [u for n, u in avail if n == want]
if len(avail) == 1:
    print(avail[0][1])
elif len(named) == 1:
    print(named[0])
else:
    for n, _ in avail:
        print('    seen: ' + n, file=sys.stderr)
    print('')
PY
)
  rm -f "$DEVJSON"
  # The phone holds 3 apps at a time on the free team: CalMind, ChefMind,
  # AcctMind. Nothing here frees a slot — it installs over this app's own.
  [ -n "$UDID" ] || {
    echo "no usable iPhone: none reachable, or several and none named '${IOS_DEVICE:-iPhoooooone}'" >&2
    echo "  Plug one in, or name it:  IOS_DEVICE='Some iPhone' sh tools/build-platforms.sh --ios" >&2
    exit 1
  }
  echo "    device: $UDID"

  prebuild_ios || exit 1

  # THE PLIST, checked here because here is where it means something. It goes
  # stale the moment a version bumps and only refreshes on a prebuild — the
  # ORDINARY state between a release and the next device build — so `npm test`
  # runs --sources-only and THIS is the one moment the full check must hold
  # (AGENTS.md, "Versions and builds": bump the config, build without
  # prebuilding, and the phone carries the old number while three source
  # files agree with each other).
  #
  # A stale plist gets ONE regeneration, not a refusal: prebuild_ios skips
  # the prebuild when a workspace already exists, and right after a dtp
  # bumped the version that existing output is stale by definition — the
  # lane would otherwise refuse every first device build of a release. A
  # SECOND disagreement is a real bug and stops the install.
  if ! ( cd "$ROOT" && npm run -s test:version:device ); then
    echo "    the existing prebuild output is stale — regenerating"
    ( cd "$ROOT/$APPDIR" && LANG=en_US.UTF-8 npx expo prebuild --platform ios --clean ) \
      || { echo "prebuild failed" >&2; exit 1; }
    IOS_WS=$(ls -d "$ROOT/$APPDIR"/ios/*.xcworkspace 2>/dev/null | head -1)
    [ -n "$IOS_WS" ] || { echo "prebuild produced no xcworkspace" >&2; exit 1; }
    ( cd "$ROOT" && npm run -s test:version:device ) \
      || { echo "a FRESH prebuild still disagrees with the version — not installing" >&2; exit 1; }
  fi

  SCHEME=$(basename "$IOS_WS" .xcworkspace)
  DERIVED="$BUILD_SCRATCH/derived-platforms"
  echo "    workspace: $(basename "$IOS_WS")  scheme: $SCHEME"

  LOG=$(mktemp -t acctmind-ios)
  # -destination with a SPECIFIC device, never -sdk: -sdk overrides SDKROOT
  # for every target in the scheme — and the generic destination once compiled
  # this repo's watch target against the iOS SDK and produced two convincing
  # errors in correct files (AGENTS.md).
  if ! xcodebuild -workspace "$IOS_WS" -scheme "$SCHEME" -configuration Release \
      -destination "platform=iOS,id=$UDID" -derivedDataPath "$DERIVED" \
      -allowProvisioningUpdates build >"$LOG" 2>&1; then
    echo "the iOS build failed — last lines:" >&2
    tail -25 "$LOG" >&2; echo "full log: $LOG" >&2; exit 1
  fi
  rm -f "$LOG"

  BUNDLE="$DERIVED/Build/Products/Release-iphoneos/$SCHEME.app"
  [ -d "$BUNDLE" ] || { echo "the build succeeded and produced no $SCHEME.app" >&2; exit 1; }
  # devicectl installs onto a LOCKED phone; only launching needs it awake
  # (AGENTS.md — `expo run:ios --device` hangs on exactly this).
  xcrun devicectl device install app --device "$UDID" "$BUNDLE" \
    || { echo "the install failed — is the phone paired with this Mac?" >&2; exit 1; }
  echo "    installed $SCHEME.app"
  # No watch branch: the watch is out, for now (AGENTS.md) — the target,
  # the bridge module and core's watch.ts were removed on Sean's 2026-08-21
  # word, so there is nothing to install to a paired watch.
fi

# ----------------------------------------------------------------- Android
if [ "$WANT_ANDROID" = 1 ]; then
  echo "==> Android"
  # ANDROID_HOME exported, not assumed: `expo run:android` sets it, a bare
  # ./gradlew does not, and the failure ("SDK location not found") reads like
  # a broken project rather than a missing variable (README).
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export ANDROID_SDK_ROOT="$ANDROID_HOME"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
  [ -d "$ANDROID_HOME" ] || { echo "no Android SDK at \$ANDROID_HOME ($ANDROID_HOME)" >&2; exit 1; }
  command -v adb >/dev/null || { echo "adb not on PATH under \$ANDROID_HOME" >&2; exit 1; }

  # A device already reachable — real hardware or an emulator someone left
  # running — wins outright; nothing here boots a second one on top of it.
  SERIAL=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
  if [ -z "$SERIAL" ]; then
    AVD="${ANDROID_AVD:-}"
    if [ -z "$AVD" ]; then
      # `avdmanager` reports a system image as installed from its OWN
      # metadata, which can be stale — one on this machine names a directory
      # that does not exist. Each candidate is checked on DISK.
      for CAND in $(emulator -list-avds 2>/dev/null); do
        IMG=$(sed -n 's/^image\.sysdir\.1=//p' "$HOME/.android/avd/$CAND.avd/config.ini" 2>/dev/null)
        if [ -n "$IMG" ] && [ -d "$ANDROID_HOME/$IMG" ]; then AVD="$CAND"; break; fi
      done
    fi
    [ -n "$AVD" ] || { echo "no Android emulator running and no bootable AVD found" >&2; exit 1; }
    echo "    booting $AVD"
    nohup emulator -avd "$AVD" -no-snapshot-load -no-boot-anim -netdelay none -netspeed full \
      >"/tmp/acctmind-emulator-$AVD.log" 2>&1 &
    disown 2>/dev/null || true
    i=0
    while [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]; do
      sleep 5; i=$((i + 1))
      [ "$i" -le 72 ] || { echo "$AVD did not finish booting within 6 minutes" >&2; exit 1; }
    done
    SERIAL=$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')
    [ -n "$SERIAL" ] || { echo "$AVD booted but adb sees no device" >&2; exit 1; }
  fi
  echo "    device: $SERIAL"

  ( cd "$ROOT/$APPDIR" && LANG=en_US.UTF-8 npx expo prebuild --platform android --clean ) \
    || { echo "android prebuild failed" >&2; exit 1; }

  # assembleRelease, not debug: gradle here signs BOTH build types with the
  # auto-generated debug keystore (there is no release keystore in the suite),
  # so release installs exactly as easily and is what a real release uses.
  # A build killed by a full disk leaves a Gradle LOCK behind and the next run
  # fails in under a second — `./gradlew --stop` and remove
  # apps/app/android/.gradle.
  ( cd "$ROOT/$APPDIR/android" && ANDROID_HOME="$ANDROID_HOME" ./gradlew assembleRelease ) \
    || { echo "the Android build failed" >&2; exit 1; }

  APK=$(find "$ROOT/$APPDIR/android/app/build/outputs/apk" -name "*.apk" 2>/dev/null | head -1)
  [ -n "$APK" ] || { echo "the Android build produced no APK" >&2; exit 1; }

  # Package and launch activity read OFF THE BUILT APK via aapt, not guessed
  # from app.config.js — the source of truth for what just got built.
  AAPT=$(ls "$ANDROID_HOME"/build-tools/*/aapt 2>/dev/null | sort -V | tail -1)
  [ -n "$AAPT" ] || { echo "no aapt under \$ANDROID_HOME/build-tools" >&2; exit 1; }
  BADGING=$("$AAPT" dump badging "$APK")
  PKG=$(printf '%s\n' "$BADGING" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
  ACTIVITY=$(printf '%s\n' "$BADGING" | sed -n "s/^launchable-activity: name='\([^']*\)'.*/\1/p")
  [ -n "$PKG" ] && [ -n "$ACTIVITY" ] \
    || { echo "could not read package/activity from the built APK" >&2; exit 1; }

  adb -s "$SERIAL" install -r "$APK" || { echo "adb install failed" >&2; exit 1; }
  adb -s "$SERIAL" shell am start -n "$PKG/$ACTIVITY" >/dev/null \
    || { echo "the app installed but would not launch" >&2; exit 1; }
  # Polled, not one sleep-then-check: a cold RN launch loads a dozen native
  # libraries before the process is fully up, and 5 seconds flat once reported
  # "not running" for a process ps showed alive a moment later.
  RUNNING=0
  for _ in 1 2 3 4 5 6; do
    if adb -s "$SERIAL" shell "ps -A" 2>/dev/null | grep -q "$PKG"; then RUNNING=1; break; fi
    sleep 3
  done
  [ "$RUNNING" = 1 ] || { echo "installed and launched but never showed up running" >&2; exit 1; }
  echo "    installed and running: $PKG on $SERIAL"
fi
