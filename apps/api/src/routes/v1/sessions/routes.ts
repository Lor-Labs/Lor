import { createRoute } from "@hono/zod-openapi"
import * as HttpStatusCodes from "@/lib/helpers/http/status-codes"
import jsonContent from "@/lib/helpers/openapi/json-content"
import {
  badRequestSchema,
  conflictSchema,
  forbiddenSchema,
  internalServerErrorSchema,
  notFoundSchema,
  unauthorizedSchema,
} from "@/lib/helpers/openapi/schemas"
import { sessionAuthMiddleware } from "@/middleware/session-auth"
import {
  channelSessionsParamsSchema,
  channelSessionsQuerySchema,
  commitMessageResponseSchema,
  commitSessionChangesRequestSchema,
  commitSessionChangesResponseSchema,
  getAgentSessionResponseSchema,
  listChannelSessionsResponseSchema,
  pullSessionChangesResponseSchema,
  pushSessionChangesResponseSchema,
  repoFileQuerySchema,
  repoFileResponseSchema,
  repoTreeResponseSchema,
  sessionChangeDiffQuerySchema,
  sessionChangeDiffResponseSchema,
  sessionChangesResponseSchema,
  sessionFilesResponseSchema,
  sessionParamsSchema,
  stageSessionChangesRequestSchema,
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
    "The files changed in the session's repository against its base branch, staged or not, and commits made since the base. Reads the session's sandbox.",
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
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.CONFLICT]: conflictSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type PullSessionChangesRoute = typeof pullSessionChanges

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
    "The file's text as it is now in the sandbox. Binary and large files are reported, not returned; a path outside the repository reads as missing.",
  tags: ["Sessions"],
  middleware: [sessionAuthMiddleware] as const,
  request: { params: sessionParamsSchema, query: repoFileQuerySchema },
  hidden: true,
  responses: {
    [HttpStatusCodes.OK]: jsonContent({
      schema: repoFileResponseSchema,
      description: "The file's text, or why there is none",
    }),
    [HttpStatusCodes.UNAUTHORIZED]: unauthorizedSchema,
    [HttpStatusCodes.NOT_FOUND]: notFoundSchema,
    [HttpStatusCodes.INTERNAL_SERVER_ERROR]: internalServerErrorSchema,
  },
})

export type GetRepoFileRoute = typeof getRepoFile

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
