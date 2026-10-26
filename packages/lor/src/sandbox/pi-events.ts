import type { LorToolCall } from "@repo/db/schema"

type PiFileDiff = NonNullable<LorToolCall["diff"]>

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined
}

export function piToolLabel(name: string, input: unknown): string {
  const args = asRecord(input)
  // Through the harness adapter, read/write/edit name the file `file_path`.
  const path = asString(args?.file_path) ?? asString(args?.path)
  const pattern = asString(args?.pattern)

  switch (name.toLowerCase()) {
    case "read":
      return path ? `Read ${path}` : "Read a file"
    case "grep":
      return pattern ? `Searched for “${pattern}”` : "Searched the code"
    case "find":
      return pattern ? `Listed files: ${pattern}` : "Listed files"
    case "ls":
      return path ? `Listed ${path}` : "Listed a directory"
    case "write":
      return path ? `Wrote ${path}` : "Wrote a file"
    case "edit":
      return path ? `Edited ${path}` : "Edited a file"
    case "bash": {
      const command = asString(args?.command)
      return command ? `Ran ${command}` : "Ran a command"
    }
    default:
      return name
  }
}

const MAX_PATCH_CHARS = 12_000

// Bound a patch for transport/persistence, cutting on a line boundary.
function boundPatch(patch: string): Pick<PiFileDiff, "patch" | "truncated"> {
  if (patch.length <= MAX_PATCH_CHARS) return { patch }
  const cut = patch.lastIndexOf("\n", MAX_PATCH_CHARS)
  return {
    patch: patch.slice(0, cut > 0 ? cut : MAX_PATCH_CHARS),
    truncated: true,
  }
}

function countPatchLines(patch: string): {
  additions: number
  deletions: number
} {
  let additions = 0
  let deletions = 0
  // Only count inside @@ hunks: the ---/+++ file headers sit before the first
  // hunk, and a prefix check alone would also swallow real changes to source
  // lines that start with ++/--. A headerless patch has no hunk markers
  // either — then every +/- line counts.
  const lines = patch.split("\n")
  let inHunk = !lines.some((line) => line.startsWith("@@"))
  for (const line of lines) {
    if (line.startsWith("@@")) {
      inHunk = true
      continue
    }
    if (!inHunk) continue
    if (line.startsWith("+")) additions++
    else if (line.startsWith("-")) deletions++
  }
  return { additions, deletions }
}

// `write` carries the full file content in its start args — present it as an
// all-added diff, Codex-style.
function writeDiff(args: unknown): PiFileDiff | undefined {
  const rec = asRecord(args)
  const path = asString(rec?.path)
  const content = typeof rec?.content === "string" ? rec.content : undefined
  if (!path || content === undefined) return undefined
  const lines = content.split("\n")
  if (lines.at(-1) === "") lines.pop()
  return {
    path,
    additions: lines.length,
    deletions: 0,
    ...boundPatch(lines.map((l) => `+${l}`).join("\n")),
  }
}

const MAX_OUTPUT_CHARS = 4_000

function lines(text: string): string[] {
  if (text === "") return []
  const split = text.split("\n")
  if (split.at(-1) === "") split.pop()
  return split
}

// The adapter's write/edit results are plain text with no patch, so the diff
// comes from the call's arguments: write is all added; edit swaps old_string
// for new_string (no surrounding context).
function sandboxCallDiff(
  toolName: string,
  input: unknown
): PiFileDiff | undefined {
  const args = asRecord(input)
  const path = asString(args?.file_path)
  if (!path) return undefined
  if (toolName === "write") {
    return writeDiff({ path, content: args?.content })
  }
  if (toolName !== "edit") return undefined
  const before = args?.old_string
  const after = args?.new_string
  if (typeof before !== "string" || typeof after !== "string") return undefined
  const patch = [
    ...lines(before).map((line) => `-${line}`),
    ...lines(after).map((line) => `+${line}`),
  ].join("\n")
  return { path, ...countPatchLines(patch), ...boundPatch(patch) }
}

// The reason a call was not run (refused, or denied by a person), from its
// execution-denied output: an object for Lor's tools, JSON text for Pi's.
// Null for a call that ran.
export function deniedReason(output: unknown): string | null {
  let value = output
  if (typeof output === "string") {
    if (!output.startsWith('{"type":"execution-denied"')) return null
    try {
      value = JSON.parse(output)
    } catch {
      return ""
    }
  }
  const record = asRecord(value)
  if (record?.type !== "execution-denied") return null
  return asString(record.reason) ?? ""
}

export function notRunDetail(
  reason: string | undefined
): Pick<LorToolCall, "detail" | "status"> {
  return {
    status: "error",
    detail: { summary: reason ? `Not run: ${reason}` : "Not run" },
  }
}

// Claude Code's own tools beyond the ones it shares with Pi (read, write,
// edit, bash, grep, glob). Null for a name it does not have.
export function claudeCodeToolLabel(
  name: string,
  input: unknown
): string | null {
  const args = asRecord(input)
  switch (name) {
    case "webSearch": {
      const query = asString(args?.query)
      return query ? `Searched the web for “${query}”` : "Searched the web"
    }
    case "WebFetch": {
      const url = asString(args?.url)
      return url ? `Fetched ${url}` : "Fetched a page"
    }
    case "NotebookEdit": {
      const path = asString(args?.notebook_path)
      return path ? `Edited ${path}` : "Edited a notebook"
    }
    case "TodoWrite":
    case "TaskCreate":
    case "TaskUpdate":
      return "Updated the task list"
    case "TaskGet":
    case "TaskList":
      return "Read the task list"
    case "TaskOutput":
      return "Checked a background command"
    case "TaskStop":
      return "Stopped a background command"
    case "Monitor":
      return "Watched a command"
    case "Agent": {
      const description = asString(args?.description)
      return description ? `Ran a subagent: ${description}` : "Ran a subagent"
    }
    case "ToolSearch":
      return "Loaded tools"
    case "Skill": {
      const skill = asString(args?.skill)
      return skill ? `Used the ${skill} skill` : "Used a skill"
    }
    case "LSP":
      return "Queried the language server"
    default:
      return null
  }
}

type ClaudeCodePatchHunk = {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

function hunkPatch(path: string, hunks: unknown): PiFileDiff | undefined {
  if (!Array.isArray(hunks) || hunks.length === 0) return undefined
  const patch = (hunks as ClaudeCodePatchHunk[])
    .flatMap((hunk) => [
      `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      ...hunk.lines,
    ])
    .join("\n")
  return { path, ...countPatchLines(patch), ...boundPatch(patch) }
}

// Trail detail for one of Claude Code's own tools that ran. Its results are
// Claude Code's structured tool results (checked in the 7d-3 spike): bash
// `{ stdout, stderr }`, write `{ type, content, structuredPatch }`, edit
// `{ structuredPatch }`, WebFetch `{ result }`. Failures arrive as tool-error.
export function claudeCodeToolDetail(
  toolName: string,
  input: unknown,
  output: unknown
): Pick<LorToolCall, "detail" | "status" | "diff"> {
  const result = asRecord(output)
  const path = asString(asRecord(input)?.file_path)
  if (toolName === "write" || toolName === "edit") {
    const diff =
      (path && result?.type !== "create"
        ? hunkPatch(path, result?.structuredPatch)
        : undefined) ?? sandboxCallDiff(toolName, input)
    return { status: "ok", ...(diff ? { diff } : {}) }
  }
  if (toolName === "read" || toolName === "ToolSearch") return { status: "ok" }
  const text =
    typeof output === "string"
      ? output
      : toolName === "bash"
        ? [result?.stdout, result?.stderr]
            .filter((part) => typeof part === "string" && part)
            .join("\n")
        : (asString(result?.result) ?? asString(result?.content) ?? "")
  if (!text) return { status: "ok" }
  const summary =
    text.length <= MAX_OUTPUT_CHARS
      ? text
      : toolName === "bash"
        ? `…${text.slice(-MAX_OUTPUT_CHARS)}`
        : `${text.slice(0, MAX_OUTPUT_CHARS)}…`
  return { status: "ok", detail: { summary } }
}

// Trail detail for one of Pi's sandbox tools that ran, whose results arrive
// as text.
export function sandboxToolDetail(
  toolName: string,
  input: unknown,
  output: unknown
): Pick<LorToolCall, "detail" | "status" | "diff"> {
  const text = typeof output === "string" ? output : JSON.stringify(output)
  if (toolName === "write" || toolName === "edit") {
    const diff = sandboxCallDiff(toolName, input)
    return { status: "ok", ...(diff ? { diff } : {}) }
  }
  if (toolName === "read" || !text) return { status: "ok" }
  // bash keeps the tail (its exit line is last); searches keep the head.
  const exit = toolName === "bash" ? /\(exit (\d+)\)$/.exec(text) : null
  const summary =
    text.length <= MAX_OUTPUT_CHARS
      ? text
      : toolName === "bash"
        ? `…${text.slice(-MAX_OUTPUT_CHARS)}`
        : `${text.slice(0, MAX_OUTPUT_CHARS)}…`
  return {
    status: exit && exit[1] !== "0" ? "error" : "ok",
    detail: { summary },
  }
}
