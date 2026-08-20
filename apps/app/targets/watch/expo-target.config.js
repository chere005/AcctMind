/**
 * The Apple Watch app, generated INTO the Xcode project by
 * @bacons/apple-targets during `expo prebuild`.
 *
 * Nothing here is checked into ios/ — that directory is prebuild output and
 * is gitignored. This config plus the Swift beside it IS the watch app.
 */
module.exports = {
  type: 'watch',
  name: 'AcctMind',
  bundleIdentifier: '.watchkitapp',
  deploymentTarget: '10.0',
  colors: { $accent: '#0a84ff', $widgetBackground: '#111111' },
};
