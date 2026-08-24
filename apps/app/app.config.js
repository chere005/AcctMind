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
    // Kept in step with the root package.json — and with the git tag — by
    // tools/check-version.mjs. It said 0.1.0 through three tagged releases,
    // so the build on a phone claimed to be a version from days earlier and
    // nothing anywhere disagreed.
    version: '0.19.0',
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
      /*
       * The durable build identifier, HAND-bumped on every build that leaves
       * this machine — not once per release.
       *
       * CalMind's README says why, and this repo proved it the hard way:
       * without one, every install reads `1`, and "is the thing I just
       * installed actually on the device?" has no evidence either way. A
       * whole evening went into telling four builds apart by their features.
       *
       * The VERSION answers "which release is this"; the BUILD answers "which
       * of the eleven times I built that release is on the phone". They are
       * different questions and need different numbers.
       */
      buildNumber: '1',
      infoPlist: {
        /*
         * Local-network sync, and the reason it needs no paid membership.
         *
         * These two keys are a USAGE DESCRIPTION and a service declaration,
         * not an entitlement — a free personal team can ship them, which is
         * the whole point of choosing Bonjour over iCloud for now. iOS shows
         * the description verbatim the first time the app advertises or
         * browses, so it is written for the person reading it at that moment,
         * and it is true: nothing leaves the network.
         *
         * NSBonjourServices is an ALLOW-LIST. A service type missing from it
         * fails silently — the browser simply never finds anything — so it is
         * checked against core's PEER_SERVICE by tools/check-peer-service.mjs
         * rather than trusted to stay in step by hand.
         */
        /*
         * Export compliance, declared once here rather than answered by hand
         * on every upload.
         *
         * `false` means "uses only exempt encryption". This app's only crypto
         * is the TLS link between a person's own devices — standard TLS with
         * a pre-shared key, plus HKDF to derive it — which falls squarely
         * inside the exemption for authentication and for encryption Apple
         * itself provides. Nothing here implements a cipher, and nothing
         * encrypts anything for a third party.
         *
         * Without this key App Store Connect stops every build and asks, and
         * the answer given in a hurry is the one that costs a review cycle.
         */
        ITSAppUsesNonExemptEncryption: false,
        NSLocalNetworkUsageDescription:
          'AcctMind syncs your transactions directly between your own devices on this network. Nothing is sent to a server.',
        NSBonjourServices: ['_acctmind1._tcp'],
      },
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
    /*
     * No `plugins` here since the watch went.
     *
     * `@bacons/apple-targets` existed to generate the watchOS target from
     * `targets/watch/` at prebuild. With that directory gone the plugin has
     * nothing to generate, and left in it adds an extra target to every
     * prebuild for no reason. Sean, 2026-08-21: drop the watch for now — so
     * this comes back with it, together with the dependency.
     */
  },
};
