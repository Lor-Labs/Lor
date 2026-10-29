import { z } from "@hono/zod-openapi"
import type { ActSessionMode } from "@repo/db/schema"
import { actSessionModeEnum } from "@repo/db/schema"
import { channelCodeRepo, isSafeBranch } from "@repo/lor/code-repo"

// Where an Act run goes and whether it starts code sessions
// (reference/act-sessions-runbook.md). Shared by webhooks and connector
// triggers.
export const actSessionModeSchema = z.enum(actSessionModeEnum.enumValues)
export const actCodeSchema = z
  .object({
    repo: z.string().trim().min(1).max(200),
    branch: z.string().trim().min(1).max(200),
  })
  .nullable()

export type ActCode = z.infer<typeof actCodeSchema>

export function actCodeOf(row: {
  actRepoFullName: string | null
  actBaseBranch: string | null
}): ActCode {
  return row.actRepoFullName && row.actBaseBranch
    ? { repo: row.actRepoFullName, branch: row.actBaseBranch }
    : null
}

// The trigger's mode and code target after a patch. The repo is checked only
// when the code target or the channel changes, so a GitHub outage never
// blocks editing instructions.
export async function checkActTarget(input: {
  workspaceId: string
  channelId: string
  sessionMode: ActSessionMode
  code: ActCode
  recheck: boolean
}): Promise<
  | {
      ok: true
      columns: { actRepoFullName: string | null; actBaseBranch: string | null }
    }
  | { ok: false; message: string }
> {
  const { code } = input
  if (!code) {
    return { ok: true, columns: { actRepoFullName: null, actBaseBranch: null } }
  }
  // One ongoing session would put unrelated fixes on one branch.
  if (input.sessionMode === "ongoing") {
    return {
      ok: false,
      message:
        "Code sessions start per event or per subject, not as one ongoing session",
    }
  }
  if (!input.recheck) {
    return {
      ok: true,
      columns: { actRepoFullName: code.repo, actBaseBranch: code.branch },
    }
  }
  if (!isSafeBranch(code.branch)) {
    return { ok: false, message: `"${code.branch}" can't be used as a branch` }
  }
  const allowed = await channelCodeRepo(
    input.workspaceId,
    input.channelId,
    code.repo
  )
  if (!allowed) {
    return {
      ok: false,
      message: `${code.repo} isn't available for code sessions in this channel`,
    }
  }
  return {
    ok: true,
    columns: {
      actRepoFullName: allowed.repo.fullName,
      actBaseBranch: code.branch,
    },
  }
}
