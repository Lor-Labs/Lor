import { posix } from "node:path"
import { shellQuote } from "@ai-sdk/harness/utils"
import { parseFrontmatter } from "@earendil-works/pi-coding-agent"
import type { HarnessCommand, HarnessCommandList } from "@repo/db/schema"
import type { Experimental_SandboxSession as SandboxSession } from "ai"
import { logger } from "./logger"

// Each harness's own slash commands and skills, as its CLI takes them
// (reference/skills-and-commands.md). Claude Code and Codex run in the
// sandbox and find the repo's skills themselves; Pi runs in the worker, so
// Lor finds them for it, as it does AGENTS.md (code-session.ts).

export type HarnessKind = "pi" | "claude_code" | "codex"

// A repo skill, prompt template or command file, by its frontmatter.
export type RepoCommandFile = {
  kind: "skill" | "template" | "command"
  name: string
  description: string
  argumentHint?: string
  // Sandbox path of the SKILL.md or the .md file.
  path: string
}

// Commands that reset the harness's conversation are left out: Lor saves it
// per turn for rewind and fork.
const EXCLUDED = new Set(["clear"])

// Claude Code's list until its first turn reports the real one.
const CLAUDE_CODE_BUILTINS: HarnessCommand[] = [
  {
    name: "compact",
    description: "Summarize the conversation to free up context",
    argumentHint: "[instructions]",
  },
  { name: "context", description: "Show what fills the context window" },
  { name: "init", description: "Write a CLAUDE.md for this repository" },
]

// Codex's terminal commands that mean something in a session; the rest are
// its own UI (model, status, diff), which Lor has.
const CODEX_COMMANDS: HarnessCommand[] = [
  {
    name: "compact",
    description: "Summarize the conversation to free up context",
  },
  {
    name: "review",
    description: "Review the uncommitted changes",
    argumentHint: "[instructions]",
  },
  { name: "init", description: "Write an AGENTS.md for this repository" },
]

const PI_COMMANDS: HarnessCommand[] = [
  {
    name: "compact",
    description: "Summarize the conversation to free up context",
    argumentHint: "[focus]",
  },
]

// Codex's own /init prompt (codex-rs/tui/assets/prompt_for_init_command.md,
// rust-v0.160.1).
export const CODEX_INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`

// Where each harness's CLI looks in a repo (the work folder is the repo
// root): Claude Code's skills and command files, the Agent Skills
// `.agents/skills` for Codex and Pi, Pi's own `.pi/skills` and prompts.
const SEARCH: Record<
  HarnessKind,
  { dir: string; kind: RepoCommandFile["kind"]; depth: number }[]
> = {
  claude_code: [
    { dir: ".claude/skills", kind: "skill", depth: 2 },
    { dir: ".claude/commands", kind: "command", depth: 3 },
  ],
  codex: [{ dir: ".agents/skills", kind: "skill", depth: 4 }],
  pi: [
    { dir: ".pi/skills", kind: "skill", depth: 4 },
    { dir: ".agents/skills", kind: "skill", depth: 4 },
    { dir: ".pi/prompts", kind: "template", depth: 1 },
  ],
}
const MAX_FILES = 200
const HEAD_BYTES = 4096
const RECORD = "\u001e"
const FIELD = "\u001f"

// Agent Skills names (agentskills.io/specification).
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// The repo's skills and command files for the harness, from one sandbox
// command that prints each file's head. A failure lists none.
export async function discoverRepoCommands(
  sandbox: SandboxSession,
  workDir: string,
  harness: HarnessKind,
  abortSignal?: AbortSignal
): Promise<RepoCommandFile[]> {
  const q = shellQuote
  const finds = SEARCH[harness].map(({ dir, kind, depth }) => {
    const name = kind === "skill" ? "-name SKILL.md" : "-name '*.md'"
    return `[ -d ${q(dir)} ] && find ${q(dir)} -maxdepth ${depth} -type f ${name} 2>/dev/null | sed 's|^|${kind}${FIELD}|'`
  })
  const command = [
    `cd ${q(workDir)} 2>/dev/null || exit 0`,
    `{ ${finds.join("; ")}; } | head -n ${MAX_FILES} | while IFS= read -r line; do`,
    `  f=\${line#*${FIELD}}`,
    `  printf '${RECORD}%s${FIELD}' "$line"`,
    `  head -c ${HEAD_BYTES} "$f"`,
    "done",
  ].join("\n")
  try {
    const result = await sandbox.run({
      command,
      ...(abortSignal ? { abortSignal } : {}),
    })
    // An unreadable file fails only its own record.
    return parseDiscovery(result.stdout, workDir)
  } catch (err) {
    if (abortSignal?.aborted) throw err
    logger.warn({ err, harness }, "Listing the repo's skills failed")
    return []
  }
}

function parseDiscovery(stdout: string, workDir: string): RepoCommandFile[] {
  const files: RepoCommandFile[] = []
  const seen = new Set<string>()
  for (const record of stdout.split(RECORD)) {
    const [kind, relative, head] = record.split(FIELD)
    if (!kind || !relative || head === undefined) continue
    if (kind !== "skill" && kind !== "template" && kind !== "command") continue
    const file = describeFile(kind, relative, head)
    if (!file || seen.has(`${file.kind}:${file.name}`)) continue
    seen.add(`${file.kind}:${file.name}`)
    files.push({ ...file, path: posix.join(workDir, relative) })
  }
  return files
}

function describeFile(
  kind: RepoCommandFile["kind"],
  relative: string,
  head: string
): Omit<RepoCommandFile, "path"> | null {
  let frontmatter: Record<string, unknown> = {}
  let body = head
  try {
    const parsed = parseFrontmatter(head)
    frontmatter = parsed.frontmatter
    body = parsed.body
  } catch {
    // A head cut inside the frontmatter, or invalid YAML: no metadata.
  }
  const text = (key: string) =>
    typeof frontmatter[key] === "string" ? frontmatter[key].trim() : ""
  const argumentHint = text("argument-hint")
  if (kind === "skill") {
    const name = text("name") || posix.basename(posix.dirname(relative))
    const description = text("description")
    // Both CLIs skip a skill without a description.
    if (!SKILL_NAME.test(name) || !description) return null
    if (frontmatter["user-invocable"] === false) return null
    return {
      kind,
      name,
      description,
      ...(argumentHint ? { argumentHint } : {}),
    }
  }
  const name = posix.basename(relative, ".md")
  if (!/^[\w.:-]+$/.test(name)) return null
  // Pi's and Claude Code's fallback: the first line of the body.
  const description =
    text("description") ||
    (body.split("\n").find((line) => line.trim()) ?? "").trim().slice(0, 80)
  return { kind, name, description, ...(argumentHint ? { argumentHint } : {}) }
}

// The "/" and "$" menus for a session: Claude Code's reported list (or its
// built-ins before the first report) with the repo's files; Codex's skills
// are "$" mentions.
export function harnessCommandList(
  harness: HarnessKind,
  repo: RepoCommandFile[],
  reported?: HarnessCommand[] | null
): HarnessCommandList {
  const entry = ({ name, description, argumentHint }: RepoCommandFile) => ({
    name,
    description,
    ...(argumentHint ? { argumentHint } : {}),
  })
  const allowed = (command: HarnessCommand) => !EXCLUDED.has(command.name)
  if (harness === "claude_code") {
    // The repo's files join its report: one added since still counts.
    const slash = uniqueByName([
      ...(reported?.length ? reported : CLAUDE_CODE_BUILTINS),
      ...repo.map(entry),
    ])
    return { slash: slash.filter(allowed), mentions: [] }
  }
  if (harness === "codex") {
    return {
      slash: CODEX_COMMANDS,
      mentions: repo.filter((f) => f.kind === "skill").map(entry),
    }
  }
  return {
    slash: uniqueByName([
      ...PI_COMMANDS,
      ...repo
        .filter((f) => f.kind === "skill")
        .map((f) => ({ ...entry(f), name: `skill:${f.name}` })),
      ...repo.filter((f) => f.kind === "template").map(entry),
    ]),
    mentions: [],
  }
}

function uniqueByName(commands: HarnessCommand[]): HarnessCommand[] {
  const seen = new Set<string>()
  return commands.filter((command) => {
    if (seen.has(command.name)) return false
    seen.add(command.name)
    return true
  })
}

// What a command turn runs instead of the conversation delta.
export type HarnessCommandTurn =
  // Sent to the harness exactly as typed (Claude Code; Codex's /init as its
  // own prompt).
  | { kind: "prompt"; text: string }
  | { kind: "compact"; instructions: string | null }
  // Codex only.
  | { kind: "review"; instructions: string | null }
  // Pi only: Lor expands these, since Pi's own expansion reads the worker's
  // disk.
  | { kind: "pi_skill"; file: RepoCommandFile; args: string }
  | { kind: "pi_template"; file: RepoCommandFile; args: string }

// A message is a command only when its first word names one the session's
// harness has; anything else ("/etc/hosts is wrong") is ordinary text.
export function parseHarnessCommand(
  text: string,
  harness: HarnessKind,
  list: HarnessCommandList,
  repo: RepoCommandFile[]
): HarnessCommandTurn | null {
  const match = text.trim().match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/)
  if (!match?.[1]) return null
  const name = match[1]
  const args = (match[2] ?? "").trim()
  if (EXCLUDED.has(name)) return null
  if (!list.slash.some((command) => command.name === name)) return null
  if (harness === "claude_code") return { kind: "prompt", text: text.trim() }
  if (name === "compact") return { kind: "compact", instructions: args || null }
  if (harness === "codex") {
    if (name === "review") return { kind: "review", instructions: args || null }
    if (name === "init") return { kind: "prompt", text: CODEX_INIT_PROMPT }
    return null
  }
  const skill = name.startsWith("skill:")
    ? repo.find((f) => f.kind === "skill" && f.name === name.slice(6))
    : undefined
  if (skill) return { kind: "pi_skill", file: skill, args }
  const template = repo.find((f) => f.kind === "template" && f.name === name)
  return template ? { kind: "pi_template", file: template, args } : null
}

// Pi's own `/skill:name args` and `/template args` expansion (pi-coding-agent
// 1.3.0 AgentSession._expandSkillCommand, expandPromptTemplate), with the
// file read from the sandbox.
export async function expandPiCommand(
  sandbox: SandboxSession,
  command: Extract<HarnessCommandTurn, { kind: "pi_skill" | "pi_template" }>
): Promise<string> {
  const content = await sandbox.readTextFile({ path: command.file.path })
  if (content === null) {
    throw new Error(`${command.file.path} is missing from the sandbox`)
  }
  let body = content
  try {
    body = parseFrontmatter(content).body
  } catch {
    // Pi sends a file with broken frontmatter whole, too.
  }
  if (command.kind === "pi_template") {
    return substituteArgs(body, parseCommandArgs(command.args))
  }
  const baseDir = posix.dirname(command.file.path)
  const block = `<skill name="${command.file.name}" location="${command.file.path}">\nReferences are relative to ${baseDir}.\n\n${body.trim()}\n</skill>`
  return command.args ? `${block}\n\n${command.args}` : block
}

// pi-coding-agent 1.3.0 core/prompt-templates.js (not exported).
function parseCommandArgs(argsString: string): string[] {
  const args: string[] = []
  let current = ""
  let hasToken = false
  let inQuote: string | null = null
  for (const char of argsString) {
    if (inQuote) {
      if (char === inQuote) inQuote = null
      else current += char
    } else if (char === '"' || char === "'") {
      inQuote = char
      hasToken = true
    } else if (/\s/.test(char)) {
      if (hasToken) {
        args.push(current)
        current = ""
        hasToken = false
      }
    } else {
      current += char
      hasToken = true
    }
  }
  if (hasToken) args.push(current)
  return args
}

function substituteArgs(content: string, args: string[]): string {
  const allArgs = args.join(" ")
  return content.replace(
    /\$\{(\d+|ARGUMENTS|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$(ARGUMENTS|@|\d+)/g,
    (
      _match,
      defaultTarget?: string,
      defaultValue?: string,
      sliceStart?: string,
      sliceLength?: string,
      simple?: string
    ) => {
      if (defaultTarget) {
        const value =
          defaultTarget === "@" || defaultTarget === "ARGUMENTS"
            ? allArgs
            : args[Number.parseInt(defaultTarget, 10) - 1]
        return value ? value : (defaultValue ?? "")
      }
      if (sliceStart) {
        const start = Math.max(0, Number.parseInt(sliceStart, 10) - 1)
        return sliceLength
          ? args
              .slice(start, start + Number.parseInt(sliceLength, 10))
              .join(" ")
          : args.slice(start).join(" ")
      }
      if (simple === "ARGUMENTS" || simple === "@") return allArgs
      return args[Number.parseInt(simple ?? "", 10) - 1] ?? ""
    }
  )
}
