// Writes the Claude Code and Codex adapters' bootstraps into claude-code/ and
// codex/ for the image: each sandbox bridge as Lor's patches leave it, and
// the marker that tells the adapter the bootstrap is done, so a new sandbox
// skips it (pnpm install took about 7 s of a new session's first turn). The
// Dockerfile runs the install commands. Run it after changing an adapter or
// its patch, then `bl push`:
//   pnpm --filter @repo/lor exec tsx sandbox-image/harness-bootstrap.ts
// An image with an older marker still works: the adapter runs the bootstrap.
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import {
  createHarnessSandboxTemplate,
  type HarnessAgentAdapter,
} from "@ai-sdk/harness/agent"
import { createClaudeCode } from "@ai-sdk/harness-claude-code"
import { createCodex } from "@ai-sdk/harness-codex"
import type { Experimental_SandboxSession as SandboxSession } from "ai"

const HOME = "/root"
const PNPM_INSTALL = "pnpm install --frozen-lockfile --store-dir .pnpm-store"
// The Dockerfile runs these in each bootstrap folder.
const HARNESSES: {
  dir: string
  adapter: HarnessAgentAdapter
  commands: string[]
}[] = [
  {
    dir: "claude-code",
    adapter: createClaudeCode(),
    commands: [PNPM_INSTALL, "./node_modules/.bin/claude --version"],
  },
  { dir: "codex", adapter: createCodex(), commands: [PNPM_INSTALL] },
]

const unused = () => {
  throw new Error("The bootstrap does not use this")
}
const done = { exitCode: 0, stdout: "", stderr: "" }

for (const { dir, adapter, commands: expected } of HARNESSES) {
  const bootstrapDir = `${HOME}/.ai-sdk-harness/.harness-bootstrap/${dir}`
  const out = join(import.meta.dirname, dir)
  const outPath = (path: string) => {
    if (!path.startsWith(`${bootstrapDir}/`)) {
      throw new Error(`Unexpected bootstrap path: ${path}`)
    }
    return join(out, path.slice(bootstrapDir.length + 1))
  }
  const commands: string[] = []
  // Stands in for a sandbox: files go to out/, install commands are recorded.
  const session = {
    description: "Image build stand-in",
    run: async ({ command, workingDirectory }) => {
      if (command === 'printf "%s" "$HOME"') return { ...done, stdout: HOME }
      if (command === 'mkdir -p "$BOOTSTRAP_DIR"') return done
      if (workingDirectory !== bootstrapDir) {
        throw new Error(`Unexpected bootstrap command: ${command}`)
      }
      commands.push(command)
      return done
    },
    readTextFile: async () => null,
    writeTextFile: async ({ path, content }) => {
      await writeFile(outPath(path), content)
    },
    spawn: unused,
    readFile: unused,
    readBinaryFile: unused,
    writeFile: unused,
    writeBinaryFile: unused,
  } satisfies SandboxSession

  const template = await createHarnessSandboxTemplate({ harnesses: [adapter] })
  if (!template) throw new Error(`The ${dir} adapter has no bootstrap`)
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await template.prepare({ session })
  if (JSON.stringify(commands) !== JSON.stringify(expected)) {
    throw new Error(
      `The ${dir} adapter's install commands changed; update the Dockerfile and HARNESSES: ${JSON.stringify(commands)}`
    )
  }
  console.log(`Wrote ${out}`)
}
