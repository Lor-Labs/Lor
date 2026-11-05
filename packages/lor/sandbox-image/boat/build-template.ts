// Builds the Boat template (LOR_BOAT_TEMPLATE, default "lor-workbench"): a
// fresh Boat VM, the image folder copied in, setup.sh run as root, then the
// disk saved as a named snapshot new Boat sandboxes start from. Run after
// harness-bootstrap.ts (it fills claude-code/ and codex/), from packages/lor:
//   pnpm --filter @repo/lor exec tsx sandbox-image/boat/build-template.ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import {
  BoatApi,
  type CommandStartedResponse,
  Configuration,
  waitUntilReady,
} from "@boatdev/sdk"
import { config } from "dotenv"

config({ path: join(__dirname, "../../../../.env"), quiet: true })
const name = process.env.LOR_BOAT_TEMPLATE || "lor-workbench"
const boat = new BoatApi(
  new Configuration({ accessToken: process.env.BOAT_API_KEY ?? "" })
)
const IMAGE = join(__dirname, "..")
const FILES = [
  "claude-code",
  "codex",
  "terminal",
  "browser",
  "codex-config.toml",
  "boat/setup.sh",
]

function walk(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path)
    .filter((entry) => entry !== "node_modules" && entry !== ".pnpm-store")
    .flatMap((entry) => walk(join(path, entry)))
}

async function main() {
  const { sandbox } = await boat.create({
    createSandboxRequest: {
      name: `lor-template-build-${Date.now()}`,
      type: "default",
      ttlSeconds: 2 * 3600,
      labels: { lor: "template-build" },
    },
  })
  console.log(`Building on ${sandbox.id}`)
  try {
    await waitUntilReady(boat, sandbox.id)
    for (const file of FILES.flatMap((f) => walk(join(IMAGE, f)))) {
      await boat.writeFile({
        sandboxId: sandbox.id,
        fileWriteRequest: {
          path: `/tmp/lor-image/${relative(IMAGE, file)}`,
          content: readFileSync(file).toString("base64"),
          encoding: "base64",
        },
      })
    }
    const started = (await boat.command({
      sandboxId: sandbox.id,
      commandRequest: {
        command:
          'if [ "$(id -u)" = 0 ]; then bash /tmp/lor-image/boat/setup.sh; else sudo -n -H bash /tmp/lor-image/boat/setup.sh; fi',
        detached: true,
      },
    })) as CommandStartedResponse
    const offsets = { stdout: 0, stderr: 0 }
    for (;;) {
      const status = await boat.commandStatus({
        sandboxId: sandbox.id,
        processId: started.processId,
        stdoutOffset: offsets.stdout,
        stderrOffset: offsets.stderr,
      })
      process.stdout.write(status.stdout)
      process.stderr.write(status.stderr)
      offsets.stdout = status.stdoutNextOffset ?? offsets.stdout
      offsets.stderr = status.stderrNextOffset ?? offsets.stderr
      if (!status.running && !status.more) {
        if (status.exitCode !== 0)
          throw new Error(`setup.sh failed (exit ${status.exitCode})`)
        break
      }
      if (!status.more) await new Promise((r) => setTimeout(r, 2000))
    }
    // Replaces the template of the same name.
    await boat.deleteSavedSnapshot({ name }).catch(() => {})
    await boat.saveSavedSnapshot({
      savedSnapshotSaveRequest: { sandboxId: sandbox.id, name },
    })
    for (;;) {
      const { snapshot } = await boat.getSavedSnapshot({ name })
      console.log(`Template ${name}: ${snapshot.status}`)
      if (snapshot.status === "ready") break
      if (snapshot.status === "failed") throw new Error(snapshot.error)
      await new Promise((r) => setTimeout(r, 5000))
    }
  } finally {
    await boat
      .deleteSandbox({ sandboxId: sandbox.id, xAsciiConfirmDelete: sandbox.id })
      .catch((err: unknown) => console.error("Build VM not deleted", err))
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
