// Checks how a model divides calls into topic sections
// (voice-session-memory, reference/voice-channels-runbook.md V7). Runs the
// sample calls in eval-voice-session-memory-calls.ts through summarizeCall,
// several times, and tallies how often the sections match the topic
// boundaries written into each call. Calls the real model through the
// gateway and prints what it cost; nothing is saved.
//
//   pnpm --filter @repo/worker exec tsx src/scripts/eval-voice-session-memory.ts [call-name] [--runs=3] [--model=moonshotai/kimi-k3] [--reasoning=high] [--quiet]
import { type SummarizeCallOptions, summarizeCall } from "@repo/lor"
import {
  buildSectionPassages,
  type CallLine,
  formatCallTime,
  numberedCallTranscript,
} from "@repo/voice/server"
import { CALLS, type Call } from "./eval-voice-session-memory-calls"

const WORDS_PER_SECOND = 2.5
const PAUSE_MS = 700
// A boundary within this many lines of the written one counts: real topic
// changes have a bridging line or two ("Okay. Um. What else.").
const TOLERANCE = 2

const args = process.argv.slice(2)
const flag = (name: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1]
const only = args.find((arg) => !arg.startsWith("--"))
const runs = Number(flag("runs") ?? 1)
const quiet = args.includes("--quiet")
const reasoning = flag("reasoning") as SummarizeCallOptions["reasoning"]
const options: SummarizeCallOptions = {
  ...(flag("model") ? { modelId: flag("model") } : {}),
  ...(reasoning ? { reasoning } : {}),
}

// Flattens the call's blocks into transcript lines, timed at speaking pace,
// and notes where each block starts: a required boundary when the topic
// changes, an optional one for blocks marked so.
function layOut(call: Call) {
  const lines: CallLine[] = []
  const required: number[] = []
  const optional: number[] = []
  let at = 0
  let previousTopic: string | null = null
  for (const block of call.blocks) {
    if ("gap" in block) {
      const line: CallLine = {
        kind: "gap",
        startMs: at,
        endMs: at + block.gap * 60_000,
        speaker: null,
      }
      lines.push(line)
      at = line.endMs + PAUSE_MS
      continue
    }
    if (block.topic !== previousTopic) {
      ;(block.optional && lines.length > 0 ? optional : required).push(
        lines.length
      )
    }
    previousTopic = block.topic
    for (const [speaker, text] of block.lines) {
      const duration = (text.split(/\s+/).length / WORDS_PER_SECOND) * 1000
      const line: CallLine = {
        kind: "speech",
        startMs: at,
        endMs: at + duration,
        speaker,
        text,
      }
      lines.push(line)
      at = line.endMs + PAUSE_MS
    }
  }
  const speakers = [
    ...new Set(
      lines.flatMap((line) => (line.kind === "speech" ? [line.speaker] : []))
    ),
  ]
  return { lines, required, optional, speakers }
}

type Verdict = "PASS" | "SPLIT" | "MERGED" | "SHIFTED" | "FAILED"

const totals = {
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  costUsd: 0,
  costReported: 0,
  models: new Set<string>(),
}

async function evaluate(call: Call, run: number) {
  const { lines, required, optional, speakers } = layOut(call)
  const startedAt = Date.now()
  const memory = await summarizeCall(
    {
      workspaceId: "eval",
      channelName: "eval",
      date: "Oct 5, 2026",
      speakers,
      transcript: numberedCallTranscript(lines),
    },
    (usage) => {
      totals.requests += 1
      totals.inputTokens += usage.inputTokens ?? 0
      totals.outputTokens += usage.outputTokens ?? 0
      totals.reasoningTokens += usage.reasoningTokens ?? 0
      if (usage.costUsd !== undefined) {
        totals.costUsd += usage.costUsd
        totals.costReported += 1
      }
      if (usage.model) totals.models.add(usage.model)
    },
    options
  )
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(0)
  const expected = `expected [${required.join(", ")}]${optional.length ? ` optional [${optional.join(", ")}]` : ""}`
  const output: string[] = []
  let verdict: Verdict
  if (!memory) {
    verdict = "FAILED"
    output.push(`  ${verdict}  model returned nothing (${seconds}s)`)
  } else {
    const got = memory.sections.map((section) => section.startLine)
    const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE
    const missed = required.filter((start) => !got.some((g) => near(g, start)))
    const extra = got.filter(
      (g) => ![...required, ...optional].some((start) => near(g, start))
    )
    verdict =
      missed.length === 0 && extra.length === 0
        ? "PASS"
        : extra.length > 0 && missed.length === 0
          ? "SPLIT"
          : missed.length > 0 && extra.length === 0
            ? "MERGED"
            : "SHIFTED"
    output.push(
      `  ${verdict}  ${expected}  got [${got.join(", ")}]${missed.length ? `  missed [${missed.join(", ")}]` : ""}${extra.length ? `  extra [${extra.join(", ")}]` : ""}  (${seconds}s)`
    )
    if (verdict !== "PASS" || (run === 1 && !quiet)) {
      for (const passage of buildSectionPassages(lines, memory.sections)) {
        output.push(
          `    [${formatCallTime(passage.startMs)}–${formatCallTime(passage.endMs)}] ${passage.title || "(untitled)"}: ${passage.about}`
        )
      }
    }
    if (run === 1 && !quiet) {
      output.push(`    summary: ${memory.summary.summary}`)
      for (const decision of memory.summary.decisions) {
        output.push(
          `    decision${decision.atMs === null ? "" : ` @${formatCallTime(decision.atMs)}`}: ${decision.text}`
        )
      }
    }
  }
  return { verdict, output }
}

const calls = only ? CALLS.filter((call) => call.name === only) : CALLS
if (calls.length === 0) {
  console.error(
    `No call named "${only}". Known: ${CALLS.map((c) => c.name).join(", ")}`
  )
  process.exit(1)
}
console.log(
  `model=${options.modelId ?? "LOR_SMALL_MODEL"} reasoning=${options.reasoning ?? "medium"} runs=${runs} calls=${calls.length}`
)

const tally = new Map<string, Record<Verdict, number>>()
for (const call of calls) {
  tally.set(call.name, { PASS: 0, SPLIT: 0, MERGED: 0, SHIFTED: 0, FAILED: 0 })
}

for (let run = 1; run <= runs; run += 1) {
  console.log(`\n--- run ${run}`)
  const results = await Promise.all(calls.map((call) => evaluate(call, run)))
  calls.forEach((call, index) => {
    const result = results[index]
    if (!result) return
    const counts = tally.get(call.name)
    if (counts) counts[result.verdict] += 1
    console.log(`${call.name} (${call.expect})`)
    for (const line of result.output) console.log(line)
  })
}

console.log("\n=== results")
let passed = 0
for (const call of calls) {
  const counts = tally.get(call.name)
  if (!counts) continue
  passed += counts.PASS
  const failures = (["SPLIT", "MERGED", "SHIFTED", "FAILED"] as const)
    .filter((kind) => counts[kind] > 0)
    .map((kind) => `${kind.toLowerCase()} ${counts[kind]}`)
    .join(", ")
  console.log(
    `  ${call.name.padEnd(20)} ${counts.PASS}/${runs}${failures ? `  (${failures})` : ""}`
  )
}
console.log(`  total                ${passed}/${runs * calls.length}`)
const cost = totals.costReported
  ? `$${totals.costUsd.toFixed(4)}${totals.costReported < totals.requests ? ` (reported for ${totals.costReported}/${totals.requests} requests)` : ""}`
  : "not reported by the gateway"
console.log(
  `  ${totals.requests} requests, ${totals.inputTokens} in / ${totals.outputTokens} out (${totals.reasoningTokens} reasoning), cost ${cost}, served by ${[...totals.models].join(", ") || "unknown"}`
)
process.exit(0)
