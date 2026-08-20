# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/
before writing any code. The versions here are pinned to the set CalMind
proved on real devices; changing one is a decision, not a chore.

## What belongs in here

Plumbing. Screens, gestures, styling, and the platform's storage API.
Every rule — what an amount is, what a valid transaction is, how the list
orders itself — is imported from `@acctmind/core`, which is consumed as
TypeScript source with no build step.

If you are about to write an `if` that decides something about the product
rather than about the screen, it is in the wrong file.

## The base URL is an input

`app.config.js` reads `ACCTMIND_BASE_URL`. The export bakes it into every
asset link, and the app is served at two paths, so an export is only valid
for the instance it was built for. `deploy.sh` exports once per instance;
nothing should call `expo export` directly.

## Metro runs on 8083, not 8081

Every Expo project defaults to port 8081, and a dev client asks whatever is
on that port for its bundle — it does not check which project answered. With
CalMind open in another window, AcctMind's freshly built iOS app connected to
CALMIND's bundler, loaded CalMind's bundle, and died on `Cannot find native
module 'ExpoClipboard'` — a module AcctMind does not depend on and its binary
therefore does not contain. The build was perfect; the bundler was the wrong
project's.

So the scripts here pin `--port 8083`. Do not remove it to "use the default",
and if you start Metro by hand, pass it.

Two follow-ons, both learned the same afternoon:

- **A dev client REMEMBERS the server it last reached.** Once it has attached
  to the wrong one, starting a correct bundler does not move it, and neither
  does re-sending the `expo-development-client` deep link at a running app.
  The symptom is a redbox for a module you do not depend on, and under it
  "App entry not found" — because the foreign bundle threw before
  `registerRootComponent` ran. Terminate the app and relaunch it from
  `npm run ios` (which carries the port) rather than trying to redirect it.

- **To verify iOS, build Release.** `--configuration Release` embeds the JS
  bundle in the app, so there is no dev server in the picture at all and no
  way to load another project's code. It is also what actually ships. Use the
  dev client for iteration; use Release when the question is "does the iOS
  app work".
