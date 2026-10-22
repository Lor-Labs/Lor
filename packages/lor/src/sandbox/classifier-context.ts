import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import type { AgentRunContext } from "@repo/db/schema"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import type { ClassifierInput } from "./classifier"
import { protectedPathReason } from "./command-policy"
import { type Argv, commandName } from "./shell-parse"

export const CLASSIFIER_TEXT_LIMIT = 12_000
const FACT_LIMIT = 8_000
const REQUEST_MESSAGES = 3
const SCRIPT_INTERPRETERS = new Set([
  "bash",
  "sh",
  "zsh",
  "python",
  "python3",
  "node",
  "bun",
  "deno",
  "ruby",
  "perl",
  "source",
  ".",
])
const SHELLS = new Set(["bash", "sh", "zsh", "source", "."])
const INTERPRETER_FLAGS = new Set([
  "--",
  "-u",
  "-e",
  "-x",
  "-B",
  "-O",
  "-OO",
  "-I",
  "-E",
  "-S",
  "-s",
  "--no-warnings",
])
// bun and deno take a subcommand or package.json script unless given a file.
const SCRIPT_FILE = /\/|\.(?:[cm]?[jt]sx?|py|rb|pl|sh)$/
// A `cd` moves later commands only when it comes first in a plain chain and
// is followed by &&; in a subshell, branch, pipeline or nested script it
// would make the evidence describe the wrong folder.
const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|<>()]+)\s*&&/
const GIT_STATUS =
  "set -o pipefail; /usr/bin/timeout 3 /usr/bin/env -i PATH=/usr/bin:/bin HOME=/nonexistent GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_OPTIONAL_LOCKS=0 /usr/bin/git --no-pager -c core.fsmonitor=false -c core.untrackedCache=false status --porcelain=v1 --untracked-files=normal --ignore-submodules=all | /usr/bin/head -c 8001"

// The latest messages of the person who started the turn, never someone
// else's or Lor's. Voice runs have no trigger id: their last turn is the
// speaker's request.
export function sandboxRequest(
  context: Pick<AgentRunContext, "conversation" | "triggerMessageId">
): string {
  const { conversation, triggerMessageId } = context
  const at = triggerMessageId
    ? conversation.findIndex((turn) => turn.messageId === triggerMessageId)
    : conversation.length - 1
  const trigger = conversation[at]
  if (!trigger || (!triggerMessageId && trigger.authorName === "Lor")) return ""
  return conversation
    .slice(0, at + 1)
    .filter((turn) => turn.authorName === trigger.authorName)
    .slice(-REQUEST_MESSAGES)
    .map((turn) => turn.content)
    .join("\n\n")
}

export function stringArg(input: unknown, key: string): string {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)[key]
      : undefined
  return typeof value === "string" ? value : ""
}

export function callSubject(
  toolName: string,
  input: unknown,
  workDir: string
): string {
  const subject =
    toolName === "bash"
      ? stringArg(input, "command")
      : stringArg(input, "file_path")
  if (!subject && !["bash", "write", "edit"].includes(toolName)) {
    return JSON.stringify(input) ?? ""
  }
  return toolName === "bash" || subject.startsWith("~")
    ? subject
    : posix.resolve(workDir, subject)
}

// The file an interpreter runs. Options before it must be known; the
// script's own arguments after it are ignored. Null when no file runs (an
// inline program, `python -m`, a bun or deno subcommand); undefined when it
// cannot be told.
function scriptTarget(name: string, args: Argv): string | null | undefined {
  const packageRunner = name === "bun" || name === "deno"
  const rest = packageRunner && args[0] === "run" ? args.slice(1) : args
  for (const arg of rest) {
    if (arg == null) return undefined
    if (
      /^-[a-z]*c[a-z]*$/.test(arg) ||
      (!SHELLS.has(name) && ["-e", "--eval", "-p", "--print"].includes(arg)) ||
      arg.startsWith("--eval=") ||
      (name.startsWith("python") && arg === "-m")
    ) {
      return null
    }
    if (!arg.startsWith("-")) {
      return packageRunner && !SCRIPT_FILE.test(arg) ? null : arg
    }
    if (!INTERPRETER_FLAGS.has(arg)) return undefined
  }
  return null
}

// Read bounded evidence with fixed commands. Never run a proposed command to
// inspect it; git status disables executable config and submodule traversal.
export async function classifierFacts(
  input: ClassifierInput,
  plain: boolean,
  sandbox: Pick<SandboxSession, "run"> | undefined,
  signal?: AbortSignal
): Promise<Pick<ClassifierInput, "sandboxFacts" | "incomplete">> {
  if (input.call.toolName !== "bash") return {}
  const commands = input.call.subcommands ?? []
  const dirs = new Set<string>()
  const scripts = new Set<string>()
  let cwd = input.workDir
  let incomplete = false
  for (const [index, argv] of commands.entries()) {
    const name = commandName(argv)
    if (
      name === "pushd" ||
      name === "popd" ||
      (name === "env" &&
        argv.some((arg) => arg === "-C" || arg?.startsWith("--chdir")))
    ) {
      incomplete = true
    }
    if (name === "cd") {
      const dir = argv[1]
      if (
        index !== 0 ||
        !plain ||
        !LEADING_CD.test(input.call.subject) ||
        !dir ||
        dir.startsWith("-") ||
        dir.startsWith("~")
      ) {
        incomplete = true
      } else {
        cwd = posix.resolve(cwd, dir)
      }
    }
    if (
      name === "git" &&
      argv.some((arg) =>
        ["reset", "clean", "checkout", "restore", "stash", "branch"].includes(
          arg ?? ""
        )
      )
    ) {
      let dir = cwd
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === "-C") {
          const next = argv[++i]
          if (next == null || next.startsWith("~")) incomplete = true
          else dir = posix.resolve(dir, next)
        }
        if (
          (argv[i]?.startsWith("-C") && argv[i] !== "-C") ||
          argv[i]?.startsWith("--git-dir") ||
          argv[i]?.startsWith("--work-tree")
        )
          incomplete = true
      }
      dirs.add(dir)
    }
    const first = argv[0]
    if (
      first?.includes("/") &&
      !first.startsWith("/usr/") &&
      !first.startsWith("/bin/")
    ) {
      scripts.add(posix.resolve(cwd, first))
    } else if (name && SCRIPT_INTERPRETERS.has(name)) {
      const target = scriptTarget(name, argv.slice(1))
      if (target === undefined) incomplete = true
      else if (target) scripts.add(posix.resolve(cwd, target))
    }
  }
  if (incomplete || dirs.size + scripts.size > 4) return { incomplete: true }
  if (dirs.size + scripts.size === 0) return {}
  if (!sandbox) return { incomplete: true }
  const read = async (command: string, dir: string) => {
    const timeout = AbortSignal.timeout(4_000)
    const result = await sandbox.run({
      command,
      workingDirectory: dir,
      abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    if (result.exitCode !== 0 || result.stdout.length > FACT_LIMIT)
      incomplete = true
    return result.stdout.slice(0, FACT_LIMIT)
  }
  const inside = (path: string) =>
    (path.startsWith(`${input.workDir}/`) || path.startsWith("/tmp/")) &&
    !protectedPathReason(path)
  const [statuses, scriptFacts] = await Promise.all([
    Promise.all(
      [...dirs].map(async (dir) =>
        JSON.stringify({
          directory: dir,
          gitStatus: await read(GIT_STATUS, dir),
        })
      )
    ),
    Promise.all(
      [...scripts].map(async (file) => {
        if (!inside(file)) {
          incomplete = true
          return null
        }
        const resolved = (
          await read(
            `/usr/bin/timeout 3 /usr/bin/realpath -e -- ${shellQuote(file)}`,
            input.workDir
          )
        ).trim()
        if (!inside(resolved)) {
          incomplete = true
          return null
        }
        const content = await read(
          `/usr/bin/timeout 3 /usr/bin/head -c 8001 -- ${shellQuote(resolved)}`,
          input.workDir
        )
        return JSON.stringify({ script: file, resolved, content })
      })
    ),
  ])
  const sandboxFacts = [...statuses, ...scriptFacts]
    .filter((fact) => fact !== null)
    .join("\n")
  return {
    sandboxFacts: sandboxFacts.slice(0, CLASSIFIER_TEXT_LIMIT),
    incomplete: incomplete || sandboxFacts.length > CLASSIFIER_TEXT_LIMIT,
  }
}
