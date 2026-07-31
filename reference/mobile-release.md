# Mobile release runbook (iOS / TestFlight / EAS)

How `apps/mobile` gets to testers. One-time setup (Apple credentials, App Store
Connect app record, TestFlight groups, EAS env vars) is DONE — this is the
recurring loop plus the gotchas that made the first builds fail.

## Automatic (the normal path)

Every push to `main` touching mobile-relevant paths triggers
`apps/mobile/.eas/workflows/deploy.yml` (EAS Workflows — runs on Expo's infra,
no GitHub secrets). It fingerprints the native characteristics of the project,
then:

- **fingerprint matches an existing EAS build** → publishes an OTA update to
  the `production` channel; installed apps fetch it on next launch.
  Development builds don't auto-apply OTA updates (they load from the dev
  server), though compatible updates can be opened manually from the
  dev-client launcher.
- **fingerprint is new** (native module added/removed, app.json/plugin
  change, SDK upgrade) → cuts a full EAS build and auto-submits it to
  TestFlight.

Watch runs at expo.dev → project → Workflows. Requires the GitHub repo
(BuckyMcYolo/Lor) to be connected to the EAS project with base directory
`apps/mobile` (one-time, expo.dev project settings → GitHub).

Still manual after an automatic TestFlight build: App Store Connect →
TestFlight → external group → add build + "What to Test" line (internal
testers get it with no action). Public tester link:
https://testflight.apple.com/join/uJfqWwxJ

## Manual fallback

```bash
cd apps/mobile
# OTA (JS-only change):
npx eas-cli update --channel production --environment production --message "what changed"
# Full build + TestFlight (native change, or when unsure):
npx eas-cli build --platform ios --profile production --auto-submit
```

`--environment production` injects the EAS-hosted `EXPO_PUBLIC_*` vars into
the OTA bundle (required on SDK 55+; without it the update would carry local
dev URLs). Apple processing after submit is ~5–15 min.

## Versioning

- **buildNumber**: managed remotely by EAS (`appVersionSource: "remote"` +
  `autoIncrement`). Never touch it.
- **`version` in app.json** (marketing version): bump for milestones; it
  groups builds in TestFlight and is shown on the You screen footer.
- **runtimeVersion policy is `fingerprint`** (required by the deploy
  workflow): OTA updates only reach builds with the identical native
  fingerprint, so native changes can never receive a JS bundle that assumes
  different native code. Corollary: after any fingerprint-changing merge,
  testers must take the new TestFlight build before they receive OTA updates
  again.

## Environment

- Production `EXPO_PUBLIC_*` values live in the EAS **production environment**
  (`eas env:list --environment production`), pulled in by the production build
  profile's `"environment": "production"`. Local `.env` is dev-only and never
  uploaded (gitignored).
- `eas update` bundles JS on your machine, so it must be told which env to
  inline — always pass `--environment production` when publishing to the
  production channel.

## Gotchas (each one cost a failed build)

- **Commit before building.** EAS builds from the repo; `pnpm-lock.yaml` must
  be committed in sync (frozen install) — a lockfile drift fails the install
  step immediately.
- **`eas-build-post-install`** (apps/mobile/package.json) compiles
  `@repo/api-client` on the EAS worker — its `dist/` is gitignored and Metro
  needs it. Don't remove the hook; if another workspace package ever exports
  compiled output, add it to the same turbo filter.
- **`babel-preset-expo` must stay a direct devDependency** of apps/mobile.
  It resolves locally through pnpm's hidden hoist dir, but EAS's strict fresh
  install can't see it without the explicit declaration.
- **Don't persist `android.permissions` in app.json.** Config plugins compute
  them at prebuild; `eas update:configure` once serialized them in (with
  duplicates, re-adding RECORD_AUDIO that `microphonePermission: false`
  deliberately removes). If a tool writes that array, delete it.
- **Reading EAS build logs**: `eas build:view <id> --json` →
  `artifacts.xcodeBuildLogsUrl` → the file is **brotli**-compressed
  (`node -e "zlib.brotliDecompressSync(...)"`). The web UI error summary is
  often just the symptom; the real error is ~100 lines earlier in the log.
- **Sanity-check the bundle locally** before burning a 20-min EAS build:
  `pnpm expo export:embed --eager --platform ios --dev false`.

## Apple review notes

- The App Store Connect **Test Information** demo account is review
  infrastructure — Apple reuses it for every future review. Don't delete it.
- `ITSAppUsesNonExemptEncryption: false` is in app.json, so no export
  compliance question per build.
- New marketing versions distributed to external testers can trigger a quick
  re-review; build-number-only releases usually don't.
- TestFlight builds expire after 90 days.
