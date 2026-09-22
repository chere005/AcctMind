#!/bin/sh
# The platforms this repo ships that deploy.sh does not: the macOS desktop
# bundle, an iOS build installed on every phone this app belongs on, and an
# Android build on an emulator. Windows is CI's
# (.github/workflows/desktop-windows.yml) — Tauri does not cross-compile.
#
#   sh tools/build-platforms.sh              all three
#   sh tools/build-platforms.sh --mac        just the desktop bundle
#   sh tools/build-platforms.sh --ios        just the phones
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
  [ "$WANT_IOS" = 1 ]     && echo "would: prebuild $APPDIR (ios), test:version:device, xcodebuild Release once, devicectl install to every phone on this app's list"
  [ "$WANT_ANDROID" = 1 ] && echo "would: prebuild $APPDIR (android), gradlew assembleRelease, adb install"
  exit 0
fi

# The export the desktop shell stages: a CLEAN one, through export:web.
#
# export:web is the export PLUS tools/patch-web-html.mjs — the head patch and
# the build stamp. A bare `expo export` ships an index.html that renders a
# white strip above a dark app and carries no build.json, and the shell's own
# stage-dist.sh refuses a dist without the stamp — ARCHITECTURE.md's "Nothing
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
  # IS IT OPEN RIGHT NOW? Asked BEFORE the rm -rf, because the answer stops
  # being knowable the moment the bundle it names is gone.
  #
  # An `rm -rf` and `cp -R` UNDER a running app change nothing the person is
  # looking at: macOS still has the old code mapped, the window keeps the JS
  # it launched with, and the release looks like it did nothing. That is how
  # Sean spent an afternoon on 2026-09-21 reading an old AcctMind while that
  # same build was live on the web, on his phone and in /Applications —
  # "make sure to reopen already opened apps in a dtp.. i was looking at an
  # old acctmind".
  #
  # MATCHED ON THE BUNDLE PATH, never on the app's name. The executable
  # inside AcctMind.app is Contents/MacOS/acctmind-desktop, so `pgrep -x
  # AcctMind` finds nothing and this whole step would silently no-op. The
  # name is derived from $APPBUNDLE, the same variable the install below
  # uses, so the two can never disagree about which app this is.
  APPNAME=$(basename "$APPBUNDLE" .app)
  WAS_RUNNING=0
  GONE=1
  if pgrep -f "/Applications/$APPNAME.app/Contents/MacOS/" >/dev/null 2>&1; then
    WAS_RUNNING=1
    # ASKED TO QUIT, never killed. `osascript -e 'quit app "..."'` is the
    # gesture the suite's macOS smokes use on an app they did not start
    # (CalMind/desktop/smoke.sh) — and it is a request, not an order: the app
    # holds the only copy of whatever is unsaved in that window ("the device
    # is the only copy"), so a release has no business destroying it and
    # nothing here escalates to kill -9. This repo's own desktop/smoke.sh
    # `kill`s a pid instead, which is a different situation and not a
    # precedent: that process is a child the smoke launched itself, and this
    # one is Sean's session.
    echo "    $APPNAME is open — quitting it so the new bundle is what you see"
    osascript -e "quit app \"$APPNAME\"" >/dev/null 2>&1 || true
    # Waited out, because copying over a LIVE bundle is the other half of
    # what this is avoiding. Whether it actually went is remembered, not
    # assumed: the reopen below tells the truth with it.
    GONE=0
    for _ in 1 2 3 4 5 6; do
      pgrep -f "/Applications/$APPNAME.app/Contents/MacOS/" >/dev/null 2>&1 || { GONE=1; break; }
      sleep 1
    done
    # Still there after a few seconds: say so and carry on with the install
    # anyway. A stale window is a smaller problem than a skipped deploy.
    [ "$GONE" = 1 ] || echo "WARNING: $APPNAME would not quit — installing under it anyway" >&2
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
  # PUT HIS SESSION BACK — and ONLY if there was one. An app that was closed
  # when the lane started stays closed: a release must not start conjuring
  # windows onto his desktop.
  #
  # Best-effort, like the quit above. Every step of this reopen dance leaves
  # the exit status alone, because a window that failed to come back must
  # never turn a shipped release into a failed lane.
  if [ "$WAS_RUNNING" = 1 ] && [ "$GONE" = 1 ]; then
    if open "$INSTALLED" >/dev/null 2>&1; then
      echo "    reopened: $APPNAME — it was open before this ran"
    else
      echo "WARNING: $APPNAME was open before this ran and would not reopen" >&2
    fi
  elif [ "$WAS_RUNNING" = 1 ]; then
    # It refused to quit, so the process still on screen is the one macOS
    # mapped BEFORE the copy. `open` would only bring that stale window
    # forward while the lane log called it "reopened" — which is this bug
    # again, now with a reassuring line printed over it. Say what is true.
    echo "WARNING: $APPNAME never quit — the window on screen is the build from BEFORE this install; quit and reopen it to see this one" >&2
  fi
fi

# --------------------------------------------------------------------- iOS
if [ "$WANT_IOS" = 1 ]; then
  echo "==> iOS"

  # THE PHONES THIS APP BELONGS ON. A release is not "install to the phone",
  # and it is not "install to whatever is plugged in" either: every app in
  # the suite has a SET of handsets it lives on, and that set is a fact about
  # the app rather than about the state of the USB port. Sean, 2026-09-21,
  # after a release reached one phone and stopped — "you should have dtp to
  # all platforms and all 3 phones and my watch", then the routing itself, in
  # the same breath: "the only apps installed on autumn's phone are ChefMind
  # and CalMind", "patricia's phone only gets CalMind", "my phone gets all 6
  # (including the test ones)". The ledger is one of those six and lives on
  # Sean's phone alone, which is why there is one line below and not three;
  # another app's list is a different list, and neither is "all of them".
  #
  # BY UDID, NEVER BY NAME. Two of the three names in the suite carry an
  # apostrophe and one of those is a CURLY one (U+2018) — the sort of
  # character that compares equal to the one you typed in a test written on
  # this machine and then does not on the day, because a shell, an editor or
  # a rename quietly swapped it for the straight one. devicectl and the
  # provisioning profile both speak udid. The text after the '#' is for the
  # person reading this file, and for the line printed about a phone that is
  # absent and so has no name for devicectl to report.
  #
  # IOS_PHONES in the environment replaces this list outright, and it is read
  # by plain WORD splitting: `IOS_PHONES='<udid> <udid>'` on one command line
  # means exactly what several lines mean. A reader that took only the FIRST
  # udid on each line would accept that override without a word and then ship
  # to one phone — the precise failure this list exists to prevent — and
  # CalMind and ChefMind both print that space-separated form in their own
  # error messages, so a command copied from one repo to another has to mean
  # the same thing here.
  IOS_PHONES="${IOS_PHONES:-
    00008130-000E3D060E20001C  # iPhoooooone (Sean)
  }"

  DEVJSON=$(mktemp -t acctmind-devices)
  xcrun devicectl list devices --json-output "$DEVJSON" >/dev/null 2>&1 \
    || { echo "devicectl cannot list devices — is Xcode installed?" >&2; exit 1; }

  # Which of those phones are actually here, in the order the list names
  # them. Requiring EXACTLY ONE reachable handset is what this step used to
  # do, and a second paired phone on this machine then made it refuse every
  # install — three releases in a row reported "no single reachable iPhone"
  # with the right phone sitting there the whole time (2026-08-23). The
  # declared list settles that question: what is plugged in decides how MANY
  # phones a release reaches, never WHICH ones it was meant for.
  #
  # IOS_DEVICE still wins, and still matches by NAME, because it is typed by
  # someone looking at a phone rather than at a udid. It narrows the run to
  # that one handset: the way to aim a first build at a phone the team has
  # never seen, and the way to put a build somewhere that is not on the list
  # at all without editing this file.
  PLAN=$(mktemp -t acctmind-phones)
  if ! IOS_PHONES="$IOS_PHONES" IOS_DEVICE="${IOS_DEVICE:-}" \
      python3 - "$DEVJSON" >"$PLAN" <<'PY'
import json, os, sys

# Comments off each line first, then WORD splitting. The list below carries
# one phone and its name per line, but an override typed at a prompt carries
# several udids on the one line, and keeping only the first would silently
# narrow a release instead of refusing it. A name belongs to its own line, so
# it is only worn by a line that named a single phone.
wanted = []
for raw in os.environ.get('IOS_PHONES', '').splitlines():
    body, _, name = raw.partition('#')
    udids = body.split()
    name = name.strip()
    for u in udids:
        wanted.append((u, name if name and len(udids) == 1 else u))
if not wanted:
    print('IOS_PHONES names no phone', file=sys.stderr)
    raise SystemExit(1)

d = json.load(open(sys.argv[1]))
# tunnelState: a paired phone that is merely idle lists as 'disconnected'
# until something warms the tunnel, so excluding it skipped the iOS step of
# CalMind 1.17.0 with the phone sitting right there (2026-08-30). Only
# 'unavailable' is a genuinely absent device — the second paired handset
# proves it.
seen = {}
for x in d.get('result', {}).get('devices', []):
    hw = x.get('hardwareProperties', {})
    if (hw.get('platform') == 'iOS' and hw.get('udid')
            and x.get('connectionProperties', {}).get('tunnelState')
            in ('connected', 'available', 'disconnected')):
        seen[hw['udid']] = x.get('deviceProperties', {}).get('name') or '?'

want = os.environ.get('IOS_DEVICE', '').strip()
if want:
    named = [(u, n) for u, n in seen.items() if n == want]
    if len(named) != 1:
        print("no single reachable iPhone is named '%s'" % want, file=sys.stderr)
        for u, n in sorted(seen.items(), key=lambda t: t[1]):
            print('    seen: ' + n, file=sys.stderr)
        raise SystemExit(1)
    wanted = named

for udid, name in wanted:
    print('%s %s %s' % ('ok' if udid in seen else 'miss', udid, seen.get(udid, name)))
PY
  then
    echo "  Plug a phone in, or name one:" >&2
    echo "    IOS_DEVICE='Some iPhone' sh tools/build-platforms.sh --ios" >&2
    echo "    IOS_PHONES='<udid> <udid>' sh tools/build-platforms.sh --ios" >&2
    rm -f "$DEVJSON" "$PLAN"; exit 1
  fi
  rm -f "$DEVJSON"

  # A phone on the list that devicectl does not mention at all is SKIPPED,
  # out loud. It is switched off or off the network, which is an ordinary
  # Tuesday and not a broken release.
  UDID=""; UDID_NAME=""
  while read -r TAG U NAME; do
    case "$TAG" in
      ok)   [ -n "$UDID" ] || { UDID="$U"; UDID_NAME="$NAME"; } ;;
      miss) echo "    skipped $NAME — devicectl does not see it" ;;
    esac
  done < "$PLAN"
  [ -n "$UDID" ] || {
    echo "not one of this app's phones is reachable — nothing to build against" >&2
    echo "  Plug one in, or name one:  IOS_DEVICE='Some iPhone' sh tools/build-platforms.sh --ios" >&2
    echo "  or aim the run elsewhere:  IOS_PHONES='<udid> <udid>' sh tools/build-platforms.sh --ios" >&2
    rm -f "$PLAN"; exit 1
  }
  # ONE BUILD, aimed at the FIRST phone that answered. The .app is signed
  # for the TEAM and not for a handset, so the same bundle installs on every
  # phone on the list; building once per phone would spend minutes each time
  # producing the same binary again.
  echo "    building on: $UDID_NAME ($UDID)"

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

  # NOW PUT THAT ONE BUNDLE ON EVERY PHONE THAT ANSWERED.
  #
  # devicectl installs onto a LOCKED phone; only launching needs it awake
  # (AGENTS.md — `expo run:ios --device` hangs on exactly this).
  #
  # There is no per-phone app cap to spend, and any sum in here that says
  # otherwise is out of date: this block used to ration installs against
  # Apple's free-tier limit of three apps per device, naming the three it
  # thought the phone could hold. The team this signs with, 2LGYTL3FSJ
  # ("Sean Cheren"), is PAID — the Xcode-managed profile it issues carries
  # TimeToLive 365 where a personal team's carries 7 — so the limit is not
  # this account's and nothing here counts apps. Sean, 2026-09-21: "no more
  # caps per phone."
  #
  # Retried ONCE per phone, the shape CalMind's watch install already uses:
  # the first call routinely times out while devicectl brings up developer
  # disk image services on a phone that has been idle, and the second call,
  # against the services the first one just started, goes straight through.
  #
  # A phone the team has never seen refuses differently — a provisioning
  # error, because its udid is not in the profile embedded in this bundle.
  # BUILDING against it once registers it; from then on every regenerated
  # profile carries that udid and a plain install works. So the cure is one
  # `IOS_PHONES=<its udid> sh tools/build-platforms.sh --ios`, which aims the
  # whole run at that one handset: a one-time step, and the second reason a
  # refusal warns and carries on instead of taking a good release down with
  # it. The warning prints that command with the udid already in it, the way
  # CalMind's does, because whoever reads it wants the next thing to type.
  #
  # Each install reads from /dev/null: this loop has the plan on ITS stdin,
  # and a child that helps itself to that stream swallows the phones below.
  TOOK=0
  while read -r TAG U NAME; do
    [ "$TAG" = "ok" ] || continue
    if xcrun devicectl device install app --device "$U" "$BUNDLE" </dev/null \
       || xcrun devicectl device install app --device "$U" "$BUNDLE" </dev/null; then
      TOOK=$((TOOK + 1))
      echo "    installed $SCHEME.app on $NAME"
    else
      echo "WARNING: $NAME ($U) would not take $SCHEME.app — carrying on" >&2
      echo "    if it is not REGISTERED with the team yet, devicectl refuses with a" >&2
      echo "    provisioning error and one build against it is the cure:" >&2
      echo "      IOS_PHONES=$U sh tools/build-platforms.sh --ios" >&2
    fi
  done < "$PLAN"
  rm -f "$PLAN"

  # THE RELEASE EITHER REACHED A PHONE OR IT DID NOT. Reaching some of its
  # phones and not the rest means a handset was switched off, not that the
  # build is bad, and a step that exits 1 over that teaches everyone to stop
  # reading its exit status — the very status the dtp lane uses to say a
  # device build is owed. NONE of them taking the app is the genuine failure,
  # the one the single `exit 1` here used to catch, and it is the only one
  # left that is fatal.
  [ "$TOOK" -gt 0 ] || {
    echo "no phone took $SCHEME.app — the build is good and the release reached nothing" >&2
    exit 1
  }
  # No watch branch: the watch is out, for now (AGENTS.md) — the target,
  # the bridge module and core's watch.ts were removed on Sean's 2026-08-21
  # word, so there is nothing to install to a paired watch.
fi

# ----------------------------------------------------------------- Android
if [ "$WANT_ANDROID" = 1 ]; then
  echo "==> Android"
  # ANDROID_HOME exported, not assumed: `expo run:android` sets it, a bare
  # ./gradlew does not, and the failure ("SDK location not found") reads like
  # a broken project rather than a missing variable (ARCHITECTURE.md).
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
