import type { ConfigContext, ExpoConfig } from "expo/config"

const isDevelopment = process.env.APP_VARIANT === "development"

const appName = isDevelopment ? "Lor Dev" : "Lor"
const appIdentifier = isDevelopment ? "chat.lor.app.dev" : "chat.lor.app"
const appScheme = isDevelopment ? "lor-dev" : "lor"

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: appName,
  slug: config.slug ?? "lor",
  scheme: appScheme,
  ios: {
    ...config.ios,
    bundleIdentifier: appIdentifier,
    ...(process.env.APPLE_TEAM_ID
      ? { appleTeamId: process.env.APPLE_TEAM_ID }
      : {}),
  },
  android: {
    ...config.android,
    package: appIdentifier,
  },
  extra: {
    ...config.extra,
    appScheme,
    appVariant: isDevelopment ? "development" : "production",
  },
})
