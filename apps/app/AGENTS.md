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
