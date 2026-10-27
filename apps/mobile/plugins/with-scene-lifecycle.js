const fs = require("node:fs")
const path = require("node:path")
const {
  IOSConfig,
  withAppDelegate,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins")

// iOS 27 stops apps built with its SDK at launch unless they adopt the UIScene
// life cycle (_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption).
// Expo SDK 57 ships the scene delegate (ExpoAppSceneDelegate) but its template
// doesn't use it; this copies SDK 58's template wiring. Delete this plugin
// once the app is on SDK 58.

const SCENE_DELEGATE_SWIFT = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`

// The scene delegate creates the window and starts React Native, so the app
// delegate only creates the factory. SDK 57's link overrides stay: the scene
// delegate forwards links to them without delivering them twice.
function withSceneAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== "swift") {
      throw new Error("with-scene-lifecycle expects a Swift AppDelegate")
    }
    const contents = config.modResults.contents
      .replace(
        "class AppDelegate: ExpoAppDelegate {",
        "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {"
      )
      .replace(
        /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/,
        "\n"
      )
    if (
      !contents.includes("ExpoReactNativeFactoryProvider") ||
      contents.includes("factory.startReactNative(")
    ) {
      throw new Error(
        "with-scene-lifecycle couldn't update AppDelegate.swift: Expo's template changed"
      )
    }
    config.modResults.contents = contents
    return config
  })
}

function withSceneManifest(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: "Default Configuration",
            UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
          },
        ],
      },
    }
    return config
  })
}

function withSceneDelegateFile(config) {
  const withFile = withDangerousMod(config, [
    "ios",
    (config) => {
      const projectName = IOSConfig.XcodeUtils.getProjectName(
        config.modRequest.projectRoot
      )
      fs.writeFileSync(
        path.join(
          config.modRequest.platformProjectRoot,
          projectName,
          "SceneDelegate.swift"
        ),
        SCENE_DELEGATE_SWIFT
      )
      return config
    },
  ])
  return withXcodeProject(withFile, (config) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      config.modRequest.projectRoot
    )
    const filepath = path.join(projectName, "SceneDelegate.swift")
    if (!config.modResults.hasFile(filepath)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath,
        groupName: projectName,
        project: config.modResults,
      })
    }
    return config
  })
}

module.exports = function withSceneLifecycle(config) {
  return withSceneDelegateFile(withSceneManifest(withSceneAppDelegate(config)))
}
