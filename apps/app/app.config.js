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

module.exports = {
  expo: {
    name: 'AcctMind',
    slug: 'acctmind',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    backgroundColor: '#111111',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.seancheren.acctmind',
      // Sean's Apple team, the same one CalMind signs with. Needed to sign
      // the watch target for a device; the simulator does not care.
      appleTeamId: 'APPLE_TEAM_ID',
    },
    android: {
      package: 'com.seancheren.acctmind',
      predictiveBackGestureEnabled: false,
    },
    web: {
      bundler: 'metro',
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
