import { parseArgs } from "node:util"
import type { BetaTrialChanges } from "@repo/db/schema"
import {
  BETA_POLICY,
  betaDate,
  betaTrialStatus,
  MICRO_USD,
} from "../beta-policy"

const HELP = `Usage: pnpm beta <command>
  policy
  configure <campaign-key> <UTC-start>
  open <campaign-key>
  pause <campaign-key>
  show <workspace slug or id>
  adjust <workspace slug or id> --request-id <id> --operator <name> --reason <text>
    [--expires <UTC-time>] [--members <total>] [--ai-usd <total>]
    [--sandbox-hours <total>] [--browser-hours <total>]

Configure creates a paused campaign. Open/pause controls enrollment, not existing trials.
Keep LOR_HOSTED_BETA=false until all launch gates in the runbook are complete.
Adjust sets new total grants, not additions. Reuse the request id only for retries.
These records do not enforce runtime limits until the remaining beta slices ship.`

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a positive integer`)
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error(`Invalid ${name}`)
  return number
}

function usd(value: string): number {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value))
    throw new Error("AI dollars must have at most six decimal places")
  const [whole = "0", fraction = ""] = value.split(".")
  const amount = Number(whole) * MICRO_USD + Number(fraction.padEnd(6, "0"))
  if (!Number.isSafeInteger(amount)) throw new Error("AI grant is too large")
  return amount
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
      "ai-usd": { type: "string" },
      "sandbox-hours": { type: "string" },
      "browser-hours": { type: "string" },
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
    !["configure", "open", "pause", "show", "adjust"].includes(command) ||
    positionals.length !== (command === "configure" ? 3 : 2)
  )
    throw new Error(HELP)

  const changes: BetaTrialChanges = {}
  if (values.expires) changes.expiresAt = betaDate(values.expires).toISOString()
  if (values.members)
    changes.memberLimit = positiveInteger(values.members, "members")
  if (values["ai-usd"] !== undefined)
    changes.aiGrantMicroUsd = usd(values["ai-usd"])
  if (values["sandbox-hours"])
    changes.sandboxGrantSeconds =
      positiveInteger(values["sandbox-hours"], "sandbox hours") * 3600
  if (values["browser-hours"])
    changes.browserGrantSeconds =
      positiveInteger(values["browser-hours"], "browser hours") * 3600
  if (
    command === "adjust" &&
    (!values["request-id"] ||
      !values.operator ||
      !values.reason ||
      Object.keys(changes).length === 0)
  ) {
    throw new Error(HELP)
  }
  if (command !== "adjust" && Object.keys(values).length > 0)
    throw new Error(HELP)
  const start = command === "configure" && startsAt ? betaDate(startsAt) : null

  const { db, schema, eq, closeDb } = await import("@repo/db")
  try {
    const {
      configureBetaCampaign,
      getWorkspaceBetaTrial,
      adjustBetaTrial,
      setBetaEnrollment,
    } = await import("../beta")
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
      console.log(
        JSON.stringify(
          { trial, status: trial ? betaTrialStatus(trial) : "not_enrolled" },
          null,
          2
        )
      )
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
