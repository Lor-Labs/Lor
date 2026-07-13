const { getDefaultConfig } = require("expo/metro-config")
const { dirname, resolve } = require("node:path")
const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode")
const { withUniwindConfig } = require("uniwind/metro")

let config = getDefaultConfig(__dirname)

// Bundle Mode: pre-bundles worklet-thread code (react-native-streamdown runs
// remend off the JS thread via react-native-worklets).
config.watchFolders.push(
  resolve(
    dirname(require.resolve("react-native-worklets/package.json")),
    ".worklets"
  )
)

const isBetterAuthRuntimeModule = (moduleName) =>
  moduleName === "better-auth" ||
  moduleName === "better-call" ||
  moduleName.startsWith("better-auth/") ||
  moduleName.startsWith("@better-auth/") ||
  moduleName.startsWith("@better-fetch/")

const resolvePublishedBetterAuthModule = (moduleName, originModulePath) => {
  try {
    return require.resolve(moduleName, {
      paths: [dirname(originModulePath), __dirname],
    })
  } catch {
    return null
  }
}

const defaultResolver = config.resolver.resolveRequest
config = getBundleModeMetroConfig(config)
const bundleModeResolver = config.resolver.resolveRequest

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith("react-native-worklets/.worklets/")) {
    return bundleModeResolver(context, moduleName, platform)
  }

  const filePath = isBetterAuthRuntimeModule(moduleName)
    ? resolvePublishedBetterAuthModule(moduleName, context.originModulePath)
    : null
  if (filePath) {
    return { filePath, type: "sourceFile" }
  }

  if (defaultResolver) {
    return defaultResolver(context, moduleName, platform)
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./src/global.css",
  dtsFile: "./src/uniwind-types.d.ts",
})
