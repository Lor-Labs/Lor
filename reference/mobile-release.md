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

## Forcing a TestFlight build from a PR

The fingerprint gate above only cuts a build when native code changed, so a
JS-only merge normally reaches testers as an OTA update. To force a real
TestFlight build for a merge, tick the checkbox in the **Release options**
comment CI posts on every PR into `main`:

```markdown
- [x] **Ship a TestFlight build**
```

`.github/workflows/release-mobile.yml` mirrors that checkbox to the
`mobile:testflight` label so the state is visible next to the merge box; adding
the label by hand works too, and nothing removes it except unticking the box.
The label sync is best-effort: Issues are disabled on this repo, so the
workflow token can't create the label itself (that needs `issues: write`,
which GitHub silently drops for a disabled feature — PR comment/label calls go
through `pull-requests` instead). If the label is missing, create it once at
github.com/BuckyMcYolo/Lor/labels; the checkbox alone still triggers the
release either way.

The checkbox lives in a CI-owned comment rather than the PR description because
CodeRabbit rewrites descriptions and would wipe it. `issue_comment` events only
run the workflow file from the **default branch**, so the checkbox is inert
until this workflow is on `main` — until then, apply the label by hand.

On merge to `main` the workflow runs
`eas build --platform ios --profile production --auto-submit` and waits, so the
Actions run goes red if the build or the App Store Connect submission fails.
The same workflow has a `workflow_dispatch` trigger — Actions → Release mobile →
Run workflow — for cutting a build off current `main` with no PR involved.

Requires the `EXPO_TOKEN` repository secret (expo.dev → account settings →
access tokens).

Ticking the box on a merge that *also* changes the native fingerprint produces
two builds (this workflow's and the EAS workflow's automatic one) — harmless,
but leave the box unchecked for native changes since they build anyway.

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
  again. `version` is part of the fingerprint, so bumping it alone cuts a new
  build.

## Breaking releases: "Update Lor"

A phone on an older build keeps running its old code against the new server,
and nothing reaches it over the air (2026-10-13: the sessions release added
`expo-crypto`, and 0.1.1 phones broke). Since 0.2.0 the app guards against it
(`src/components/app-updates.tsx`):

- On launch and on each return to the foreground it reads
  `GET /v1/mobile/version` (public). When its `version` is below
  `minimumVersion`, a full-screen "Update Lor" page links to `updateUrl` (the
  TestFlight join link, set in the API so a move to the App Store reaches old
  apps). No answer from the server never blocks.
- `minimumVersion` is the API's `MOBILE_MIN_VERSION` env var; unset blocks
  nobody. For a release old phones can't survive: bump `version`, merge, wait
  until the build is installable in TestFlight (and added to the external
  group), then set `MOBILE_MIN_VERSION` to that version and restart the API.
  Setting it earlier blocks people with nothing to install.
- OTA updates: the app also checks for an update when it returns to the
  foreground (at most every 10 minutes) and switches to a downloaded one when
  it comes back after a minute or more in the background, instead of waiting
  for a second cold start.
- Builds before 0.2.0 have no guard and can't get one.

## Environment

- Production `EXPO_PUBLIC_*` values live in the EAS **production environment**
  (`eas env:list --environment production`), pulled in by the production build
  profile's `"environment": "production"`. Local `.env` is dev-only and never
  uploaded (gitignored).
- `eas update` bundles JS on your machine, so it must be told which env to
  inline — always pass `--environment production` when publishing to the
  production channel.

## Development app variant

Development builds install alongside TestFlight instead of replacing it:

- production: `Lor`, bundle ID `chat.lor.app`, URL scheme `lor`
- development: `Lor Dev`, bundle ID `chat.lor.app.dev`, URL scheme `lor-dev`

`eas.json` sets `APP_VARIANT=development` for the development profiles. The
local `start`, `dev`, `ios`, and `android` package scripts set the same value.
Production builds and updates must leave `APP_VARIANT` unset so `app.config.ts`
resolves the App Store identity. If running Expo commands directly rather than
through a package script, prefix development commands with
`APP_VARIANT=development`.

The development bundle ID has separate signing credentials and app storage.
EAS may prompt to create its Apple App ID and provisioning profile on the first
device build.

## Gotchas (each one cost a failed build)

- **First local device build of a new bundle ID fails with "No profiles for
  'chat.lor.app.dev' were found".** `APPLE_TEAM_ID` in `apps/mobile/.env` puts
  the team in the project, so `expo run:ios` treats signing as configured and
  skips `-allowProvisioningUpdates`. Build once from Xcode
  (`ios/LorDev.xcworkspace`, scheme LorDev, Run) so automatic signing creates
  the profiles; later `expo run:ios --device` builds find them.

- **Commit before building.** EAS builds from the repo; `pnpm-lock.yaml` must
  be committed in sync (frozen install) — a lockfile drift fails the install
  step immediately.
- **Metro bundles `@repo/api-client` from source.** Its exports map has a
  `react-native` condition pointing at `src/index.ts` (after `types`, so
  TypeScript keeps reading the built `.d.ts`; web and the server still get
  `dist/`). The gitignored `dist/` is therefore never needed on EAS, in
  builds or in OTA updates. The `eas-build-post-install` hook that compiles
  it is now redundant, but `package.json` scripts are part of the native
  fingerprint, so remove it only alongside a native change. A workspace
  package that ships compiled output to the phone needs the same condition.
- **`babel-preset-expo` and `@babel/preset-typescript` must stay direct
  devDependencies** of apps/mobile (the latter is required by the
  react-native-worklets babel plugin; keep it on the `^7.x` line matching
  `@babel/core@7`). Both resolve locally through pnpm's hidden hoist dir but
  break on EAS's strict fresh install. Pattern to recognize: a build fails
  with `Cannot find module '<babel thing>'` only on EAS, often right after an
  unrelated dependency change reshuffles the lockfile — fix by declaring the
  module explicitly in apps/mobile.
- **`sharp` (a `@repo/lor` server dependency) installs on EAS too**, since
  the install is the whole workspace. Its install check builds from source
  when it finds a system libvips through pkg-config, and fails without
  `node-addon-api`. The production profile sets
  `SHARP_IGNORE_GLOBAL_LIBVIPS=1` so it takes its prebuilt binary. First seen
  2026-10-07 (build `cc563d83`): "sharp: Please add node-addon-api to your
  dependencies" in the install phase. The workflow's submit job installs the
  workspace on a Mac as well and ignores the build profile, so it sets the
  same variable in `.eas/workflows/deploy.yml`; build 20 finished but its
  submission failed this way. A finished build whose submission failed can
  be sent on its own: `eas submit -p ios --id <build id>`.
- **OTA publishes failed on `@repo/api-client` until 2026-10-07.** The
  `update` job runs no `eas-build-post-install` hook, so Metro couldn't
  resolve the gitignored `dist/` ("While trying to resolve module
  `@repo/api-client`"), and every OTA publish from the workflow failed from
  at least 2026-09-27. Fixed by the source condition above; checked with
  `expo export --platform ios --source-maps`, whose map lists
  `packages/api-client/src/index.ts`.
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
- **Xcode 27 (Swift 6.4, iOS 27 SDK), 2026-10-26.** Two failures on the
  first local build with Xcode 27.1:
  - `cannot find type '__ObjC::expo' in scope` in
    `ExpoModulesJSI.swiftinterface`: Expo SDK 57.0.6's script didn't strip a
    C++ extension printed in Swift 6.4's new `::` form. Fixed by the latest
    SDK 57 patches (`expo install --fix`: expo 57.0.31, expo-modules-jsi
    57.1.3).
  - The app then crashed at launch in
    `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`: iOS 27
    stops apps built with its SDK unless they adopt the UIScene life cycle.
    SDK 57's template doesn't; `plugins/with-scene-lifecycle.js` copies SDK
    58's wiring (`SceneDelegate` on `ExpoAppSceneDelegate`, the scene
    manifest, an app delegate that no longer creates the window). Delete it
    after upgrading to SDK 58, whose template does this itself.
  - Crash reports from a device:
    `xcrun devicectl device info files --device <udid> --domain-type systemCrashLogs`,
    then `xcrun devicectl device copy from … --source <file>.ips`.

## Apple review notes

- The App Store Connect **Test Information** demo account is review
  infrastructure — Apple reuses it for every future review. Don't delete it.
- `ITSAppUsesNonExemptEncryption: false` is in app.json, so no export
  compliance question per build.
- New marketing versions distributed to external testers can trigger a quick
  re-review; build-number-only releases usually don't.
- TestFlight builds expire after 90 days.
