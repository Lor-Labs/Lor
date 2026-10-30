import { createRoute, z } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  payloadTooLargeSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  actWaitingResponseSchema,
  channelSessionsParamsSchema,
  channelSessionsQuerySchema,
  commitMessageResponseSchema,
  commitSessionChangesRequestSchema,
  commitSessionChangesResponseSchema,
  dropActWaitingResponseSchema,
  forkAgentSessionRequestSchema,
  forkAgentSessionResponseSchema,
  getAgentSessionResponseSchema,
  listChannelSessionsResponseSchema,
  openTerminalResponseSchema,
  previewPortParamsSchema,
  pullSessionChangesResponseSchema,
  pushSessionChangesResponseSchema,
  repoFileQuerySchema,
  repoFileResponseSchema,
  repoTreeResponseSchema,
  rewindAgentSessionRequestSchema,
  rewindAgentSessionResponseSchema,
  sessionChangeDiffQuerySchema,
  sessionChangeDiffResponseSchema,
  sessionChangesResponseSchema,
  sessionFilesResponseSchema,
  sessionParamsSchema,
  sessionPreviewResponseSchema,
  stageSessionChangesRequestSchema,
  startPreviewRequestSchema,
  startPreviewResponseSchema,
  updateAgentSessionRequestSchema,
  updateAgentSessionResponseSchema,
} from "@/routes/v1/sessions/schema"

export const getAgentSession = createRoute({
  path: "/sessions/{sessionId}",
  method: "get",
  summary: "Get a Lor session",
  description:
    "Returns a Lor session, its channel, and the messages it started with.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: getAgentSessionResponseSchema,
      description: "Session, channel and starting context",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetAgentSessionRoute = typeof getAgentSession

export const listSessionFiles = createRoute({
  path: "/sessions/{sessionId}/files",
  method: "get",
  summary: "List a Lor session's files",
  description:
    "Returns every file Lor made in the session and every file people shared in it.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionFilesResponseSchema,
      description: "Session outputs and sources",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListSessionFilesRoute = typeof listSessionFiles

export const getSessionChanges = createRoute({
  path: "/sessions/{sessionId}/changes",
  method: "get",
  summary: "List a code session's changes",
  description:
    "The files changed in the session's repository against its base branch, staged or not, and commits not pushed yet. Reads the session's sandbox.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionChangesResponseSchema,
      description: "Changes, or that the sandbox is gone",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetSessionChangesRoute = typeof getSessionChanges

export const getSessionChangeDiff = createRoute({
  path: "/sessions/{sessionId}/changes/diff",
  method: "get",
  summary: "Get one changed file's diff",
  description:
    "The unified diff of one file in a code session against HEAD, staged and unstaged changes together. Large and binary files are reported, not returned.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    query: sessionChangeDiffQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionChangeDiffResponseSchema,
      description: "The file's diff",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetSessionChangeDiffRoute = typeof getSessionChangeDiff

export const stageSessionChanges = createRoute({
  path: "/sessions/{sessionId}/changes/stage",
  method: "post",
  summary: "Stage or unstage a code session's files",
  description:
    "Anyone in the session can stage. Refused while Lor works in the session. Returns the changes after staging.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: stageSessionChangesRequestSchema,
      description: "Paths (or all) and whether to stage them",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionChangesResponseSchema,
      description: "Changes after staging",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type StageSessionChangesRoute = typeof stageSessionChanges

export const commitSessionChanges = createRoute({
  path: "/sessions/{sessionId}/changes/commit",
  method: "post",
  summary: "Commit a code session's staged files",
  description:
    "Commits the staged files on the session's checked-out branch, as the caller's linked GitHub account. Refused while Lor works in the session.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: commitSessionChangesRequestSchema,
      description: "The commit message",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: commitSessionChangesResponseSchema,
      description: "The commit and the changes after it",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type CommitSessionChangesRoute = typeof commitSessionChanges

export const pushSessionChanges = createRoute({
  path: "/sessions/{sessionId}/changes/push",
  method: "post",
  summary: "Push a code session's commits to GitHub",
  description:
    "Pushes the session's unpushed commits to the same branch on GitHub as the caller's linked GitHub account. The server replays them through GitHub's API; no token enters the sandbox.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: pushSessionChangesResponseSchema,
      description: "What was pushed and the changes after it",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    // GitHub's branch has commits the session doesn't: pull first.
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type PushSessionChangesRoute = typeof pushSessionChanges

export const pullSessionChanges = createRoute({
  path: "/sessions/{sessionId}/changes/pull",
  method: "post",
  summary: "Pull a code session's branch from GitHub",
  description:
    "Fetches the branch's new commits with a read-only token and merges them as the caller. Conflicts leave the merge in progress for the session to fix and commit. Refused while Lor works in the session.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: pullSessionChangesResponseSchema,
      description: "What was pulled and the changes after it",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type PullSessionChangesRoute = typeof pullSessionChanges

export const forkAgentSession = createRoute({
  path: "/sessions/{sessionId}/fork",
  method: "post",
  summary: "Fork a Lor session at one of Lor's replies",
  description:
    "Creates a session in the same channel that continues from that reply's turn: Lor's conversation up to it and, in a code session, that turn's files. The session itself is unchanged. Only the caller follows the fork.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: forkAgentSessionRequestSchema,
      description: "The reply to fork at",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.CREATED]: jsonContent({
      schema: forkAgentSessionResponseSchema,
      description: "The new session",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ForkAgentSessionRoute = typeof forkAgentSession

export const rewindAgentSession = createRoute({
  path: "/sessions/{sessionId}/rewind",
  method: "post",
  summary: "Rewind a Lor session to one of Lor's replies",
  description:
    "Moves Lor's conversation back to that reply's turn and, in a code session, puts back that turn's files, branch and commits (in the background). Later turns stay in the transcript and can be forked. Refused while Lor works or waits on an approval.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: rewindAgentSessionRequestSchema,
      description: "The reply to rewind to",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: rewindAgentSessionResponseSchema,
      description: "The session was rewound",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type RewindAgentSessionRoute = typeof rewindAgentSession

export const getRepoTree = createRoute({
  path: "/sessions/{sessionId}/repo/tree",
  method: "get",
  summary: "List a code session's repository files",
  description:
    "Every tracked and untracked file in the session's repository (ignored files left out), read from its sandbox. For the Files tab.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: repoTreeResponseSchema,
      description: "File paths, or that the sandbox is gone",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetRepoTreeRoute = typeof getRepoTree

export const getRepoFile = createRoute({
  path: "/sessions/{sessionId}/repo/file",
  method: "get",
  summary: "Read one file in a code session's repository",
  description:
    "The file's text or image metadata as it is now in the sandbox. Unsupported binary and large files are reported, not returned; a path outside the repository reads as missing.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema, query: repoFileQuerySchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: repoFileResponseSchema,
      description: "Text, image metadata, or why the file cannot be previewed",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetRepoFileRoute = typeof getRepoFile

export const getRepoImage = createRoute({
  path: "/sessions/{sessionId}/repo/image",
  method: "get",
  summary: "Preview an image in a code session's repository",
  description:
    "Private image bytes, up to 10 MiB, read from the session's repository with the same access and path checks as its Files tab.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema, query: repoFileQuerySchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: {
      description: "Image bytes",
      content: {
        "image/*": { schema: z.string().openapi({ format: "binary" }) },
      },
    },
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.REQUEST_TOO_LONG]: payloadTooLargeSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetRepoImageRoute = typeof getRepoImage

export const generateSessionCommitMessage = createRoute({
  path: "/sessions/{sessionId}/changes/message",
  method: "post",
  summary: "Write a commit message for the staged changes",
  description:
    "The small model writes a commit message from the staged diff. Billed like session titles.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: commitMessageResponseSchema,
      description: "The suggested message",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GenerateSessionCommitMessageRoute =
  typeof generateSessionCommitMessage

export const listChannelSessions = createRoute({
  path: "/channels/{channelId}/sessions",
  method: "get",
  summary: "List a channel's Lor sessions",
  description:
    "Everyone's sessions in the channel, active (most recent activity first) or archived (most recently archived first), so teammates can browse and join each other's work.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: channelSessionsParamsSchema,
    query: channelSessionsQuerySchema,
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: listChannelSessionsResponseSchema,
      description: "Channel sessions",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type ListChannelSessionsRoute = typeof listChannelSessions

export const updateAgentSession = createRoute({
  path: "/sessions/{sessionId}",
  method: "patch",
  summary: "Rename, archive or unarchive a Lor session",
  description:
    "Anyone who can write in the channel can do this. A rename stops generated titles. Archiving closes the session for everyone and stops Lor if it is running.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: updateAgentSessionRequestSchema,
      description: "Fields to update",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: updateAgentSessionResponseSchema,
      description: "The updated session",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type UpdateAgentSessionRoute = typeof updateAgentSession

export const getActWaiting = createRoute({
  path: "/sessions/{sessionId}/act-waiting",
  method: "get",
  summary: "Count a session's waiting automation events",
  description:
    "Automation events wait while the session has a run going or a person's message queued.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: actWaitingResponseSchema,
      description: "How many events wait",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetActWaitingRoute = typeof getActWaiting

export const dropActWaiting = createRoute({
  path: "/sessions/{sessionId}/act-waiting/drop",
  method: "post",
  summary: "Drop a session's waiting automation events",
  description:
    "Anyone who can write in the channel can do this. Dropped events never run.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: dropActWaitingResponseSchema,
      description: "How many events were dropped",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type DropActWaitingRoute = typeof dropActWaiting

export const getSessionPreview = createRoute({
  path: "/sessions/{sessionId}/preview",
  method: "get",
  summary: "A code session's dev server previews",
  description:
    "Running previews with their URLs, and the dev command suggested by the repo.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionPreviewResponseSchema,
      description: "Previews",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetSessionPreviewRoute = typeof getSessionPreview

export const startSessionPreview = createRoute({
  path: "/sessions/{sessionId}/preview",
  method: "post",
  summary: "Start a code session's dev server preview",
  description:
    "Runs the dev command in the session's sandbox unless it already runs, waits for the port and returns its URL. Anyone who can write in the channel can do this.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: {
    params: sessionParamsSchema,
    body: jsonContent({
      schema: startPreviewRequestSchema,
      description: "Dev command and port",
    }),
  },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: startPreviewResponseSchema,
      description: "The preview",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type StartSessionPreviewRoute = typeof startSessionPreview

export const stopSessionPreview = createRoute({
  path: "/sessions/{sessionId}/preview/{port}",
  method: "delete",
  summary: "Stop a code session's dev server preview",
  description: "Stops the dev server and revokes its URL.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: previewPortParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: sessionPreviewResponseSchema,
      description: "Previews left",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type StopSessionPreviewRoute = typeof stopSessionPreview

export const openSessionTerminal = createRoute({
  path: "/sessions/{sessionId}/terminal",
  method: "post",
  summary: "Open a terminal in a code session's sandbox",
  description:
    "Starts the terminal server if needed and returns a WebSocket URL to the caller's own shell, with a short-lived token. Anyone who can write in the channel can do this.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: openTerminalResponseSchema,
      description: "The terminal's WebSocket URL",
    }),
    [HttpStatusCodes.BAD_REQUEST]: badRequestSchema,
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.FORBIDDEN]: forbiddenSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type OpenSessionTerminalRoute = typeof openSessionTerminal
