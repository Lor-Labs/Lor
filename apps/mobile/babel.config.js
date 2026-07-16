// babel-preset-expo auto-adds the worklets plugin with no options, so we
// disable that (worklets + reanimated) and add it ourselves with Bundle Mode
// enabled — required by react-native-streamdown to run remend off the JS
// thread. The single worklets plugin also covers Reanimated 4.
module.exports = (api) => {
  api.cache(true)
  return {
    presets: [["babel-preset-expo", { worklets: false, reanimated: false }]],
    plugins: [
      [
        "react-native-worklets/plugin",
        { bundleMode: true, importForwarding: { moduleNames: ["remend"] } },
      ],
    ],
  }
}
