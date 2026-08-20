/**
 * Expo config, computed rather than static.
 *
 * `experiments.baseUrl` is baked into every asset URL in the export, and
 * AcctMind is served at two paths — `/AcctMind` in production and
 * `/test/AcctMind` in the sandbox. One export cannot satisfy both: a bundle
 * built for `/AcctMind` and served under `/test/` asks for
 * `/AcctMind/_expo/...`, which is production's bundle. That is not a broken
 * page, it is the WRONG page — the sandbox silently running production's
 * code — so the base URL is an input, and deploy.sh exports once per
 * instance rather than trying to share one.
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
  },
};
