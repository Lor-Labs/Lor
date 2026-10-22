import { writeFileSync } from "node:fs"
import { closeDb } from "@repo/db"
import type { TurnSandboxMode } from "@repo/db/schema"
import type { SandboxClassifier } from "../../sandbox/classifier"
import {
  CLASSIFIER_POLICY_VERSION,
  CLASSIFIER_THRESHOLDS,
} from "../../sandbox/classifier-policy"
import { checkCommand, checkFileWrite } from "../../sandbox/command-policy"
import {
  decideWithJev,
  JEV_CLASSIFIER_ID,
  type JevDecision,
} from "../../sandbox/jev-classifier"
import { sandboxToolApproval } from "../../sandbox/sandbox-approval"
import {
  builtinCases,
  EVAL_WORK_DIR,
  loadCaseFile,
  type SandboxCase,
} from "./cases"
import { loadRealCases } from "./real"

// pnpm eval:sandbox [--rules-only] [--held-out] [--no-real] [--eval-db]
//   [--cases <file.json> ...]
// Runs every case through the production decision (rules, the turn's mode
// and Jev) in Auto and in Loop/Act, and reports per category how often a
// call is stopped. For "stop" cases that is the catch rate; for "run" cases
// it is the false-ask (Auto) and false-refusal (Loop/Act) rate. Results with
// Jev's answers go to a JSON file for re-thresholding offline.

const MODES = ["auto", "autonomous"] as const
type Mode = (typeof MODES)[number]
const CONCURRENCY = 8
const MAX_LISTED = 20

type ModeResult = {
  outcome: "allow" | "ask" | "deny"
  reason: string | null
  jev: JevDecision | null
}

type CaseResult = {
  case: SandboxCase
  check: string
  modes: Record<Mode, ModeResult>
}

const args = process.argv.slice(2)
const rulesOnly = args.includes("--rules-only")
const heldOut = args.includes("--held-out")
const withReal = !args.includes("--no-real") && !heldOut
const caseFiles = args.flatMap((arg, i) =>
  args[i - 1] === "--cases" ? [arg] : []
)

// Answers only the fixed evidence reads of classifierFacts, from the case.
function evidenceSandbox(c: SandboxCase) {
  const result = (stdout: string, exitCode = 0) => ({
    exitCode,
    stdout,
    stderr: "",
  })
  return {
    run: async ({ command }: { command: string }) => {
      if (command.includes("/usr/bin/git") && command.includes(" status ")) {
        return result(c.gitStatus ?? "")
      }
      const quoted = / -- '(.*)'$/.exec(command)?.[1]?.replace(/'\\''/g, "'")
      const content = quoted === undefined ? undefined : c.files?.[quoted]
      if (content === undefined) return result("", 1)
      if (command.includes("/usr/bin/realpath")) return result(quoted ?? "")
      if (command.includes("/usr/bin/head")) return result(content)
      return result("", 1)
    },
  }
}

function callInput(c: SandboxCase) {
  if (c.toolName === "bash") return { command: c.subject }
  if (c.toolName === "write") {
    return { file_path: c.subject, content: c.content ?? "" }
  }
  return { file_path: c.subject, old_string: "", new_string: c.content ?? "" }
}

async function runCase(c: SandboxCase): Promise<CaseResult> {
  const workDir = c.workDir ?? EVAL_WORK_DIR
  const { check } =
    c.toolName === "bash"
      ? await checkCommand(c.subject, { workDir })
      : { check: checkFileWrite(c.subject, { workDir }) }
  const modes = {} as Record<Mode, ModeResult>
  for (const mode of MODES) {
    let jev: JevDecision | null = null
    const classifier: SandboxClassifier | undefined = rulesOnly
      ? undefined
      : {
          id: JEV_CLASSIFIER_ID,
          classify: async (input, signal) => {
            jev = await decideWithJev(input, signal)
            return jev.verdict
          },
        }
    const approval = sandboxToolApproval({
      mode: mode as TurnSandboxMode,
      policy: { workDir },
      context: {
        request: c.request,
        recentCalls: c.recentCalls ?? [],
        denials: c.denials ?? [],
      },
      classifier,
      sandbox: evidenceSandbox(c),
    })
    const decision = await approval.decide({
      toolCallId: c.id,
      toolName: c.toolName,
      kind: c.toolName === "bash" ? "bash" : "edit",
      input: callInput(c),
    })
    modes[mode] =
      decision === "allow"
        ? { outcome: "allow", reason: null, jev }
        : decision === "ask"
          ? { outcome: "ask", reason: approval.askReason(c.id) ?? null, jev }
          : { outcome: "deny", reason: decision.reason, jev }
  }
  return { case: c, check: check.kind, modes }
}

async function runAll(cases: SandboxCase[]): Promise<CaseResult[]> {
  const results: CaseResult[] = []
  let next = 0
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++]
      if (c) results.push(await runCase(c))
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return results
}

const pct = (n: number, d: number) =>
  d === 0 ? "-" : `${n}/${d} (${Math.round((n / d) * 100)}%)`
const stopped = (r: CaseResult, mode: Mode) => r.modes[mode].outcome !== "allow"
const short = (text: string) =>
  text.length > 120 ? `${text.slice(0, 117)}...` : text

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}

function report(results: CaseResult[]) {
  const groups = new Map<string, CaseResult[]>()
  for (const r of results) {
    const key = `${r.case.category}|${r.case.expect}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  console.log(
    "  category        expect  cases  Auto stopped    Loop/Act stopped  rules h/f/s/r"
  )
  for (const [key, rows] of [...groups].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const [category, expect] = key.split("|")
    const kinds = ["hard", "flagged", "safe", "routine"].map(
      (kind) => rows.filter((r) => r.check === kind).length
    )
    console.log(
      `  ${(category ?? "").padEnd(15)} ${(expect ?? "").padEnd(7)} ${String(rows.length).padEnd(6)} ${pct(rows.filter((r) => stopped(r, "auto")).length, rows.length).padEnd(15)} ${pct(rows.filter((r) => stopped(r, "autonomous")).length, rows.length).padEnd(17)} ${kinds.join("/")}`
    )
  }

  const dangerous = results.filter((r) => r.case.expect === "stop")
  const benign = results.filter((r) => r.case.expect === "run")
  const missed = dangerous.filter((r) => !stopped(r, "auto"))
  console.log("\nSummary")
  console.log(
    `  stop cases caught: Auto ${pct(dangerous.length - missed.length, dangerous.length)}, Loop/Act ${pct(dangerous.filter((r) => stopped(r, "autonomous")).length, dangerous.length)}; missed in Auto but blocked by egress limits: ${missed.filter((r) => r.case.egressBlocked).length}`
  )
  console.log(
    `  run cases stopped: Auto asks ${pct(benign.filter((r) => stopped(r, "auto")).length, benign.length)}, Loop/Act refuses ${pct(benign.filter((r) => stopped(r, "autonomous")).length, benign.length)}`
  )

  const decisions = results.flatMap((r) =>
    MODES.flatMap((mode) => {
      const jev = r.modes[mode].jev
      return jev ? [jev] : []
    })
  )
  if (!rulesOnly) {
    const called = decisions.filter((d) => d.called)
    const cost = called.reduce((sum, d) => sum + (d.verdict.costUsd ?? 0), 0)
    console.log(
      `  Jev: ${called.length} calls, ${decisions.length - called.length} skipped as incomplete, ${called.filter((d) => d.error).length} errors; latency p50 ${percentile(
        called.map((d) => d.wallMs),
        0.5
      )} ms, p95 ${percentile(
        called.map((d) => d.wallMs),
        0.95
      )} ms; cost $${cost.toFixed(4)}`
    )
  }

  const list = (title: string, rows: CaseResult[], mode: Mode) => {
    if (rows.length === 0) return
    console.log(
      `\n${title} (${rows.length}${rows.length > MAX_LISTED ? `, first ${MAX_LISTED}` : ""})`
    )
    for (const r of rows.slice(0, MAX_LISTED)) {
      const reason = r.modes[mode].reason
      console.log(
        `  [${r.case.category}] ${r.case.id} (${r.check}): ${short(r.case.subject)}${reason ? `\n      ${short(reason)}` : ""}`
      )
    }
  }
  list("Missed in Auto (stop cases allowed)", missed, "auto")
  list(
    "Asked in Auto (run cases stopped)",
    benign.filter((r) => stopped(r, "auto")),
    "auto"
  )
}

async function main() {
  const synthetic = [
    ...builtinCases,
    ...(await Promise.all(caseFiles.map(loadCaseFile))).flat(),
  ].filter((c) => Boolean(c.heldOut) === heldOut)
  const real = withReal ? await loadRealCases() : []
  const cases = [...synthetic, ...real]
  const classifierId = rulesOnly ? "rules only" : JEV_CLASSIFIER_ID
  console.log(`\nLor sandbox eval — ${classifierId}`)
  console.log(
    `  cases: ${synthetic.length} ${heldOut ? "held-out" : "synthetic"} + ${real.length} real; files: ${caseFiles.join(", ") || "none"}\n`
  )
  const results = await runAll(cases)
  report(results)

  const out = process.env.EVAL_OUT ?? `/tmp/lor-eval-sandbox-${Date.now()}.json`
  writeFileSync(
    out,
    JSON.stringify(
      {
        classifier: classifierId,
        policyVersion: CLASSIFIER_POLICY_VERSION,
        thresholds: CLASSIFIER_THRESHOLDS,
        heldOut,
        results,
      },
      null,
      2
    )
  )
  console.log(`\n  results: ${out}\n`)
}

try {
  await main()
} catch (error) {
  console.error("Sandbox eval crashed:", error)
  process.exitCode = 1
} finally {
  await closeDb().catch(() => {})
  process.exit(process.exitCode ?? 0)
}
