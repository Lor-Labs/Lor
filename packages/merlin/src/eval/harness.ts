import { extractCitationTokens } from "../citations"
import type { ConversationTurn } from "../index"
import { groundCitations, respond, writeBack } from "../index"
import { type EvalResult, fixtures } from "./fixtures"
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

async function main(): Promise<void> {
  console.log(`\nMerlin eval harness`)
  console.log(`  DB: ${dbHost()}`)
  console.log(`  fixtures: ${fixtures.length}\n`)

  const ws = await seedEvalWorkspace()
  let passed = 0
  let total = 0

  try {
    for (const fx of fixtures) {
      const before = new Set(
        (await listBrainPages(ws.workspaceId)).map((p) => p.id)
      )

      const conversation: ConversationTurn[] = [
        { authorName: ws.userName, content: fx.question },
      ]
      const answer = await respond(
        { workspaceId: ws.workspaceId, conversation },
        { onDelta: () => {} }
      )
      const grounded = await groundCitations(ws.workspaceId, answer.text)

      if (fx.writeBack) {
        await writeBack(
          {
            workspaceId: ws.workspaceId,
            priorMessages: answer.messages,
            gateText: `${ws.userName}: ${fx.question}\n\nMerlin: ${answer.text}`,
          },
          {}
        )
      }

      const after = await listBrainPages(ws.workspaceId)
      const newPageBodies = after
        .filter((p) => !before.has(p.id))
        .map((p) => p.body ?? "")

      const result: EvalResult = {
        answer: grounded.text,
        valid: grounded.valid,
        invalid: grounded.invalid,
        citations: [...extractCitationTokens(grounded.text)],
        newPageBodies,
      }

      const checks = fx.expect(result)
      const fxPassed = checks.filter((c) => c.pass).length
      passed += fxPassed
      total += checks.length

      const ok = fxPassed === checks.length
      console.log(`${ok ? "✓" : "✗"} ${fx.name} — ${fxPassed}/${checks.length}`)
      console.log(`    ${fx.description}`)
      console.log(`    answer: ${truncate(result.answer)}`)
      console.log(
        `    citations: ${result.citations.length ? result.citations.join(", ") : "none"}  (valid ${result.valid}, invalid ${result.invalid})`
      )
      for (const c of checks) {
        console.log(`      ${c.pass ? "✓" : "✗"} ${c.label}`)
      }
      console.log("")
    }
  } finally {
    await ws.cleanup()
  }

  console.log(`Result: ${passed}/${total} checks passed.\n`)
  process.exitCode = passed === total ? 0 : 1
}

main().catch((err) => {
  console.error("Eval harness crashed:", err)
  process.exitCode = 1
})
