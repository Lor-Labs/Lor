import { z } from "@hono/zod-openapi"
import {
  agentSessionModeEnum,
  agentSessionOriginEnum,
  harnessKindEnum,
  TOUCH_ACTIONS,
  TOUCH_KINDS,
} from "@repo/db/schema"
import { CODE_SANDBOX_MEMORY_OPTIONS_MB } from "@repo/lor/dev-env/environments"
import { messageWithAuthorSchema } from "@/lib/helpers/openapi/message-schemas"

export const sessionParamsSchema = z.object({
  sessionId: z
    .string()
    .uuid()
    .openapi({
      param: { name: "sessionId", in: "path", required: true },
    }),
})

const harnessCommandSchema = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string().optional(),
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
    harness: z.enum(harnessKindEnum.enumValues),
    repoFullName: z.string().nullable(),
    baseBranch: z.string().nullable(),
    newBranch: z.string().nullable(),
    environmentId: z.string().uuid().nullable(),
    // The size picked for this session; null: its environment's or the default.
    sandboxMemoryMb: z.number().int().nullable(),
    uncommittedAdditions: z.number().int().nullable(),
    uncommittedDeletions: z.number().int().nullable(),
    sourceSessionId: z.string().uuid().nullable(),
    forkedFromMessageId: z.string().uuid().nullable(),
    title: z.string(),
    titleEditedAt: z.string().nullable(),
    loopId: z.string().uuid().nullable(),
    triggerId: z.string().uuid().nullable(),
    triggerSubject: z.string().nullable(),
    archivedAt: z.string().nullable(),
    archivedById: z.string().uuid().nullable(),
    lastActivityAt: z.string(),
    // The harness's "/" commands and Codex's "$" skills, from its last turn.
    harnessCommands: z
      .object({
        slash: z.array(harnessCommandSchema),
        mentions: z.array(harnessCommandSchema),
      })
      .nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("AgentSession")

// A message the session started with. The full messages come from
// /sessions/{id}/context.
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

// Act events waiting for the session's run to finish
// (reference/act-sessions-runbook.md).
export const actWaitingResponseSchema = z.object({
  count: z.number().int(),
})

export const dropActWaitingResponseSchema = z.object({
  dropped: z.number().int(),
})

// A code session's Browser tab (reference/dev-environment-runbook.md §3):
// the ports listening in its sandbox, and a URL for one of them.
export const sessionPortsResponseSchema = z.object({
  // False: the session has no sandbox yet.
  available: z.boolean(),
  ports: z.array(
    z.object({ port: z.number().int(), process: z.string().nullable() })
  ),
})

// `query`: a private preview's token, appended after the page's path.
export const openPortResponseSchema = z.object({
  url: z.string(),
  query: z.string(),
})

// A WebSocket URL to the caller's own shell in the session's sandbox, with a
// short-lived token (reference/dev-environment-runbook.md §4).
export const openTerminalResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
})

// The session browser (reference/planned/sandbox-browser-runbook.md §4).
// `controller`: the person driving it; null while Lor may.
const browserControllerSchema = z
  .object({ userId: z.string(), name: z.string() })
  .nullable()

// `unavailable`: the sandbox's image predates the browser, so the panel
// keeps the port preview. `url`: the live view's page under this caller's
// grant, for an iframe or the phone's in-app browser; `role` says whether
// this caller's view takes input.
export const openBrowserResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    url: z.string(),
    role: z.enum(["control", "watch"]),
    controller: browserControllerSchema,
  }),
  z.object({ status: z.literal("unavailable") }),
])

export const browserControlRequestSchema = z.object({
  take: z.boolean(),
})

export const browserControlResponseSchema = z.object({
  controller: browserControllerSchema,
})

export const openBrowserPageRequestSchema = z.object({
  port: z.number().int().min(1).max(65535),
  path: z
    .string()
    .max(2000)
    .regex(/^\/[^\s]*$/, "use a path that starts with /")
    .default("/"),
})

// Page annotations: pick an element and open its note (the person in
// control), wait for that note to be saved or removed, stop picking (an open
// note is kept as written) or clear this person's annotations off the page.
export const browserAnnotateRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("pick"),
    id: z.string().uuid(),
    number: z.number().int().min(1).max(99),
  }),
  z.object({ mode: z.literal("wait"), id: z.string().uuid() }),
  z.object({ mode: z.enum(["stop", "clear"]) }),
])

// `image`: a JPEG crop around the element, base64. `reopened`: a click on one
// of your pins opened its note again. `stopped`: each of your notes, null for
// a removed one. `timeout`: nothing happened within about 50 s, so the panel
// asks again.
export const browserAnnotateResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("picked"),
    element: z.object({
      selector: z.string(),
      tag: z.string(),
      role: z.string().nullable(),
      name: z.string().nullable(),
      text: z.string(),
      html: z.string(),
      url: z.string(),
    }),
    image: z.string().nullable(),
  }),
  z.object({ status: z.literal("reopened"), id: z.string() }),
  z.object({ status: z.literal("saved"), note: z.string() }),
  z.object({
    status: z.literal("stopped"),
    notes: z.array(z.object({ id: z.string(), note: z.string().nullable() })),
  }),
  z.object({ status: z.enum(["timeout", "no_page", "removed", "ok"]) }),
])

export const openBrowserPageResponseSchema = z.object({
  status: z.literal("ok"),
})

// A repo's run setup, `.lor/environment.json`: its services and whether each
// runs in the session's sandbox. `error`: why the file is invalid.
export const sessionSetupResponseSchema = z.object({
  status: z.enum(["no_sandbox", "missing", "invalid", "ready"]),
  error: z.string().nullable(),
  install: z.string().nullable(),
  services: z.array(
    z.object({
      name: z.string(),
      command: z.string(),
      port: z.number().int(),
      cwd: z.string().nullable(),
      // Part of "the app" that Start app runs (`default` is not false).
      default: z.boolean(),
      state: z.enum(["stopped", "starting", "running", "exited"]),
      // The end of the log of the process the Start button started.
      log: z.string().nullable(),
      // While starting: since the start, and since the log's last output. A
      // dev server in watch mode stays "starting" after it crashed.
      installing: z.boolean(),
      upMs: z.number().nullable(),
      quietMs: z.number().nullable(),
      // Ports its process listens on instead of `port`.
      otherPorts: z.array(z.number().int()),
      // The sandbox still holds its port from an earlier server.
      portHeld: z.boolean(),
    })
  ),
})

export const startServiceResponseSchema = z.object({
  status: z.enum(["started", "running"]),
})

export const stopServiceResponseSchema = z.object({
  status: z.enum(["stopped", "not_running"]),
})

export const serviceParamsSchema = sessionParamsSchema.extend({
  name: z
    .string()
    .min(1)
    .max(40)
    .openapi({ param: { name: "name", in: "path", required: true } }),
})

export const applyEnvironmentResponseSchema = z.object({
  applied: z.boolean(),
})

// A code session's environment and sandbox size, changed while it runs
// (LOR-156). Omitted fields stay as they are.
export const updateSessionSetupRequestSchema = z
  .object({
    // Null: no environment.
    environmentId: z.string().uuid().nullable().optional(),
    // Null: the environment's size, or the default.
    sandboxMemoryMb: z
      .number()
      .int()
      .refine(
        (mb) =>
          (CODE_SANDBOX_MEMORY_OPTIONS_MB as readonly number[]).includes(mb),
        "Pick one of the listed sandbox sizes"
      )
      .nullable()
      .optional(),
  })
  .refine(
    (body) =>
      body.environmentId !== undefined || body.sandboxMemoryMb !== undefined,
    { message: "Nothing to update" }
  )

// `replaced`: the session's sandbox was replaced and is coming back at the new
// size. A session without one gets the size when its sandbox is made.
export const updateSessionSetupResponseSchema = z.object({
  session: agentSessionSchema,
  replaced: z.boolean(),
})

export const portParamsSchema = sessionParamsSchema.extend({
  port: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .openapi({ param: { name: "port", in: "path", required: true } }),
})

export const getAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
  channel: z.object({ id: z.string().uuid(), name: z.string().nullable() }),
  context: z.array(sessionContextMessageSchema),
  // "Continue in Code" or a fork: the session this one comes from. Same
  // channel.
  source: z.object({ id: z.string().uuid(), title: z.string() }).nullable(),
})

// What the session started with, oldest segment first: a fork chain's
// conversations, then (at most one) the chat, asked-about message or
// continued session's messages it began from.
export const sessionContextResponseSchema = z.object({
  segments: z.array(
    z.object({
      kind: z.enum(["fork", "continued", "asked", "conversation"]),
      // fork and continued: the session the messages come from.
      session: z
        .object({ id: z.string().uuid(), title: z.string() })
        .nullable(),
      // Oldest first.
      messages: z.array(messageWithAuthorSchema),
      // Older messages in this segment that weren't sent.
      omitted: z.number().int(),
    })
  ),
})

// What the session's runs touched, newest first.
export const sessionTouchesResponseSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(TOUCH_KINDS),
      value: z.string(),
      actions: z.array(z.enum(TOUCH_ACTIONS)),
      at: z.string(),
      title: z.string().nullable(),
      // A source's state, a message's text, a call's start time.
      detail: z.string().nullable(),
      url: z.string().nullable(),
      // A message, or a call's chat, to open in the app.
      messageId: z.string().uuid().nullable(),
      provider: z.string().nullable(),
      mentions: z.array(z.object({ id: z.string(), name: z.string() })),
      otherSessions: z.array(
        z.object({ id: z.string().uuid(), title: z.string() })
      ),
      otherSessionCount: z.number().int(),
    })
  ),
})

const reviewAuthorSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().nullable(),
  bot: z.boolean(),
})

// A code session's pull request and its reviews, read live from GitHub
// (reference/planned/pr-reviews.md). Null: no pull request for its branch.
export const sessionReviewResponseSchema = z.object({
  review: z
    .object({
      pullRequest: z.object({
        number: z.number().int(),
        url: z.string(),
        title: z.string(),
        state: z.enum(["open", "closed", "merged"]),
        draft: z.boolean(),
      }),
      reviews: z.array(
        z.object({
          id: z.number().int(),
          author: reviewAuthorSchema,
          state: z.enum([
            "approved",
            "changes_requested",
            "commented",
            "dismissed",
            "pending",
          ]),
          body: z.string(),
          agentPrompt: z.string().nullable(),
          url: z.string(),
          submittedAt: z.string().nullable(),
        })
      ),
      threads: z.array(
        z.object({
          id: z.string(),
          path: z.string(),
          line: z.number().int().nullable(),
          resolved: z.boolean(),
          outdated: z.boolean(),
          reviewId: z.number().int().nullable(),
          url: z.string(),
          comments: z.array(
            z.object({
              id: z.number().int(),
              author: reviewAuthorSchema,
              body: z.string(),
              agentPrompt: z.string().nullable(),
              url: z.string(),
              createdAt: z.string(),
            })
          ),
        })
      ),
    })
    .nullable(),
})

export const forkAgentSessionRequestSchema = z.object({
  // The Lor reply whose turn the fork starts from.
  messageId: z.string().uuid(),
})

export const forkAgentSessionResponseSchema = z.object({
  session: agentSessionSchema,
})

export const rewindAgentSessionRequestSchema = z.object({
  // The Lor reply whose turn the session goes back to.
  messageId: z.string().uuid(),
})

export const rewindAgentSessionResponseSchema = z.object({
  toMessageId: z.string().uuid(),
  // A code session's files are being put back; its panels say so meanwhile.
  restoringFiles: z.boolean(),
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
  // A new session's first turn is still cloning the repo.
  z.object({ state: z.literal("preparing") }),
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
  z.object({
    kind: z.literal("patch"),
    patch: z.string(),
    // Each hunk's staging, in patch order; modified files only.
    hunks: z.array(z.enum(["staged", "unstaged", "partial"])).optional(),
  }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("too_large") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("preparing") }),
  z.object({ kind: z.literal("restoring") }),
  z.object({ kind: z.literal("restore_failed") }),
])

const lineSchema = z.number().int().min(0).max(100_000_000)

export const stageSessionChangesRequestSchema = z
  .object({
    // Exactly one of paths, all: true, or hunk.
    paths: z.array(pathSchema).min(1).max(1_000).optional(),
    all: z.boolean().optional(),
    // One hunk of the file's diff against HEAD, by its @@ ranges.
    hunk: z
      .object({
        path: pathSchema,
        oldStart: lineSchema,
        oldLines: lineSchema,
        newStart: lineSchema,
        newLines: lineSchema,
      })
      .optional(),
    staged: z.boolean(),
  })
  .refine(
    (body) =>
      [Boolean(body.paths), Boolean(body.all), Boolean(body.hunk)].filter(
        Boolean
      ).length === 1,
    { message: "Pass one of paths, all or hunk" }
  )

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
  // A new session's first turn is still cloning the repo.
  z.object({ state: z.literal("preparing") }),
  // Rebuilding from the newest checkpoint; a changes broadcast follows.
  z.object({ state: z.literal("restoring") }),
  z.object({ state: z.literal("restore_failed") }),
])

export const repoFileQuerySchema = z.object({ path: pathSchema })

export const repoFileResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), content: z.string() }),
  z.object({ kind: z.literal("image"), mime: z.string(), size: z.number() }),
  z.object({ kind: z.literal("binary") }),
  z.object({ kind: z.literal("too_large") }),
  // Not a file in the repo, or it resolves outside it.
  z.object({ kind: z.literal("missing") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("preparing") }),
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
