import path from "node:path"
import {
  type Argv,
  commandName,
  type ParsedShell,
  parseShell,
} from "./shell-parse"

// How a sandbox call is classed before the turn's mode decides
// (reference/planned/pi-harness-runbook.md §4.6 sandbox safety policy):
// hard is denied in every mode; flagged asks, is refused in autonomous runs,
// or goes to the classifier; safe never asks; routine asks only in
// Manual mode. Reasons complete the sentence "This …".
export type SandboxCheck =
  | { kind: "hard"; reason: string }
  | { kind: "flagged"; reason: string }
  | { kind: "safe" }
  | { kind: "routine" }

export type PolicyContext = {
  // The conversation's work folder; relative paths resolve from it.
  workDir: string
}

const ROUTINE: SandboxCheck = { kind: "routine" }
const MAX_COMMAND_CHARS = 10_000
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]/
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this detects
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const METADATA = /169\.254\.\d+\.\d+|metadata\.google\.internal|fd00:ec2::254/i
const FORK_BOMB = /(\S+)\s*\(\)\s*\{\s*\1\s*\|\s*\1\s*&\s*\};?\s*\1/
const BYPASS_FLAGS = new Set([
  "--dangerously-skip-permissions",
  "--dangerously-bypass-approvals-and-sandbox",
  "--yolo",
  "--trust-all-tools",
])
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

// Codex's last known-safe list (is_safe_command.rs @ 1b450c7), without git:
// a repo's config can make read-only git commands run code.
const SAFE_COMMANDS = new Set([
  "cat",
  "cd",
  "cut",
  "echo",
  "expr",
  "false",
  "grep",
  "head",
  "id",
  "ls",
  "nl",
  "paste",
  "pwd",
  "rev",
  "seq",
  "stat",
  "tail",
  "tr",
  "true",
  "uname",
  "uniq",
  "wc",
  "which",
  "whoami",
  "numfmt",
  "tac",
])

function isSafe(argv: Argv): boolean {
  const name = commandName(argv)
  const args = argv.slice(1)
  if (name === null || args.some((arg) => arg === null)) return false
  const words = args as string[]
  if (SAFE_COMMANDS.has(name)) return true
  switch (name) {
    case "base64":
      return !words.some((arg) => /^(-o|--output)/.test(arg))
    case "find":
      return !words.some((arg) =>
        [
          "-exec",
          "-execdir",
          "-ok",
          "-okdir",
          "-delete",
          "-fls",
          "-fprint",
          "-fprint0",
          "-fprintf",
        ].includes(arg)
      )
    case "rg":
      return !words.some((arg) =>
        /^(--pre|--hostname-bin|--search-zip|-z$|-[a-zA-Z]*z)/.test(arg)
      )
    case "sed":
      return (
        words.length <= 3 &&
        words[0] === "-n" &&
        /^\d+(,\d+)?p$/.test(words[1] ?? "")
      )
    default:
      return false
  }
}

// Positionals of a command: its words that are not options.
function positionals(argv: Argv): (string | null)[] {
  const out: (string | null)[] = []
  let options = true
  for (const arg of argv.slice(1)) {
    if (options && arg === "--") {
      options = false
      continue
    }
    if (options && arg?.startsWith("-") && arg !== "-") continue
    out.push(arg)
  }
  return out
}

function hasFlag(argv: Argv, long: string[], short: string): boolean {
  return argv
    .slice(1)
    .some(
      (arg) =>
        arg != null &&
        (long.some((flag) => arg === flag || arg.startsWith(`${flag}=`)) ||
          (short !== "" &&
            /^-[a-zA-Z]+$/.test(arg) &&
            [...short].some((letter) => arg.includes(letter))))
    )
}

function resolvePath(target: string, ctx: PolicyContext): string {
  if (target === "~" || target.startsWith("~/")) {
    return `~${path.posix.normalize(target.slice(1) || "/")}`
  }
  return path.posix.resolve(ctx.workDir, target)
}

// rm targets whose loss is the whole session's work or the system.
function isCriticalTarget(target: string, ctx: PolicyContext): boolean {
  const dir =
    target.replace(/\/?\*$/, "") || (target.startsWith("/") ? "/" : ".")
  const resolved = resolvePath(dir, ctx)
  if (resolved === "~" || resolved === "~/") return true
  return (
    resolved === "/" ||
    resolved === "/workspace" ||
    resolved === ctx.workDir ||
    ctx.workDir.startsWith(`${resolved}/`)
  )
}

// Files a person should see a change to before it happens. Case-folded, as
// case-insensitive filesystems would treat them (CVE-2025-59944).
export function protectedPathReason(absolute: string): string | null {
  const lower = absolute.toLowerCase()
  const segments = lower.split("/").filter(Boolean)
  const base = segments.at(-1) ?? ""
  if (segments.includes(".git")) return "changes git internals"
  if (
    (base === ".env" || base.startsWith(".env.")) &&
    !/\.(example|sample|template|dist|defaults)$/.test(base)
  ) {
    return "changes an environment file"
  }
  if (
    base.endsWith(".pem") ||
    base.startsWith("id_") ||
    [".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(base) ||
    segments.some((s) => [".ssh", ".aws", ".gnupg"].includes(s))
  ) {
    return "changes a credentials file"
  }
  if (
    [
      ".bashrc",
      ".bash_profile",
      ".bash_login",
      ".profile",
      ".zshrc",
      ".zprofile",
      ".zshenv",
      ".zlogin",
    ].includes(base)
  ) {
    return "changes a shell startup file"
  }
  if (lower.includes("/.github/workflows/")) return "changes a CI workflow"
  if (
    [
      "agents.md",
      "claude.md",
      "gemini.md",
      ".mcp.json",
      ".cursorrules",
      ".windsurfrules",
      ".clinerules",
    ].includes(base) ||
    segments.some((s) =>
      [".pi", ".claude", ".cursor", ".vscode", ".codex", ".gemini"].includes(s)
    )
  ) {
    return "changes an agent config or instruction file"
  }
  return null
}

// Paths a command writes, beyond its redirects.
function writeTargets(argv: Argv): (string | null)[] {
  const name = commandName(argv)
  const files = positionals(argv)
  switch (name) {
    case "cp":
    case "mv":
    case "install":
      return files.slice(-1)
    case "ln":
      // Both ends: a link into a protected folder makes later writes land there.
      return files
    case "tee":
    case "touch":
    case "mkdir":
    case "truncate":
    case "rm":
    case "rmdir":
    case "chmod":
    case "chown":
      return files
    case "sed":
      return hasFlag(argv, ["--in-place"], "i") ? files.slice(1) : []
    case "dd":
      return argv
        .slice(1)
        .filter((arg) => arg?.startsWith("of="))
        .map((arg) => arg?.slice(3) ?? null)
    default:
      return []
  }
}

const GIT_CODE_KEYS =
  /^(core\.(hookspath|pager|fsmonitor|sshcommand|editor|askpass|gitproxy)|credential\..*helper|diff\.external|.*\.textconv|filter\..*|alias\..*|sequence\.editor|gpg\..*program|pager\..*)$/i

function gitCheck(argv: Argv): string | null {
  const args = argv.slice(1)
  let i = 0
  while (i < args.length) {
    const arg = args[i]
    if (arg == null) return "runs git with a computed option"
    if (arg === "-c") {
      const key = args[i + 1]?.split("=")[0] ?? ""
      if (GIT_CODE_KEYS.test(key)) return "sets a git option that runs code"
      i += 2
      continue
    }
    if (/^--(exec-path|config-env)/.test(arg)) {
      return "sets a git option that runs code"
    }
    if (arg === "-C") {
      i += 2
      continue
    }
    if (!arg.startsWith("-")) break
    i++
  }
  const sub = args[i]
  const rest = args.slice(i + 1)
  const has = (...words: string[]) => rest.some((a) => words.includes(a ?? ""))
  switch (sub) {
    case "push":
      return "pushes to a remote"
    case "reset":
      return has("--hard", "--merge", "--keep") ? "discards changes" : null
    case "clean":
      return rest.some((a) => a != null && /^(-[a-zA-Z]*f|--force)/.test(a))
        ? "deletes untracked files"
        : null
    case "checkout":
    case "restore":
      return has(".", ":/", "-f", "--force") ? "discards changes" : null
    case "stash":
      return has("drop", "clear") ? "deletes stashed changes" : null
    case "branch":
      return has("-D") || (has("-d", "--delete") && has("-f", "--force"))
        ? "deletes a branch"
        : null
    case "remote":
      return has("add", "set-url") ? "changes git remotes" : null
    case "config":
      return rest.some((a) => a != null && GIT_CODE_KEYS.test(a))
        ? "sets a git option that runs code"
        : null
    default:
      return null
  }
}

function remoteHost(argv: Argv): string | null | undefined {
  const args = argv.slice(1)
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg == null) continue
    if (["-h", "--host", "-H"].includes(arg)) return args[i + 1] ?? null
    const inline = /^(?:--host=|-h)(.+)$/.exec(arg)
    if (inline?.[1]) return inline[1]
    const url = /^[a-z+]+:\/\/(?:[^@/]*@)?([^:/?]+)/i.exec(arg)
    if (url?.[1]) return url[1]
  }
  return undefined
}

const DEPLOY_VERBS = new Set([
  "deploy",
  "up",
  "destroy",
  "publish",
  "release",
  "rollback",
  "promote",
])
const READ_VERBS = new Set(["list", "ls", "describe", "get", "view", "status"])

// The rule that flags a command, if any.
function flagReason(argv: Argv): string | null {
  const name = commandName(argv)
  const args = argv.slice(1)
  const words = positionals(argv)
  const first = words[0] ?? null
  const has = (...flags: string[]) => args.some((a) => flags.includes(a ?? ""))
  if (args.some((a) => a === "--privileged" || a?.includes("docker.sock"))) {
    return "changes privileges, disks or the network"
  }
  switch (name) {
    case "rm":
      return hasFlag(argv, ["--recursive", "--force"], "rRf") ||
        words.some((w) => w == null || /[*?[]/.test(w))
        ? "deletes files"
        : null
    case "shred":
    case "mkfs":
    case "fdisk":
    case "parted":
    case "mount":
    case "umount":
    case "sudo":
    case "doas":
    case "su":
    case "chroot":
    case "iptables":
    case "ip6tables":
    case "nft":
    case "insmod":
    case "modprobe":
      return "changes privileges, disks or the network"
    case "dd":
      return args.some((a) => a?.startsWith("of=/dev/"))
        ? "changes privileges, disks or the network"
        : null
    case "git":
      return gitCheck(argv)
    case "npm":
    case "pnpm":
    case "yarn":
    case "bun":
      return words.some((w) =>
        ["publish", "unpublish", "deprecate", "dist-tag"].includes(w ?? "")
      )
        ? "publishes a package"
        : null
    case "cargo":
    case "poetry":
    case "uv":
      return first === "publish" ? "publishes a package" : null
    case "twine":
      return first === "upload" ? "publishes a package" : null
    case "gem":
      return first === "push" ? "publishes a package" : null
    case "docker":
    case "podman":
      return first === "push" ? "publishes a container image" : null
    case "terraform":
    case "tofu":
      return first === "apply" || first === "destroy"
        ? "changes cloud infrastructure"
        : null
    case "kubectl":
      return first !== null &&
        ![
          "get",
          "describe",
          "logs",
          "top",
          "explain",
          "version",
          "api-resources",
          "api-versions",
          "cluster-info",
        ].includes(first)
        ? "changes a Kubernetes cluster"
        : null
    case "helm":
      return ["install", "upgrade", "uninstall", "delete", "rollback"].includes(
        first ?? ""
      )
        ? "changes a Kubernetes cluster"
        : null
    case "vercel":
      return first === null ||
        !["ls", "list", "inspect", "logs", "whoami", "env", "help"].includes(
          first
        )
        ? "deploys or changes a hosted project"
        : null
    case "netlify":
    case "fly":
    case "flyctl":
    case "railway":
    case "firebase":
    case "wrangler":
    case "serverless":
    case "sls":
    case "cdk":
    case "pulumi":
    case "sam":
    case "amplify":
    case "heroku":
      return words.some((w) => DEPLOY_VERBS.has(w ?? ""))
        ? "deploys or changes a hosted project"
        : null
    case "aws": {
      const op = words[1] ?? null
      if (first === "s3") {
        return ["cp", "mv", "rm", "sync", "mb", "rb"].includes(op ?? "")
          ? "changes cloud resources"
          : null
      }
      return op !== null && !/^(describe|list|get|head)-|^(help|wait)$/.test(op)
        ? "changes cloud resources"
        : null
    }
    case "gcloud":
      return words.some(
        (w) => w != null && (READ_VERBS.has(w) || /^get-/.test(w))
      ) || words.some((w) => w === "info" || w === "version")
        ? null
        : "changes cloud resources"
    case "gh": {
      if (first === "api") {
        return has("-f", "-F", "--field", "--raw-field", "--input") ||
          args.some(
            (a, i) =>
              (a === "-X" || a === "--method") &&
              !/^GET$/i.test(args[i + 1] ?? "")
          )
          ? "changes GitHub"
          : null
      }
      return first === "auth" ||
        first === "status" ||
        READ_VERBS.has(words[1] ?? "") ||
        ["diff", "checks"].includes(words[1] ?? "")
        ? null
        : "changes GitHub"
    }
    case "stripe":
      return words.some(
        (w) =>
          w != null &&
          (READ_VERBS.has(w) || ["listen", "logs", "retrieve"].includes(w))
      )
        ? null
        : "changes Stripe"
    case "psql":
    case "mysql":
    case "mariadb":
    case "mongosh":
    case "mongo":
    case "redis-cli":
    case "sqlcmd":
    case "clickhouse-client":
    case "cqlsh": {
      const host = remoteHost(argv)
      if (host === undefined) return null
      return host !== null && LOCAL_HOSTS.has(host.toLowerCase())
        ? null
        : "connects to a remote database"
    }
    case "ssh":
      return has("-R", "-L", "-D")
        ? "opens a network tunnel"
        : "connects to a remote host"
    case "scp":
    case "sftp":
    case "ftp":
    case "telnet":
      return "connects to a remote host"
    case "rsync":
      return words.some((w) => w == null || /^[^/]*:|^rsync:\/\//.test(w))
        ? "connects to a remote host"
        : null
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
      return has("-l", "--listen")
        ? "opens a network listener"
        : "connects to a remote host"
    case "crontab":
      return has("-l") ? null : "changes scheduled jobs"
    case "systemctl":
      return first !== null && !/^(status|show|cat|list-.*|is-.*)$/.test(first)
        ? "changes system services"
        : null
    case "launchctl":
    case "at":
    case "batch":
      return "changes scheduled jobs"
    case "ngrok":
    case "cloudflared":
    case "lt":
    case "localtunnel":
    case "bore":
    case "frpc":
      return "opens a network tunnel"
    case "nmap":
    case "masscan":
    case "zmap":
    case "nikto":
      return "scans the network"
    default:
      return null
  }
}

function isHarnessState(target: string): boolean {
  return /(^|\/)\.ai-sdk(\/|$)/.test(target)
}

// The check plus the parse it used (null when the command was not parsed),
// so the classifier reads the same subcommands.
export async function checkCommand(
  command: string,
  ctx: PolicyContext
): Promise<{ check: SandboxCheck; parsed: ParsedShell | null }> {
  const early = (check: SandboxCheck) => ({ check, parsed: null })
  if (INVISIBLE.test(command)) {
    return early({ kind: "hard", reason: "contains invisible characters" })
  }
  if (METADATA.test(command)) {
    return early({ kind: "hard", reason: "reaches the cloud metadata address" })
  }
  if (command.length > MAX_COMMAND_CHARS) {
    return early({ kind: "flagged", reason: "is too long to check" })
  }
  if (CONTROL.test(command)) {
    return early({ kind: "flagged", reason: "contains control characters" })
  }
  const parsed = await parseShell(command).catch(() => null)
  if (!parsed) return early({ kind: "flagged", reason: "could not be parsed" })
  return { check: checkParsed(command, parsed, ctx), parsed }
}

function checkParsed(
  command: string,
  parsed: ParsedShell,
  ctx: PolicyContext
): SandboxCheck {
  const writes = [...parsed.writes, ...parsed.commands.flatMap(writeTargets)]
  for (const argv of parsed.commands) {
    if (argv.some((arg) => arg != null && BYPASS_FLAGS.has(arg))) {
      return {
        kind: "hard",
        reason: "runs an agent with its permission checks turned off",
      }
    }
    if (
      commandName(argv) === "rm" &&
      positionals(argv).some((t) => t != null && isCriticalTarget(t, ctx))
    ) {
      return { kind: "hard", reason: "deletes the whole work folder or system" }
    }
  }
  if (writes.some((target) => target != null && isHarnessState(target))) {
    return { kind: "hard", reason: "changes Lor's saved conversation files" }
  }

  if (parsed.hidden) return { kind: "flagged", reason: parsed.hidden }
  if (FORK_BOMB.test(command)) {
    return { kind: "flagged", reason: "is a fork bomb" }
  }
  for (const argv of parsed.commands) {
    const reason = flagReason(argv)
    if (reason) return { kind: "flagged", reason }
  }
  for (const target of writes) {
    if (target === null) continue
    const reason = protectedPathReason(resolvePath(target, ctx))
    if (reason) return { kind: "flagged", reason }
  }

  return parsed.plain && parsed.commands.every(isSafe)
    ? { kind: "safe" }
    : ROUTINE
}

// `write` and `edit`: inside the work folder or /tmp and not protected is
// routine. Paths are resolved lexically; a symlink into a protected folder
// has to be made with `ln`, which the command check flags.
export function checkFileWrite(
  filePath: string,
  ctx: PolicyContext
): SandboxCheck {
  const absolute = resolvePath(filePath, ctx)
  if (isHarnessState(absolute)) {
    return { kind: "hard", reason: "changes Lor's saved conversation files" }
  }
  const reason = protectedPathReason(absolute)
  if (reason) return { kind: "flagged", reason }
  const inside = [ctx.workDir, "/tmp"].some(
    (root) => absolute === root || absolute.startsWith(`${root}/`)
  )
  return inside
    ? ROUTINE
    : { kind: "flagged", reason: "writes outside the work folder" }
}
