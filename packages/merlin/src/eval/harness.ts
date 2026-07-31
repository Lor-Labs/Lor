import { closeDb } from "@repo/db"
import { searchBrain } from "../brain"
import { extractCitationTokens } from "../citations"
import {
  embedBrainQueryWithUsage,
  embedSourceQueryWithUsage,
} from "../embeddings"
import {
  type ConversationTurn,
  groundCitations,
  respond,
  type UsageEvent,
  writeBack,
} from "../index"
import { decideReplyPlacement } from "../placement"
import { searchSources } from "../sources"
import {
  type EvalCheck,
  type EvalResult,
  type Fixture,
  fixtures,
  type RespondFixture,
} from "./fixtures"
import { listBrainPages, seedEvalWorkspace } from "./seed"

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host || "unknown"
  } catch {
    return "unknown"
  }
}

function truncate(text: string, max = 280): string {
  const oneLine = text.replace(/\s+/g, " ").trim()
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

function matchesExpectedModel(actual: string, expected: string): boolean {
  if (actual === expected) return true
  const expectedSlug = expected.split("/").at(-1)
  return Boolean(expectedSlug && actual.endsWith(`/models/${expectedSlug}`))
}

function emptyResult(): EvalResult {
  return {
    answer: "",
    valid: 0,
    invalid: 0,
    citations: [],
    newPageBodies: [],
    toolNames: [],
    reasoningParts: 0,
    usageModels: [],
    retrievalKeys: [],
  }
}

function logFixture(
  fixture: Fixture,
  result: EvalResult,
  checks: EvalCheck[]
): { passed: number; total: number } {
  const passed = checks.filter((check) => check.pass).length
  const ok = passed === checks.length
  console.log(`${ok ? "✓" : "✗"} ${fixture.name} — ${passed}/${checks.length}`)
  console.log(`    ${fixture.description}`)
  if (result.answer) console.log(`    answer: ${truncate(result.answer)}`)
  if (result.placement) console.log(`    placement: ${result.placement}`)
  if (result.citations.length > 0 || result.invalid > 0) {
    console.log(
      `    citations: ${result.citations.length ? result.citations.join(", ") : "none"}  (valid ${result.valid}, invalid ${result.invalid})`
    )
  }
  if (result.toolNames.length > 0) {
    console.log(`    tools: ${result.toolNames.join(", ")}`)
  }
  if (result.usageModels.length > 0) {
    console.log(
      `    served models: ${[...new Set(result.usageModels)].join(", ")}`
    )
  }
  for (const check of checks) {
    console.log(`      ${check.pass ? "✓" : "✗"} ${check.label}`)
  }
  console.log("")
  return { passed, total: checks.length }
}

async function runRespondFixture(
  fixture: RespondFixture,
  workspaceId: string,
  userName: string
): Promise<EvalResult> {
  const before = new Map(
    (await listBrainPages(workspaceId)).map((page) => [
      page.id,
      page.body ?? "",
    ])
  )
  const question = fixture.question ?? ""
  const conversation: ConversationTurn[] = fixture.conversation ?? [
    { authorName: userName, content: question },
  ]
  const toolNames: string[] = []
  const usageModels: string[] = []
  let reasoningParts = 0
  const onUsage = (usage: UsageEvent) => {
    if (usage.model) usageModels.push(usage.model)
  }

  const answer = await respond(
    { workspaceId, conversation },
    {
      onDelta: () => {},
      onReasoning: () => {
        reasoningParts++
      },
      onToolEvent: (event) => {
        if (!toolNames.includes(event.toolName)) toolNames.push(event.toolName)
      },
      onUsage,
    }
  )
  const grounded = await groundCitations(workspaceId, answer.text)

  if (fixture.writeBack) {
    await writeBack(
      {
        workspaceId,
        priorMessages: answer.messages,
        gateText: `${conversation
          .map((turn) => `${turn.authorName}: ${turn.content}`)
          .join("\n")}\n\nMerlin: ${answer.text}`,
      },
      { onUsage }
    )
  }

  // Capture pages that were created or changed. This measures positive
  // write-back and, just as importantly, restraint fixtures that expect none.
  const after = await listBrainPages(workspaceId)
  const newPageBodies = after
    .filter((page) => before.get(page.id) !== (page.body ?? ""))
    .map((page) => page.body ?? "")

  return {
    answer: grounded.text,
    valid: grounded.valid,
    invalid: grounded.invalid,
    citations: [...extractCitationTokens(answer.text)],
    newPageBodies,
    toolNames,
    reasoningParts,
    usageModels,
    retrievalKeys: [],
  }
}

async function runFixture(
  fixture: Fixture,
  workspaceId: string,
  userName: string
): Promise<EvalResult> {
  if (fixture.kind === "placement") {
    return {
      ...emptyResult(),
      placement: await decideReplyPlacement(fixture.conversation),
    }
  }
  if (fixture.kind === "retrieval") {
    if (fixture.corpus === "brain") {
      const embedded = await embedBrainQueryWithUsage(fixture.query)
      const hits = await searchBrain(workspaceId, embedded.embedding, 3)
      return {
        ...emptyResult(),
        answer: hits.map((hit) => `${hit.path}\n${hit.body}`).join("\n\n"),
        retrievalKeys: hits.map((hit) => hit.path),
        usageModels: [embedded.model],
      }
    }
    const embedded = await embedSourceQueryWithUsage(fixture.query)
    const hits = await searchSources(workspaceId, embedded.embedding, 3)
    return {
      ...emptyResult(),
      answer: hits.map((hit) => `${hit.title}\n${hit.summary}`).join("\n\n"),
      retrievalKeys: hits.map((hit) => hit.title),
      usageModels: [embedded.model],
    }
  }
  return runRespondFixture(fixture, workspaceId, userName)
}

async function main(): Promise<void> {
  console.log("\nMerlin eval harness")
  console.log(`  DB: ${dbHost()}`)
  console.log(`  fixtures: ${fixtures.length}\n`)

  const workspace = await seedEvalWorkspace()
  let passed = 0
  let total = 0
  const observedModels = new Set<string>()

  try {
    for (const fixture of fixtures) {
      try {
        const result = await runFixture(
          fixture,
          workspace.workspaceId,
          workspace.userName
        )
        for (const model of result.usageModels) observedModels.add(model)
        const score = logFixture(fixture, result, fixture.expect(result))
        passed += score.passed
        total += score.total
      } catch (error) {
        console.error(
          `Fixture ${fixture.name} failed:`,
          error instanceof Error ? error.message : error
        )
        let checks: EvalCheck[]
        try {
          checks = fixture
            .expect(emptyResult())
            .map((check) => ({ ...check, pass: false }))
        } catch {
          checks = [{ label: "fixture completed", pass: false }]
        }
        const score = logFixture(fixture, emptyResult(), checks)
        total += score.total
      }
    }
  } finally {
    await workspace.cleanup()
  }

  const expectedServedModel = process.env.EVAL_EXPECT_SERVED_MODEL
  if (expectedServedModel) {
    const found = [...observedModels].some((model) =>
      matchesExpectedModel(model, expectedServedModel)
    )
    total++
    if (found) passed++
    console.log(
      `${found ? "✓" : "✗"} served-model — expected ${expectedServedModel}; observed ${[...observedModels].join(", ") || "none"}`
    )
  }

  console.log(`Result: ${passed}/${total} checks passed.\n`)
  process.exitCode = passed === total ? 0 : 1
}

try {
  await main()
} catch (error) {
  console.error("Eval harness crashed:", error)
  process.exitCode = 1
} finally {
  try {
    await closeDb()
  } catch (error) {
    console.error("Failed to close eval database:", error)
    process.exitCode = 1
  }
}
