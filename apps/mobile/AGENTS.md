# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Releases

TestFlight + EAS Update runbook: `reference/mobile-release.md` (repo root).
JS-only changes go out via `eas update`; native changes need a full EAS build.
It also lists the build gotchas (api-client dist hook, babel-preset-expo,
android.permissions) — read it before touching eas.json, app.json, or the
release flow.
