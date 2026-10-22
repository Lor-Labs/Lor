import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import type * as TreeSitter from "@vscode/tree-sitter-wasm"

// Parses a `bash` tool command with tree-sitter-bash, so the sandbox policy
// judges every command it runs: nested in `$( )`, backticks, subshells,
// control flow, `bash -c` scripts, literal heredocs into a shell, and
// wrapper arguments (`sudo`, `env`,
// `xargs`, `find -exec`, …). Two jobs, kept apart as in Codex: `plain` proves
// a script is only plain words joined by && || ; |, and `hidden` names a
// construct that hides what runs. See reference/planned/sandbox-safety-research.md.

type Node = TreeSitter.Node

// UMD build: named ESM imports of it are not detected, so load it with require.
const require = createRequire(import.meta.url)
let parser: Promise<TreeSitter.Parser> | null = null

function bashParser(): Promise<TreeSitter.Parser> {
  parser ??= (async () => {
    const treeSitter = require("@vscode/tree-sitter-wasm") as typeof TreeSitter
    await treeSitter.Parser.init()
    const grammar = await readFile(
      require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm")
    )
    const language = await treeSitter.Language.load(new Uint8Array(grammar))
    const bash = new treeSitter.Parser()
    bash.setLanguage(language)
    return bash
  })().catch((err: unknown) => {
    parser = null
    throw err
  })
  return parser
}

// A simple command's arguments as literal strings; null where the value is
// computed at run time ($VAR, $( ), brace expansion, $'…').
export type Argv = (string | null)[]

export type ParsedShell = {
  commands: Argv[]
  // Static targets of write redirects (>, >>, &>, >|); null when computed.
  writes: (string | null)[]
  plain: boolean
  // Why the script hides what it runs, if it does.
  hidden: string | null
}

const MAX_DEPTH = 8
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"])
const INTERPRETERS = new Set([
  "python",
  "python3",
  "node",
  "perl",
  "ruby",
  "php",
  "bun",
  "deno",
  "lua",
])
const PLAIN_NODES = new Set([
  "program",
  "list",
  "pipeline",
  "command",
  "command_name",
  "word",
  "string",
  "string_content",
  "raw_string",
  "number",
  "concatenation",
  "redirected_statement",
  "file_redirect",
  "file_descriptor",
])
const PLAIN_TOKENS = new Set(["&&", "||", ";", "|", "\n", '"'])
// Codex's plain-word rule: no globs, braces, tilde, escapes or expansions.
const UNPLAIN_WORD = /[{}*?[\]\\~^#$`]|^=/
// Redirects that never write a file: to /dev/null, or between descriptors.
const HARMLESS_REDIRECT = /^\d*(>>?|&>>?|>\|)\s*\/dev\/null$|^\d*>&\d$/
const WRITE_REDIRECT = new Set([">", ">>", "&>", "&>>", ">|"])

export function commandName(argv: Argv): string | null {
  const name = argv[0]
  if (name == null) return null
  return name.includes("/") ? (name.split("/").pop() ?? name) : name
}

function staticValue(node: Node | null): string | null {
  if (!node) return null
  switch (node.type) {
    case "word":
      return node.text.replace(/\\(.)/gs, "$1")
    case "number":
      return node.text
    case "raw_string":
      return node.text.slice(1, -1)
    case "string": {
      const parts = node.namedChildren
      if (parts.some((part) => part?.type !== "string_content")) return null
      return parts
        .map((part) => part?.text ?? "")
        .join("")
        .replace(/\\([$`"\\\n])/g, "$1")
    }
    case "concatenation": {
      let text = ""
      for (const part of node.namedChildren) {
        const value = staticValue(part)
        if (value === null) return null
        text += value
      }
      return text
    }
    case "command_name":
      return staticValue(node.namedChild(0))
    default:
      return null
  }
}

function commandArgv(node: Node): Argv {
  const argv: Argv = [staticValue(node.childForFieldName("name"))]
  for (const arg of node.childrenForFieldName("argument")) {
    argv.push(staticValue(arg))
  }
  return argv
}

// The command a wrapper runs, with the wrapper's own options skipped.
// Undefined when argv is not a wrapper; [] when the wrapper runs nothing.
function unwrap(argv: Argv): Argv | undefined {
  const name = commandName(argv)
  const rest = argv.slice(1)
  const skip = (valued: Set<string>, extra?: (arg: string) => boolean) => {
    let i = 0
    while (i < rest.length) {
      const arg = rest[i]
      if (arg == null) return rest.slice(i)
      if (arg === "--") return rest.slice(i + 1)
      if (extra?.(arg)) {
        i++
        continue
      }
      if (!arg.startsWith("-") || arg === "-") return rest.slice(i)
      i += valued.has(arg) ? 2 : 1
    }
    return []
  }
  switch (name) {
    case "sudo":
    case "doas":
      return skip(new Set(["-u", "-g", "-h", "-p", "-C", "-U", "-r", "-t"]))
    case "env":
      return skip(new Set(["-u", "-C", "-S"]), (arg) =>
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)
      )
    case "command":
    case "builtin":
    case "exec":
    case "nohup":
    case "noglob":
    case "time":
      return skip(new Set(["-a"]))
    case "nice":
      return skip(new Set(["-n"]))
    case "stdbuf":
      return skip(new Set(["-i", "-o", "-e"]))
    case "timeout": {
      const inner = skip(new Set(["-s", "-k"]))
      return inner.slice(1)
    }
    case "xargs":
      return skip(
        new Set(["-I", "-n", "-P", "-L", "-s", "-d", "-E", "-a"]),
        (arg) => /^--[a-z-]+=/.test(arg)
      )
    case "find": {
      const at = rest.findIndex((arg) =>
        ["-exec", "-execdir", "-ok", "-okdir"].includes(arg ?? "")
      )
      if (at < 0) return undefined
      const after = rest.slice(at + 1)
      const end = after.findIndex((arg) => arg === ";" || arg === "+")
      return end < 0 ? after : after.slice(0, end)
    }
    default:
      return undefined
  }
}

// The script a shell runs with -c, -lc, -ic …: undefined when argv is not a
// shell -c call; null when the script is computed.
function shellScript(argv: Argv): string | null | undefined {
  if (!SHELLS.has(commandName(argv) ?? "")) return undefined
  const at = argv.findIndex(
    (arg, i) => i > 0 && arg != null && /^-[a-z]*c[a-z]*$/.test(arg)
  )
  if (at < 0) return undefined
  return argv[at + 1] ?? null
}

// A shell or interpreter that reads its program from stdin.
function readsProgramFromStdin(argv: Argv): boolean {
  const name = commandName(argv) ?? ""
  if (!SHELLS.has(name) && !INTERPRETERS.has(name)) return false
  const positional = argv.slice(1).filter((arg) => arg !== null)
  return (
    positional.length === 0 ||
    positional.includes("-") ||
    positional.includes("-s") ||
    positional.every((arg) => arg.startsWith("-"))
  )
}

const DYNAMIC_BODY = ["expansion", "simple_expansion", "command_substitution"]

// The program an interpreter that reads stdin gets. A heredoc or here-string
// with a literal body is in the call itself, like `-c`; a pipe, an input
// file or a body with expansions hides what runs. Null when nothing feeds
// stdin. A heredoc without a body node (another grammar version) is hidden.
function stdinProgram(node: Node): string | "hidden" | null {
  if (inPipelineAfterFirst(node)) return "hidden"
  const redirects = [
    ...node.childrenForFieldName("redirect"),
    ...(node.parent?.type === "redirected_statement"
      ? node.parent.childrenForFieldName("redirect")
      : []),
  ]
  let program: string | null = null
  for (const redirect of redirects) {
    if (!redirect) continue
    if (redirect.type === "heredoc_redirect") {
      const body = redirect.namedChildren.find(
        (child) => child?.type === "heredoc_body"
      )
      if (
        !body ||
        DYNAMIC_BODY.some((type) => body.descendantsOfType(type).length > 0)
      ) {
        return "hidden"
      }
      program = body.text
    } else if (redirect.type === "herestring_redirect") {
      const value = staticValue(
        redirect.namedChildren.find(
          (child) => child?.type !== "file_descriptor"
        ) ?? null
      )
      if (value === null) return "hidden"
      program = value
    } else if (redirect.type === "file_redirect") {
      const op = redirect.children.find((c) => c && !c.isNamed)?.type ?? ""
      if (op.startsWith("<")) return "hidden"
    }
  }
  return program
}

function inPipelineAfterFirst(node: Node): boolean {
  let child = node
  let parent = node.parent
  while (parent?.type === "redirected_statement") {
    child = parent
    parent = parent.parent
  }
  return parent?.type === "pipeline" && parent.namedChild(0)?.id !== child.id
}

function isPlain(root: Node): boolean {
  const stack: Node[] = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.isNamed) {
      if (!PLAIN_NODES.has(node.type)) return false
      if (node.type === "word" && UNPLAIN_WORD.test(node.text)) return false
      if (
        node.type === "file_redirect" &&
        !HARMLESS_REDIRECT.test(node.text.replace(/\s+/g, ""))
      ) {
        return false
      }
      if (node.type === "file_redirect") continue
    } else if (!PLAIN_TOKENS.has(node.type)) {
      return false
    }
    for (const child of node.children) if (child) stack.push(child)
  }
  return true
}

function collect(
  root: Node,
  depth: number,
  out: ParsedShell,
  nested: { script: string; depth: number }[]
) {
  for (const redirect of root.descendantsOfType("file_redirect")) {
    if (!redirect) continue
    const op = redirect.children.find((c) => c && !c.isNamed)?.type ?? ""
    const destination = redirect.childForFieldName("destination")
    if (!WRITE_REDIRECT.has(op)) continue
    if (HARMLESS_REDIRECT.test(redirect.text.replace(/\s+/g, ""))) continue
    out.writes.push(staticValue(destination))
  }
  for (const node of root.descendantsOfType("command")) {
    if (!node) continue
    let argv: Argv | undefined = commandArgv(node)
    for (let level = depth; argv && argv.length > 0; level++) {
      if (level > MAX_DEPTH) {
        out.hidden ??= "nests commands too deeply to check"
        break
      }
      out.commands.push(argv)
      const name = commandName(argv)
      if (name === null) {
        out.hidden ??= "runs a command whose name is computed"
      } else if (name === "eval") {
        out.hidden ??= "uses eval"
      } else if (
        (name === "source" || name === ".") &&
        argv.slice(1).some((arg) => arg === null)
      ) {
        out.hidden ??= "runs a computed script"
      }
      const script = shellScript(argv)
      if (script === null) out.hidden ??= "runs a computed shell script"
      else if (script !== undefined) nested.push({ script, depth: level + 1 })
      else if (readsProgramFromStdin(argv)) {
        // A literal heredoc into a shell is a script to check like `-c`;
        // into another interpreter it is inline code, like `python3 -c`.
        const program = stdinProgram(node)
        if (program === "hidden") {
          out.hidden ??= "pipes into a shell or interpreter"
        } else if (program !== null && SHELLS.has(name ?? "")) {
          nested.push({ script: program, depth: level + 1 })
        }
      }
      if (
        (SHELLS.has(name ?? "") ||
          INTERPRETERS.has(name ?? "") ||
          name === "source" ||
          name === ".") &&
        node.descendantsOfType("process_substitution").length > 0
      ) {
        out.hidden ??= "runs a downloaded or computed script"
      }
      argv = unwrap(argv)
    }
  }
}

// Null when the script cannot be parsed.
export async function parseShell(command: string): Promise<ParsedShell | null> {
  const bash = await bashParser()
  const out: ParsedShell = {
    commands: [],
    writes: [],
    plain: true,
    hidden: null,
  }
  const pending = [{ script: command, depth: 0 }]
  while (pending.length > 0) {
    const next = pending.shift()
    if (!next) break
    if (next.depth > MAX_DEPTH) {
      out.hidden ??= "nests commands too deeply to check"
      break
    }
    const tree = bash.parse(next.script)
    if (!tree) return null
    try {
      if (tree.rootNode.hasError) return null
      if (next.depth > 0 || !isPlain(tree.rootNode)) out.plain = false
      collect(tree.rootNode, next.depth, out, pending)
    } finally {
      tree.delete()
    }
  }
  return out
}
