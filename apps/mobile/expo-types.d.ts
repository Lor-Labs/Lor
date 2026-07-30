/// <reference types="expo/types" />

// Committed counterpart to the gitignored expo-env.d.ts: pulls in Expo's global
// ambient types (CSS modules, asset imports) so `check-types` passes on a fresh
// checkout / CI where expo-env.d.ts hasn't been generated.

declare module "*.png" {
  const asset: number
  export default asset
}
