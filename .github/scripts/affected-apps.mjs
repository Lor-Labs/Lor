import { spawnSync } from "node:child_process"

const APP_DEFINITIONS = [
  { key: "web", label: "Web", packageName: "web", path: "apps/web" },
  {
    key: "desktop",
    label: "Desktop",
    packageName: "desktop",
    path: "apps/desktop",
  },
  {
    key: "mobile",
    label: "Mobile",
    packageName: "mobile",
    path: "apps/mobile",
  },
  {
    key: "api",
    label: "API",
    packageName: "@repo/api",
    path: "apps/api",
  },
  {
    key: "worker",
    label: "Worker",
    packageName: "@repo/worker",
    path: "apps/worker",
  },
  {
    key: "realtime",
    label: "Realtime",
    packageName: "@repo/realtime",
    path: "apps/realtime",
  },
  {
    key: "www",
    label: "Marketing site",
    packageName: "www",
    path: "apps/www",
  },
]

const REPOSITORY_WIDE_FILES = new Set([
  ".npmrc",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "turbo.json",
])

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  })
  if (result.status !== 0) {
    fail(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`
    )
  }
  return result.stdout
}

function assertSha(value, name) {
  if (!/^[0-9a-f]{7,40}$/i.test(value ?? "")) {
    fail(`${name} must be a Git commit SHA`)
  }
}

const [baseSha, headSha] = process.argv.slice(2)
assertSha(baseSha, "base SHA")
assertSha(headSha, "head SHA")
const comparisonBase = run("git", ["merge-base", baseSha, headSha]).trim()
assertSha(comparisonBase, "merge-base SHA")

const changedFiles = run(
  "git",
  [
    "diff",
    "--name-only",
    "--diff-filter=ACDMRTUXB",
    "-z",
    comparisonBase,
    headSha,
  ],
  { encoding: "buffer" }
)
  .toString("utf8")
  .split("\0")
  .filter(Boolean)

const turboOutput = run("pnpm", [
  "exec",
  "turbo",
  "ls",
  `--filter=...[${comparisonBase}...${headSha}]`,
  "--output=json",
])

let affectedPackages
try {
  const parsed = JSON.parse(turboOutput)
  affectedPackages = new Set(parsed.packages.items.map((item) => item.name))
} catch (error) {
  fail(`Could not parse Turborepo output: ${error}`)
}

const repositoryWide = changedFiles.some(
  (file) => REPOSITORY_WIDE_FILES.has(file) || file.startsWith("patches/")
)
const webAffected = repositoryWide || affectedPackages.has("web")

const apps = Object.fromEntries(
  APP_DEFINITIONS.map((app) => {
    const direct = changedFiles.some(
      (file) => file === app.path || file.startsWith(`${app.path}/`)
    )
    const bundledWeb = app.key === "desktop" && webAffected
    const affected =
      repositoryWide ||
      direct ||
      affectedPackages.has(app.packageName) ||
      bundledWeb

    let reason = "No direct or dependency changes"
    if (repositoryWide) reason = "Repository-wide configuration changed"
    else if (direct) reason = "Direct changes"
    else if (bundledWeb) reason = "Bundles the affected web app"
    else if (affected) reason = "Affected workspace dependency"

    return [app.key, { ...app, affected, reason }]
  })
)

const affectedLabels = APP_DEFINITIONS.filter(
  (app) => apps[app.key].affected
).map((app) => app.label)
const rows = APP_DEFINITIONS.map((app) => {
  const result = apps[app.key]
  const status = result.affected ? "✅ Affected" : "— Not affected"
  return `| ${app.label} | ${status} | ${result.reason} |`
})
const packageList = [...affectedPackages].sort()

const body = [
  "<!-- affected-apps-report -->",
  "## Affected apps",
  "",
  `**Affected:** ${affectedLabels.length > 0 ? affectedLabels.join(", ") : "None"}`,
  "",
  "| App | Status | Why |",
  "| --- | --- | --- |",
  ...rows,
  "",
  "<details>",
  `<summary>Affected workspace packages (${packageList.length})</summary>`,
  "",
  packageList.length > 0
    ? packageList.map((name) => `- \`${name}\``).join("\n")
    : "_No workspace packages were affected._",
  "",
  "</details>",
  "",
  `Compared \`${comparisonBase.slice(0, 7)}\`…\`${headSha.slice(0, 7)}\` using the Turborepo dependency graph plus Lor's web → desktop bundle relationship.`,
  "",
  "_This comment updates automatically when the PR changes._",
].join("\n")

process.stdout.write(
  `${JSON.stringify({
    apps,
    affectedPackages: packageList,
    comparisonBase,
    changedFiles,
    body,
  })}\n`
)
