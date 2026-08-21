/**
 * Expo config, computed rather than static.
 *
 * `experiments.baseUrl` is baked into the export's asset URLs, and AcctMind
 * is served at two paths — `/AcctMind` in production and `/test/AcctMind` in
 * the sandbox. A bundle built for one and served at the other asks for the
 * other instance's chunks: not a broken page but the WRONG page, the sandbox
 * silently running production's code. So the base URL is an input, and
 * deploy.sh exports once per instance.
 *
 * Measured, 2026-08-20, because the reason is narrower than it looks: TODAY
 * the two exports produce a byte-identical bundle and differ only in
 * index.html, since this app has no lazy imports and therefore no async
 * chunks for the base path to appear in. index.html is the file that gets
 * served, so per-instance export is still required — and the first `import()`
 * anyone adds puts the path into the JS as well, at which point sharing one
 * export would break in a way no test would obviously name. Cheap insurance,
 * accurately described.
 *
 *   ACCTMIND_BASE_URL=/test/AcctMind npm run export:web
 */
const baseUrl = process.env.ACCTMIND_BASE_URL || '/AcctMind';

/**
 * Signing, and iCloud, which are two separate questions.
 *
 * APPLE_TEAM_ID signs the app. A FREE personal Apple team is enough for that,
 * and enough to run on a device, on the Mac under "Designed for iPad", and on
 * the watch.
 *
 * ACCTMIND_ICLOUD=1 additionally requests the key-value-store entitlement
 * that sync needs — and that is where the tiers part company. **A personal
 * team cannot use the iCloud capability at all**; Xcode refuses to make a
 * profile, with "Personal development teams ... do not support the iCloud
 * capability", and the build fails before it compiles anything. It needs a
 * paid Apple Developer Program membership.
 *
 * They are separate flags because coupling them, which is what this file did
 * first, means a free team cannot build the app AT ALL — the entitlement
 * rides in with the team and takes the whole build down with it. Off by
 * default, so the common case is the one that works: the app runs everywhere,
 * purely local, and `available()` reports no iCloud exactly as it does for a
 * signed-out user.
 */
const team = process.env.APPLE_TEAM_ID;
const wantsICloud = process.env.ACCTMIND_ICLOUD === '1';
const signing = {
  ...(team ? { appleTeamId: team } : {}),
  ...(wantsICloud
    ? {
        entitlements: {
          'com.apple.developer.ubiquity-kvstore-identifier':
            '$(TeamIdentifierPrefix)$(CFBundleIdentifier)',
        },
      }
    : {}),
};

module.exports = {
  expo: {
    name: 'AcctMind',
    slug: 'acctmind',
    version: '0.1.0',
    orientation: 'portrait',
    // Both generated from assets/logo-square.svg by tools/make-icons.sh.
    // Never edit a PNG here by hand — re-run the script, so one change to
    // the mark reaches all six surfaces at once.
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    backgroundColor: '#111111',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.seancheren.acctmind',
      ...signing,
    },
    android: {
      package: 'com.seancheren.acctmind',
      predictiveBackGestureEnabled: false,
      adaptiveIcon: {
        // Android masks its own way and crops harder than iOS, so the
        // foreground is the same full-bleed cut on the tile's own colour.
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#111111',
      },
    },
    web: {
      bundler: 'metro',
      favicon: './assets/favicon.png',
    },
    experiments: {
      baseUrl,
    },
    // The watch app is a real Apple target, generated INTO the Xcode project
    // from targets/watch/ during `expo prebuild`. Without this plugin that
    // directory is just three files nothing reads — which is exactly what it
    // was until this line was added.
    plugins: ['@bacons/apple-targets'],
  },
};
