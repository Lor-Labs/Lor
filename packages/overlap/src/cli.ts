// Standalone overlap watcher, no Lor needed: point it at two or more local
// clones of the same repository and it reports files with uncommitted edits
// in more than one of them.
//
//   pnpm --filter @repo/overlap watch ~/work/app ~/work/app-teammate
//   pnpm --filter @repo/overlap watch --all-owners --interval 5000 dirA dirB
//
// Each folder is one "session"; its owner is the folder's git user.email.
// Clones made by the same person only alert with --all-owners.

import { execFile } from "node:child_process"
import { basename, resolve } from "node:path"
import { promisify } from "node:util"
import { createMemoryStore } from "./store"
import { createOverlapTracker } from "./tracker"

const run = promisify(execFile)

async function git(dir: string, args: string[]) {
  const { stdout } = await run("git", ["-C", dir, ...args], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

async function gitOr(dir: string, args: string[], fallback: string) {
  try {
    return (await git(dir, args)).trim() || fallback
  } catch {
    return fallback
  }
}

// Paths with uncommitted changes, untracked files included.
export async function uncommittedFiles(dir: string): Promise<string[]> {
  const out = await git(dir, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ])
  const entries = out.split("\0")
  const files: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry || entry.length < 4) continue
    files.push(entry.slice(3))
    // Renames and copies are followed by their old path: moving a file away
    // overlaps with a teammate editing it.
    const x = entry[0]
    if (x === "R" || x === "C") {
      const oldPath = entries[++i]
      if (oldPath) files.push(oldPath)
    }
  }
  return files
}

function parseArgs(argv: string[]) {
  let intervalMs = 3_000
  let allOwners = false
  const dirs: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--interval") intervalMs = Number(argv[++i])
    else if (arg === "--all-owners") allOwners = true
    else if (arg) dirs.push(resolve(arg))
  }
  return { intervalMs, allOwners, dirs }
}

async function main() {
  const { intervalMs, allOwners, dirs } = parseArgs(process.argv.slice(2))
  if (dirs.length < 2 || !Number.isFinite(intervalMs) || intervalMs < 500) {
    console.error(
      "Usage: overlap-watch [--interval ms] [--all-owners] <clone> <clone> [...]"
    )
    process.exit(1)
  }

  const sessions = await Promise.all(
    dirs.map(async (dir) => ({
      dir,
      sessionId: dir,
      ownerId: await gitOr(dir, ["config", "user.email"], basename(dir)),
      scope: await gitOr(dir, ["remote", "get-url", "origin"], "local"),
    }))
  )
  const tracker = createOverlapTracker({
    store: createMemoryStore(),
    ignoreSameOwner: !allOwners,
  })

  console.log(`Watching ${dirs.length} folders every ${intervalMs} ms`)
  const tick = async () => {
    for (const session of sessions) {
      let files: string[]
      try {
        files = await uncommittedFiles(session.dir)
      } catch (err) {
        console.error(`Can't read ${session.dir}:`, (err as Error).message)
        continue
      }
      const { dir: _dir, ...report } = session
      for (const overlap of await tracker.report({ ...report, files })) {
        const mine = basename(overlap.mine.sessionId)
        const theirs = basename(overlap.theirs.sessionId)
        console.log(
          `\n⚠ Overlap: ${mine} (${overlap.mine.ownerId})` +
            ` and ${theirs} (${overlap.theirs.ownerId})` +
            ` are both editing:\n  ${overlap.paths.join("\n  ")}`
        )
      }
    }
  }
  // Waits for each pass to finish, so slow git reads never pile up.
  const loop = async () => {
    await tick()
    setTimeout(() => void loop(), intervalMs)
  }
  await loop()
}

void main()
