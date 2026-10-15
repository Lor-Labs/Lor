import { randomUUID } from "node:crypto"
import { writeFileSync } from "node:fs"
import { closeDb, db, eq, schema } from "@repo/db"
import {
  groundCitations,
  type ModelMessage,
  type RespondCallbacks,
  type RespondResult,
  respond,
  type UsageEvent,
} from "../../index"
import { LOR_MODEL } from "../../models"
import type { CreatePlanForThread } from "../../plans"
import { formatSpeakerLine } from "../../transcript"
import { JUDGE_MODEL, nextUserTurn } from "./judge"
import {
  degenerateSample,
  estimateCostUsd,
  type TokenTotals,
  type TranscriptStats,
  tokenTotals,
  transcriptStats,
} from "./metrics"
import { sessionTasks } from "./sessions"
import { type Check, type LongTask, longTasks, type TaskOutcome } from "./tasks"
import {
  brainSnapshot,
  DECOY_WRITE_TOOLS,
  resolveMentions,
  seedWorld,
} from "./world"

// Long-task eval (`pnpm --filter @repo/lor eval:long`). Each attempt seeds a
// fresh world and runs one task as a session thread with the production tool
// load (plans, proposals, loops, decoy custom tools); multi-turn tasks
// continue the session the way the worker does. Grades the end state, not
// the wording. EVAL_K attempts per task; pass^k = every attempt passed.
// EVAL_TASKS filters by name, EVAL_CONCURRENCY bounds parallelism,
// EVAL_JUDGE_MODEL picks the grader.

const K = Number(process.env.EVAL_K ?? 3)
const CONCURRENCY = Number(process.env.EVAL_CONCURRENCY ?? 3)
const ONLY = process.env.EVAL_TASKS?.split(",").map((s) => s.trim())
// respond() already stops at AGENT_RUN_MAX_WALL_MS; this backstops a stream
// that never settles.
const BACKSTOP_MS =
  Number(process.env.AGENT_RUN_MAX_WALL_MS ?? 600_000) + 60_000
// Mirrors formatDelta in apps/worker/src/lib/run-continuation.ts.
const DELTA_PREFIX =
  "The conversation continued since you last worked. Pick up where you left off — everything above is still your context."

type Attempt = {
  task: string
  attempt: number
  checks: Check[]
  score: number
  pass: boolean
  error?: string
  wallMs: number
  turns: number
  stats: TranscriptStats | null
  toolErrors: number
  decoyWrites: string[]
  degenerate: boolean
  tokens: TokenTotals
  // Budget or approval stops, per turn; absent when every turn ended on its own.
  stoppedFor?: (string | null)[]
  // For reading failures in the results file.
  degenerateSample?: string
  answers?: string[]
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

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : String(err)

async function postMessage(
  channelId: string,
  authorId: string,
  content: string,
  threadRootId: string | null
): Promise<string> {
  const [row] = await db
    .insert(schema.message)
    .values({ channelId, authorId, content, threadRootId })
    .returning({ id: schema.message.id })
  if (!row) throw new Error("message insert failed")
  return row.id
}

async function runAttempt(task: LongTask, attempt: number): Promise<Attempt> {
  const world = await seedWorld()
  const toolNames = new Map<string, string>()
  const failedCalls = new Set<string>()
  const usage: UsageEvent[] = []
  const proposals: TaskOutcome["proposals"] = []
  const loops: TaskOutcome["loops"] = []
  const answers: string[] = []
  const stops: (string | null)[] = []
  let reasoning = ""
  let error: string | undefined
  let messages: ModelMessage[] | null = null
  const start = performance.now()
  try {
    const before = await brainSnapshot(world.workspaceId)
    const channelId = world.channels[task.channel]
    const asker = world.users.Bucky
    const root = await postMessage(channelId, asker, task.prompt, null)
    const loadPlan = () =>
      db
        .select()
        .from(schema.plan)
        .where(eq(schema.plan.threadRootId, root))
        .limit(1)
        .then((rows) => rows[0] ?? null)
    const createPlan: CreatePlanForThread = async (input) => {
      const [row] = await db
        .insert(schema.plan)
        .values({
          workspaceId: world.workspaceId,
          channelId,
          threadRootId: root,
          creatorId: asker,
          title: input.title,
          goal: input.goal,
          steps: input.steps,
        })
        .onConflictDoNothing()
        .returning()
      return row ?? (await loadPlan())
    }
    const callbacks: RespondCallbacks = {
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

    const transcript = [{ author: "Bucky", text: task.prompt }]
    let turn = { messageId: root, content: task.prompt }
    for (let i = 0; ; i++) {
      try {
        const plan = await loadPlan()
        const delta = messages
          ? `${DELTA_PREFIX}\n\n${formatSpeakerLine("Bucky", turn.content)}`
          : null
        const result: RespondResult = await withBackstop(
          respond(
            {
              workspaceId: world.workspaceId,
              channelId,
              threadRootId: root,
              triggerMessageId: turn.messageId,
              conversation: [
                {
                  messageId: turn.messageId,
                  authorName: "Bucky",
                  content: turn.content,
                },
              ],
              ...(plan
                ? {
                    plan: {
                      id: plan.id,
                      title: plan.title,
                      goal: plan.goal,
                      status: plan.status,
                      steps: plan.steps,
                      summary: plan.summary,
                    },
                  }
                : {}),
              createPlan,
              proposeChange: async (input) => {
                proposals.push(input)
                return { proposalId: randomUUID() }
              },
              proposeLoop: async (input) => {
                loops.push(input)
                return { loopId: randomUUID() }
              },
              ...(messages && delta
                ? {
                    continuation: {
                      messages: [
                        ...messages,
                        { role: "user" as const, content: delta },
                      ],
                      coveredMessageIds: [turn.messageId],
                      deltaText: delta,
                      lastInputTokens: 0,
                      compaction: null,
                    },
                  }
                : {}),
            },
            callbacks
          )
        )
        messages = result.messages
        answers.push(result.text)
        stops.push(result.stoppedFor ?? null)
        transcript.push({ author: "Lor", text: result.text })

        const sim = task.simulatedUser
        const next = task.followUps
          ? task.followUps[i]
          : sim && i + 1 < sim.maxTurns
            ? await nextUserTurn(sim, transcript)
            : null
        if (!next) break
        transcript.push({ author: "Bucky", text: next })
        turn = {
          messageId: await postMessage(channelId, asker, next, root),
          content: next,
        }
      } catch (err) {
        error = `turn ${i + 1}: ${errorText(err)}`
        break
      }
    }
    const wallMs = Math.round(performance.now() - start)

    const after = await brainSnapshot(world.workspaceId)
    const allAnswers = answers.join("\n\n")
    const grounded = allAnswers
      ? await groundCitations(world.workspaceId, allAnswers)
      : { invalid: 0 }
    const changedPaths = [
      ...new Set([...before.keys(), ...after.keys()]),
    ].filter((p) => before.get(p) !== after.get(p))
    const decoyWrites = [...toolNames.values()].filter((n) =>
      DECOY_WRITE_TOOLS.has(n)
    )
    const mentioned = [
      ...answers,
      ...changedPaths.map((p) => after.get(p) ?? ""),
    ].flatMap((text) => [...text.matchAll(MENTION)].map((m) => m[1] ?? ""))

    const named = (text: string) => resolveMentions(world, text)
    const taskChecks = await task
      .check({
        answer: named(answers.at(-1) ?? ""),
        answers: answers.map(named),
        before,
        after: new Map([...after].map(([path, body]) => [path, named(body)])),
        world,
        plan: await loadPlan(),
        proposals,
        loops,
      })
      .catch((err): Check[] => [
        { label: "task checks ran", pass: false, reason: errorText(err) },
      ])
    const checks: Check[] = [
      ...taskChecks,
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
    const sample =
      degenerateSample(reasoning) ??
      answers.map(degenerateSample).find((s) => s !== null) ??
      null
    return {
      task: task.name,
      attempt,
      checks,
      score: passed / checks.length,
      pass: passed === checks.length,
      ...(error ? { error } : {}),
      wallMs,
      turns: answers.length,
      stats: messages ? transcriptStats(messages) : null,
      toolErrors: failedCalls.size,
      decoyWrites,
      degenerate: sample !== null,
      ...(sample ? { degenerateSample: sample } : {}),
      ...(stops.some(Boolean) ? { stoppedFor: stops } : {}),
      tokens: tokenTotals(usage),
      answers,
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
    ? `${a.turns} turn${a.turns === 1 ? "" : "s"} · steps ${s.steps} · calls ${s.toolCalls} (dup ${s.duplicateCalls}, max×${s.maxRepeat})`
    : "no transcript"
  console.log(
    `${a.pass ? "✓" : "✗"} ${a.task}#${a.attempt} — ${Math.round(a.score * 100)}% · ${shape} · tool errors ${a.toolErrors} · ${Math.round(a.wallMs / 1000)}s${a.degenerate ? " · DEGENERATE OUTPUT" : ""}`
  )
  if (a.error) console.log(`    error: ${a.error}`)
  if (a.stoppedFor) console.log(`    stopped for: ${a.stoppedFor.join(", ")}`)
  if (a.degenerateSample) console.log(`    degenerate: ${a.degenerateSample}`)
  if (a.decoyWrites.length)
    console.log(`    decoy writes: ${a.decoyWrites.join(", ")}`)
  for (const c of a.checks) {
    if (!c.pass)
      console.log(`      ✗ ${c.label}${c.reason ? ` — ${c.reason}` : ""}`)
  }
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
  const tasks = [...longTasks, ...sessionTasks].filter(
    (t) => !ONLY || ONLY.includes(t.name)
  )
  console.log(`\nLor long-task eval — ${LOR_MODEL} (judge ${JUDGE_MODEL})`)
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
          error: `harness: ${errorText(err)}`,
          wallMs: 0,
          turns: 0,
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
