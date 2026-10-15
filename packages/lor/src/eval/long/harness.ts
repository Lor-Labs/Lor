import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { closeDb, db, schema } from "@repo/db"
import { groundCitations, respond, type UsageEvent } from "../../index"
import { LOR_MODEL } from "../../models"
import {
  estimateCostUsd,
  isDegenerate,
  type TokenTotals,
  type TranscriptStats,
  tokenTotals,
  transcriptStats,
} from "./metrics"
import { type Check, type LongTask, longTasks } from "./tasks"
import { brainSnapshot, DECOY_WRITE_TOOLS, seedWorld } from "./world"

// Long-task eval (`pnpm --filter @repo/lor eval:long`). Each attempt seeds a
// fresh world and runs one task as a session-thread run with the production
// tool load (plans, proposals, loops, decoy custom tools). Grades the end
// state, not the wording. EVAL_K attempts per task; pass^k = every attempt
// passed. EVAL_TASKS filters by name, EVAL_CONCURRENCY bounds parallelism.

const K = Number(process.env.EVAL_K ?? 3)
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3)
const ONLY = process.env.EVAL_TASKS?.split(",").map((s) => s.trim())
// respond() already stops at AGENT_RUN_MAX_WALL_MS; this backstops a stream
// that never settles.
const BACKSTOP_MS =
  Number(process.env.AGENT_RUN_MAX_WALL_MS ?? 600_000) + 60_000

type Attempt = {
  task: string
  attempt: number
  checks: Check[]
  score: number
  pass: boolean
  error?: string
  wallMs: number
  stats: TranscriptStats | null
  toolErrors: number
  decoyWrites: string[]
  degenerate: boolean
  tokens: TokenTotals
  // For reading failures in the results file.
  answer?: string
  changedPages?: Record<string, string | null>
}

const MENTION = /<@([0-9a-f-]{36})>/g

function withBackstop<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error("backstop timeout")),
        BACKSTOP_MS
      ).unref()
    ),
  ])
}

async function runAttempt(task: LongTask, attempt: number): Promise<Attempt> {
  const world = await seedWorld()
  const toolNames = new Map<string, string>()
  const failedCalls = new Set<string>()
  const usage: UsageEvent[] = []
  let reasoning = ""
  let error: string | undefined
  let result: Awaited<ReturnType<typeof respond>> | null = null
  const start = performance.now()
  try {
    const before = await brainSnapshot(world.workspaceId)
    const channelId = world.channels[task.channel]
    const [root] = await db
      .insert(schema.message)
      .values({ channelId, authorId: world.users.Bucky, content: task.prompt })
      .returning({ id: schema.message.id })
    if (!root) throw new Error("task message insert failed")

    try {
      result = await withBackstop(
        respond(
          {
            workspaceId: world.workspaceId,
            channelId,
            threadRootId: root.id,
            triggerMessageId: root.id,
            conversation: [
              { messageId: root.id, authorName: "Bucky", content: task.prompt },
            ],
            createPlan: async (input) =>
              db
                .insert(schema.plan)
                .values({
                  workspaceId: world.workspaceId,
                  channelId,
                  threadRootId: root.id,
                  creatorId: world.users.Bucky,
                  title: input.title,
                  goal: input.goal,
                  steps: input.steps,
                })
                .returning()
                .then((rows) => rows[0] ?? null),
            proposeChange: async () => ({ proposalId: randomUUID() }),
            proposeLoop: async () => ({ loopId: randomUUID() }),
          },
          {
            onDelta: () => {},
            onReasoning: (delta) => {
              reasoning += delta
            },
            onToolEvent: (e) => {
              if (e.toolName) toolNames.set(e.toolCallId, e.toolName)
              if (e.status === "error") failedCalls.add(e.toolCallId)
            },
            onUsage: (u) => {
              usage.push(u)
            },
          }
        )
      )
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
    const wallMs = Math.round(performance.now() - start)

    const after = await brainSnapshot(world.workspaceId)
    const answer = result?.text ?? ""
    const grounded = answer
      ? await groundCitations(world.workspaceId, answer)
      : { invalid: 0 }
    const changedPaths = [
      ...new Set([...before.keys(), ...after.keys()]),
    ].filter((p) => before.get(p) !== after.get(p))
    const decoyWrites = [...toolNames.values()].filter((n) =>
      DECOY_WRITE_TOOLS.has(n)
    )
    const mentioned = [
      answer,
      ...changedPaths.map((p) => after.get(p) ?? ""),
    ].flatMap((text) => [...text.matchAll(MENTION)].map((m) => m[1] ?? ""))

    const checks: Check[] = [
      ...(await task.check({ answer, before, after, world })),
      { label: "finished without error or timeout", pass: !error },
      { label: "no write-action decoy tools", pass: decoyWrites.length === 0 },
      { label: "no invalid citations", pass: grounded.invalid === 0 },
      {
        label: "no invented user mentions",
        pass: mentioned.every((id) => world.memberIds.has(id)),
      },
      {
        label: "no edits outside task scope",
        pass: changedPaths.every((p) =>
          task.writes.some((w) => p.startsWith(w))
        ),
      },
    ]
    const passed = checks.filter((c) => c.pass).length
    return {
      task: task.name,
      attempt,
      checks,
      score: passed / checks.length,
      pass: passed === checks.length,
      ...(error ? { error } : {}),
      wallMs,
      stats: result ? transcriptStats(result.messages) : null,
      toolErrors: failedCalls.size,
      decoyWrites,
      degenerate: isDegenerate(reasoning) || isDegenerate(answer),
      tokens: tokenTotals(usage),
      answer,
      changedPages: Object.fromEntries(
        changedPaths.map((p) => [p, after.get(p) ?? null])
      ),
    }
  } finally {
    await world.cleanup().catch((err) => {
      console.error(`cleanup failed for ${task.name}#${attempt}:`, err)
    })
  }
}

function logAttempt(a: Attempt): void {
  const s = a.stats
  const shape = s
    ? `steps ${s.steps} · calls ${s.toolCalls} (dup ${s.duplicateCalls}, max×${s.maxRepeat})`
    : "no transcript"
  console.log(
    `${a.pass ? "✓" : "✗"} ${a.task}#${a.attempt} — ${Math.round(a.score * 100)}% · ${shape} · tool errors ${a.toolErrors} · ${Math.round(a.wallMs / 1000)}s${a.degenerate ? " · DEGENERATE OUTPUT" : ""}`
  )
  if (a.error) console.log(`    error: ${a.error}`)
  if (a.decoyWrites.length)
    console.log(`    decoy writes: ${a.decoyWrites.join(", ")}`)
  for (const c of a.checks) if (!c.pass) console.log(`      ✗ ${c.label}`)
}

async function pool<T>(jobs: (() => Promise<T>)[], size: number): Promise<T[]> {
  const out: T[] = []
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++
      const job = jobs[i]
      if (job) out[i] = await job()
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, jobs.length) }, worker))
  return out
}

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0

async function main(): Promise<void> {
  const tasks = longTasks.filter((t) => !ONLY || ONLY.includes(t.name))
  console.log(`\nLor long-task eval — ${LOR_MODEL}`)
  console.log(`  tasks: ${tasks.length} × k=${K}, concurrency ${CONCURRENCY}\n`)

  const jobs = tasks.flatMap((task) =>
    Array.from({ length: K }, (_, i) => async () => {
      const a = await runAttempt(task, i + 1).catch(
        (err): Attempt => ({
          task: task.name,
          attempt: i + 1,
          checks: [{ label: "attempt ran", pass: false }],
          score: 0,
          pass: false,
          error: `harness: ${err instanceof Error ? err.message : String(err)}`,
          wallMs: 0,
          stats: null,
          toolErrors: 0,
          decoyWrites: [],
          degenerate: false,
          tokens: { input: 0, cached: 0, output: 0 },
        })
      )
      logAttempt(a)
      return a
    })
  )
  const attempts = await pool(jobs, CONCURRENCY)

  console.log("\nSummary")
  for (const task of tasks) {
    const runs = attempts.filter((a) => a.task === task.name)
    const stats = runs.flatMap((a) => (a.stats ? [a.stats] : []))
    console.log(
      `  ${task.name}: pass^${K} ${runs.every((a) => a.pass) ? "yes" : "no"} · passed ${runs.filter((a) => a.pass).length}/${runs.length} · score ${Math.round(avg(runs.map((a) => a.score)) * 100)}% · steps ${avg(stats.map((s) => s.steps)).toFixed(1)} · dup calls ${avg(stats.map((s) => s.duplicateCalls)).toFixed(1)} · ${Math.round(avg(runs.map((a) => a.wallMs)) / 1000)}s`
    )
  }
  const tokens = attempts.reduce(
    (t, a) => ({
      input: t.input + a.tokens.input,
      cached: t.cached + a.tokens.cached,
      output: t.output + a.tokens.output,
    }),
    { input: 0, cached: 0, output: 0 }
  )
  const cost = estimateCostUsd(LOR_MODEL, tokens)
  console.log(
    `\n  overall score ${Math.round(avg(attempts.map((a) => a.score)) * 100)}% · attempts passed ${attempts.filter((a) => a.pass).length}/${attempts.length} · timeouts/errors ${attempts.filter((a) => a.error).length} · degenerate ${attempts.filter((a) => a.degenerate).length}`
  )
  console.log(
    `  tokens in ${tokens.input} (cached ${tokens.cached}) out ${tokens.output}${cost === null ? "" : ` · est. $${cost.toFixed(2)}`}\n`
  )

  const out =
    process.env.EVAL_OUT ??
    `/tmp/lor-eval-long-${LOR_MODEL.replace(/\W+/g, "-")}-${Date.now()}.json`
  writeFileSync(
    out,
    JSON.stringify({ model: LOR_MODEL, k: K, attempts }, null, 2)
  )
  console.log(`  results: ${out}\n`)
}

try {
  await main()
} catch (error) {
  console.error("Long eval crashed:", error)
  process.exitCode = 1
} finally {
  await closeDb().catch(() => {})
  // Timed-out attempts can leave provider streams open; don't wait on them.
  process.exit(process.exitCode ?? 0)
}
