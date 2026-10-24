import { z } from "@hono/zod-openapi"
import { agentSessionModeEnum, agentSessionOriginEnum } from "@repo/db/schema"

export const sessionParamsSchema = z.object({
  sessionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sessionId", in: "path", required: true },
    }),
})

export const agentSessionSchema = z
  .object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
    channelId: z.string().uuid(),
    threadRootId: z.string().uuid(),
    creatorId: z.string().uuid().nullable(),
    origin: z.enum(agentSessionOriginEnum.enumValues),
    mode: z.enum(agentSessionModeEnum.enumValues),
    repoFullName: z.string().nullable(),
    baseBranch: z.string().nullable(),
    sourceSessionId: z.string().uuid().nullable(),
    forkedFromMessageId: z.string().uuid().nullable(),
    title: z.string(),
    titleEditedAt: z.string().nullable(),
    loopId: z.string().uuid().nullable(),
    triggerId: z.string().uuid().nullable(),
    archivedAt: z.string().nullable(),
    archivedById: z.string().uuid().nullable(),
    lastActivityAt: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AgentSession")

// A message the session started with. Clients link to it, not quote it.
export const sessionContextMessageSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
})

export const channelSessionsParamsSchema = z.object({
  channelId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "channelId", in: "path", required: true },
    }),
})

export const channelSessionsQuerySchema = z.object({
  archived: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "archived", in: "query" } }),
})

export const channelSessionSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  titleEdited: z.boolean(),
  loop: z.boolean(),
  // Code sessions only.
  repoFullName: z.string().nullable(),
  // Null for loop and trigger sessions.
  creator: z
    .object({
      id: z.string().uuid(),
      name: z.string(),
      image: z.string().nullable(),
      avatarColor: z.string().nullable(),
    })
    .nullable(),
  archivedAt: z.string().nullable(),
  lastActivityAt: z.string(),
  running: z.boolean(),
  subscribed: z.boolean(),
})

export const listChannelSessionsResponseSchema = z.object({
  sessions: z.array(channelSessionSchema),
})

export const updateAgentSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    archived: z.boolean().optional(),
  })
  .refine((body) => body.title !== undefined || body.archived !== undefined, {
    message: "Nothing to update",
  })

export const updateAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
})

export const getAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
  channel: z.object({ id: z.string().uuid(), name: z.string().nullable() }),
  context: z.array(sessionContextMessageSchema),
  // "Continue in Code" or a fork: the session this one comes from. Same
  // channel.
  source: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
})

export const forkAgentSessionRequestSchema = z.object({
  // The Lor reply whose turn the fork starts from.
  messageId: z.string().uuid(),
})

export const forkAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
})

// ── Code session Changes panel ─────────────────────────

const changedFileSchema = z.object({
  path: z.string(),
  oldPath: z.string().nullable(),
  status: z.enum([
    "modified",
    "added",
    "deleted",
    "renamed",
    "typechange",
    "conflicted",
    "untracked",
  ]),
  staged: z.boolean(),
  unstaged: z.boolean(),
  // Lines against HEAD; null for binary or uncounted files.
  additions: z.number().int().nullable(),
  deletions: z.number().int().nullable(),
})

export const sessionChangesResponseSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    repoFullName: z.string(),
    baseBranch: z.string(),
    branch: z.string().nullable(),
    // Staging waits while Lor works in the session.
    lorWorking: z.boolean(),
    // Commits made in the sandbox since the base, newest first.
    commits: z.array(z.object({ sha: z.string(), subject: z.string() })),
    files: z.array(changedFileSchema),
    truncated: z.boolean(),
    // A pull's merge waits for its conflicts to be fixed and committed.
    merging: z.boolean(),
  }),
  // The sandbox or its repository folder no longer exists.
  z.object({ state: z.literal("gone") }),
  // Rebuilding from the newest checkpoint; a changes broadcast follows.
  z.object({ state: z.literal("restoring") }),
  z.object({ state: z.literal("restore_failed") }),
])

const pathSchema = z
  .string()
  .min(1)
  .max(4_096)
  .refine((path) => !path.includes("\0"), "Invalid path")

export const sessionChangeDiffQuerySchema = z.object({
  path: pathSchema,
  oldPath: pathSchema.optional(),
  untracked: z.enum(["true", "false"]).optional(),
})

export const sessionChangeDiffResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("patch"), patch: z.string() }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("too_large") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("restoring") }),
  z.object({ kind: z.literal("restore_failed") }),
])

export const stageSessionChangesRequestSchema = z
  .object({
    // Omitted with all: true.
    paths: z.array(pathSchema).min(1).max(1_000).optional(),
    all: z.boolean().optional(),
    staged: z.boolean(),
  })
  .refine((body) => Boolean(body.paths) !== Boolean(body.all), {
    message: "Pass paths or all, not both",
  })

export const commitSessionChangesRequestSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
})

export const commitSessionChangesResponseSchema = z.object({
  commit: z.object({ sha: z.string(), subject: z.string() }),
  changes: sessionChangesResponseSchema,
})

export const pushSessionChangesResponseSchema = z.object({
  pushed: z.object({
    branch: z.string(),
    commitCount: z.number(),
    headSha: z.string(),
  }),
  // The branch's open pull request, or GitHub's page for a new one; null on
  // the repo's default branch.
  pullRequest: z.object({ url: z.string(), open: z.boolean() }).nullable(),
  changes: sessionChangesResponseSchema,
})

export const pullSessionChangesResponseSchema = z.object({
  pulled: z.object({
    outcome: z.enum(["up_to_date", "merged", "conflicts"]),
    commitCount: z.number(),
    conflicts: z.array(z.string()),
  }),
  changes: sessionChangesResponseSchema,
})

export const repoTreeResponseSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("ready"),
    // Tracked and untracked files, without ignored ones.
    paths: z.array(z.string()),
    truncated: z.boolean(),
  }),
  z.object({ state: z.literal("gone") }),
  // Rebuilding from the newest checkpoint; a changes broadcast follows.
  z.object({ state: z.literal("restoring") }),
  z.object({ state: z.literal("restore_failed") }),
])

export const repoFileQuerySchema = z.object({ path: pathSchema })

export const repoFileResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string() }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("too_large") }),
  // Not a file in the repo, or it resolves outside it.
  z.object({ kind: z.literal("missing") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("restoring") }),
  z.object({ kind: z.literal("restore_failed") }),
])

export const commitMessageResponseSchema = z.object({
  // Null when nothing is staged or the model failed.
  message: z.string().nullable(),
})

export const sessionFilesResponseSchema = z.object({
  // Lor's files, most recently updated first.
  outputs: z.array(
    z.object({
      id: z.string().uuid(),
      path: z.string(),
      mime: z.string(),
      size: z.number().int().nullable(),
      version: z.number().int(),
    })
  ),
  // Files people shared in the session, oldest first. messageId + index
  // open one in the file panel.
  sources: z.array(
    z.object({
      url: z.string(),
      filename: z.string(),
      size: z.number(),
      contentType: z.string(),
      messageId: z.string().uuid(),
      index: z.number().int(),
    })
  ),
})
