import Constants from "expo-constants"

type AppExtra = {
  appScheme?: unknown
  appVariant?: unknown
}

const extra = Constants.expoConfig?.extra as AppExtra | undefined

export const APP_SCHEME = extra?.appScheme === "lor-dev" ? "lor-dev" : "lor"
export const APP_VARIANT =
  extra?.appVariant === "development" ? "development" : "production"
