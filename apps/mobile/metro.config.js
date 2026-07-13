const { getDefaultConfig } = require("expo/metro-config")
const { dirname } = require("node:path")
const { withNativewind } = require("nativewind/metro")

const config = getDefaultConfig(__dirname)
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

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const filePath = isBetterAuthRuntimeModule(moduleName)
    ? resolvePublishedBetterAuthModule(moduleName, context.originModulePath)
    : null
  if (filePath) {
    return { filePath, type: "sourceFile" }
  }

  return context.resolveRequest(context, moduleName, platform)
}

module.exports = withNativewind(config)
