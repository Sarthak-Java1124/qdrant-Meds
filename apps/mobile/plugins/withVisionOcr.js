// expo-mlkit-ocr links Google ML Kit on iOS unless EXPO_MLKIT_OCR_DISABLE_MLKIT=1 is set when `pod install` runs.
// ML Kit has no arm64-simulator build and needs static frameworks, so Aftercare reads text with Apple Vision on
// iOS (simulator and device alike) and keeps ML Kit for Android. This sets the flag on every prebuild.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const LINE = "ENV['EXPO_MLKIT_OCR_DISABLE_MLKIT'] = '1'";

module.exports = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      const podfile = fs.readFileSync(file, 'utf8');
      if (!podfile.includes(LINE)) fs.writeFileSync(file, `${LINE}\n${podfile}`);
      return cfg;
    },
  ]);
