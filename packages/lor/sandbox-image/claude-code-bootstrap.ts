// Writes the Claude Code adapter's bootstrap into claude-code/ for the image:
// its sandbox bridge as Lor's patch leaves it, and the marker that tells the
// adapter the bootstrap is done, so a new sandbox skips it (pnpm install took
// about 7 s of a new session's first turn). The Dockerfile runs the install
// commands. Run it after changing the adapter or its patch, then `bl push`:
//   pnpm --filter @repo/lor exec tsx sandbox-image/claude-code-bootstrap.ts
// An image with an older marker still works: the adapter runs the bootstrap.
import { mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createHarnessSandboxTemplate } from "@ai-sdk/harness/agent"
import { createClaudeCode } from "@ai-sdk/harness-claude-code"
import type { Experimental_SandboxSession as SandboxSession } from "ai"

const HOME = "/root"
const BOOTSTRAP_DIR = `${HOME}/.ai-sdk-harness/.harness-bootstrap/claude-code`
// The Dockerfile runs these in BOOTSTRAP_DIR.
const INSTALL_COMMANDS = [
  "pnpm install --frozen-lockfile --store-dir .pnpm-store",
  "./node_modules/.bin/claude --version",
]
const out = join(import.meta.dirname, "claude-code")

const outPath = (path: string) => {
  if (!path.startsWith(`${BOOTSTRAP_DIR}/`)) {
    throw new Error(`Unexpected bootstrap path: ${path}`)
  }
  return join(out, path.slice(BOOTSTRAP_DIR.length + 1))
}
const unused = () => {
  throw new Error("The bootstrap does not use this")
}
const done = { exitCode: 0, stdout: "", stderr: "" }
const commands: string[] = []
// Stands in for a sandbox: files go to out/, install commands are recorded.
const session = {
  description: "Image build stand-in",
  run: async ({ command, workingDirectory }) => {
    if (command === 'printf "%s" "$HOME"') return { ...done, stdout: HOME }
    if (command === 'mkdir -p "$BOOTSTRAP_DIR"') return done
    if (workingDirectory !== BOOTSTRAP_DIR) {
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

const template = await createHarnessSandboxTemplate({
  harnesses: [createClaudeCode()],
})
if (!template) throw new Error("The Claude Code adapter has no bootstrap")
await rm(out, { recursive: true, force: true })
await mkdir(out, { recursive: true })
await template.prepare({ session })
if (JSON.stringify(commands) !== JSON.stringify(INSTALL_COMMANDS)) {
  throw new Error(
    `The adapter's install commands changed; update the Dockerfile and INSTALL_COMMANDS: ${JSON.stringify(commands)}`
  )
}
console.log(`Wrote ${out}`)
