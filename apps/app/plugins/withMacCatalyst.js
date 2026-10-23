/**
 * Enable Mac Catalyst in the generated iOS project.
 *
 * Expo's generated Podfile disables CocoaPods' Catalyst support, and the app
 * target does not advertise a Mac Catalyst destination. Both settings must
 * survive `expo prebuild --clean`, so they belong in a config plugin rather
 * than a one-off edit to ios/.
 */
const fs = require('fs');
const xcode = require('xcode');
const { withFinalizedMod, withPodfile, IOSConfig } = require('@expo/config-plugins');

module.exports = function withMacCatalyst(config) {
  config = withPodfile(config, (mod) => {
    const before = mod.modResults.contents;
    const after = before.replace(
      ':mac_catalyst_enabled => false',
      ':mac_catalyst_enabled => true',
    );
    if (after === before) {
      throw new Error(
        'withMacCatalyst: Expo changed the Podfile Catalyst setting; update this plugin before prebuilding.',
      );
    }
    mod.modResults.contents = after;
    return mod;
  });

  // Run after Xcode project generation, then let CocoaPods build its iOS
  // targets with the Catalyst SDK too. AcctMind has no watch or extension
  // targets to filter out.
  config = withFinalizedMod(config, [
    'ios',
    (mod) => {
      const projectPath = IOSConfig.Paths.getPBXProjectPath(mod.modRequest.projectRoot);
      const project = xcode.project(projectPath);
      project.parseSync();

      const targets = project.pbxNativeTargetSection();
      const lists = project.pbxXCConfigurationList();
      const configurations = project.pbxXCBuildConfigurationSection();
      let changed = false;
      for (const key of Object.keys(targets)) {
        const target = targets[key];
        if (!target.name || !target.buildConfigurationList) continue;
        const list = lists[target.buildConfigurationList];
        if (!list) continue;
        for (const { value: id } of list.buildConfigurations) {
          const build = configurations[id];
          if (!build?.buildSettings) continue;
          build.buildSettings.SUPPORTS_MACCATALYST = 'YES';
          build.buildSettings.DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = 'NO';
          build.buildSettings.TARGETED_DEVICE_FAMILY = '"1,2,6"';
          changed = true;
        }
      }
      if (!changed) throw new Error('withMacCatalyst: generated Xcode project has no native target configurations.');
      fs.writeFileSync(projectPath, project.writeSync());

      return mod;
    },
  ]);

  return config;
};
