import { parseArgs } from "node:util"
import type { BetaTrialChanges } from "@repo/db/schema"
import {
  BETA_POLICY,
  betaDate,
  betaTrialStatus,
  MICRO_USD,
} from "../beta-policy"
import { CREDIT_USD } from "../constants"

const HELP = `Usage: pnpm beta <command>
  policy
  configure <campaign-key> <UTC-start>
  open <campaign-key>
  pause <campaign-key>
  halt <campaign-key>      emergency stop: no AI or sandbox use for trial teams
  resume <campaign-key>    undo halt
  show <workspace slug or id>
  adjust <workspace slug or id> --request-id <id> --operator <name> --reason <text>
    [--expires <UTC-time>] [--members <total>] [--credits <total>]
  exempt <workspace slug or id> --operator <name> --reason <text>
  unexempt <workspace slug or id>
  drain <workspace slug or id>   local testing only: use up a team's credits

Configure creates a paused campaign. Open/pause controls enrollment, not existing trials.
Keep LOR_HOSTED_BETA=false until all launch gates in the runbook are complete.
Adjust sets new total grants, not additions. Reuse the request id only for retries.
--credits is the pooled grant for AI, sandbox and browser time (1 credit = $0.01).
Exempt keeps an internal workspace (no trial) on normal access and billing.`

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a positive integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`Invalid ${name}`)
  return number
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      "request-id": { type: "string" },
      operator: { type: "string" },
      reason: { type: "string" },
      expires: { type: "string" },
      members: { type: "string" },
      credits: { type: "string" },
    },
  })
  const [command, target, startsAt] = positionals
  if (values.help || !command) {
    console.log(HELP)
    return
  }
  if (command === "policy") {
    if (positionals.length !== 1 || Object.keys(values).length > 0)
      throw new Error(HELP)
    console.log(JSON.stringify(BETA_POLICY, null, 2))
    return
  }
  if (
    !target ||
    ![
      "configure",
      "open",
      "pause",
      "halt",
      "resume",
      "drain",
      "show",
      "adjust",
      "exempt",
      "unexempt",
    ].includes(command) ||
    positionals.length !== (command === "configure" ? 3 : 2)
  )
    throw new Error(HELP)

  const changes: BetaTrialChanges = {}
  if (values.expires) changes.expiresAt = betaDate(values.expires).toISOString()
  if (values.members)
    changes.memberLimit = positiveInteger(values.members, "members")
  if (values.credits)
    changes.creditGrantMicroUsd = Math.round(
      positiveInteger(values.credits, "credits") * MICRO_USD * CREDIT_USD
    )
  if (
    command === "adjust" &&
    (!values["request-id"] ||
      !values.operator ||
      !values.reason ||
      Object.keys(changes).length === 0)
  ) {
    throw new Error(HELP)
  }
  if (
    command === "exempt" &&
    (!values.operator ||
      !values.reason ||
      Object.keys(values).some((key) => key !== "operator" && key !== "reason"))
  )
    throw new Error(HELP)
  if (
    command !== "adjust" &&
    command !== "exempt" &&
    Object.keys(values).length > 0
  )
    throw new Error(HELP)
  const start = command === "configure" && startsAt ? betaDate(startsAt) : null

  const { db, schema, eq, closeDb } = await import("@repo/db")
  try {
    const {
      configureBetaCampaign,
      getWorkspaceBetaTrial,
      adjustBetaTrial,
      setBetaEnrollment,
      setBetaUsageHalted,
      exemptFromBeta,
      removeBetaExemption,
    } = await import("../beta")
    const { drainBetaCredits } = await import("../beta-credits")
    const { isBetaExempt } = await import("@repo/db/queries/beta-access")
    if (command === "configure" && start) {
      console.log(
        JSON.stringify(await configureBetaCampaign(target, start), null, 2)
      )
      return
    }
    if (command === "open" || command === "pause") {
      console.log(
        JSON.stringify(
          await setBetaEnrollment(target, command === "pause"),
          null,
          2
        )
      )
      return
    }
    if (command === "halt" || command === "resume") {
      const campaign = await setBetaUsageHalted(target, command === "halt")
      console.log(
        command === "halt"
          ? `Halted ${campaign.key}: trial teams stop within about a minute.`
          : `Resumed ${campaign.key}.`
      )
      return
    }
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        target
      )
    const workspace = await db
      .select({ id: schema.workspace.id })
      .from(schema.workspace)
      .where(
        isUuid
          ? eq(schema.workspace.id, target)
          : eq(schema.workspace.slug, target)
      )
      .limit(1)
      .then((rows) => rows[0])
    if (!workspace) throw new Error("Workspace not found")
    if (command === "show") {
      const trial = await getWorkspaceBetaTrial(workspace.id)
      const status = trial
        ? betaTrialStatus(trial)
        : (await isBetaExempt(workspace.id))
          ? "exempt"
          : "not_enrolled"
      console.log(JSON.stringify({ trial, status }, null, 2))
      return
    }
    if (command === "exempt" && values.operator && values.reason) {
      await exemptFromBeta({
        workspaceId: workspace.id,
        operator: values.operator,
        reason: values.reason,
      })
      console.log(`Exempt: ${target}`)
      return
    }
    if (command === "drain") {
      console.log(JSON.stringify(await drainBetaCredits(workspace.id), null, 2))
      return
    }
    if (command === "unexempt") {
      await removeBetaExemption(workspace.id)
      console.log(`No longer exempt: ${target}`)
      return
    }
    const requestId = values["request-id"]
    if (!requestId || !values.operator || !values.reason) throw new Error(HELP)
    console.log(
      JSON.stringify(
        await adjustBetaTrial({
          workspaceId: workspace.id,
          requestId,
          operator: values.operator,
          reason: values.reason,
          changes,
        }),
        null,
        2
      )
    )
  } finally {
    await closeDb()
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Beta command failed")
  process.exitCode = 1
})
