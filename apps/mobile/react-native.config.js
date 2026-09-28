// onnxruntime-react-native ships a legacy unimodule.json, which makes Expo's autolinking
// treat it as an Expo module and skip it. An explicit platform entry opts it back in as a
// regular React Native module so OnnxruntimePackage gets registered.
module.exports = {
  dependencies: {
    'onnxruntime-react-native': {
      platforms: { android: {} },
    },
  },
};
