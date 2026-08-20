/**
 * The Apple Watch app target — `expo prebuild` generates it into the Xcode
 * project from this directory.
 *
 * Shaped to match CalMind's working target, after a first attempt produced no
 * watch target at all and said nothing about it: the bundle identifier must
 * be the FULL id, not the relative `.watchkitapp` form, and the target wants
 * its own icon. A prebuild that silently generates one target instead of two
 * is the failure mode here — check `xcodebuild -list` after changing this.
 */
module.exports = {
  type: 'watch',
  icon: './icon.png',
  name: 'AcctMindWatch',
  bundleIdentifier: 'com.seancheren.acctmind.watchkitapp',
  deploymentTarget: '10.0',
  colors: {},
};
