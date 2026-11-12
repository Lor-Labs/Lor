import { z } from "@hono/zod-openapi"

// Preview links (reference/planned/sandbox-browser-runbook.md §8).

export const previewParamsSchema = z.object({
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]{20,64}$/)
    .openapi({ param: { name: "token", in: "path" } }),
})

// `sign_in_required` and `no_access` say nothing about the session: a private
// link shows it only to people in its workspace. `sessionId` and
// `workspaceSlug` (to open it in Lor) go to members only.
export const previewResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("sign_in_required") }),
  z.object({ status: z.literal("no_access") }),
  z.object({
    status: z.literal("ready"),
    access: z.enum(["private", "public"]),
    title: z.string(),
    workspaceName: z.string(),
    sessionId: z.string().nullable(),
    workspaceSlug: z.string().nullable(),
    viewer: z.object({
      signedIn: z.boolean(),
      // Points and leaves notes.
      annotate: z.boolean(),
      // May take the browser's mouse and keyboard.
      control: z.boolean(),
    }),
  }),
])

// `asleep`: a signed-out visitor, with nobody signed in watching.
// `unavailable`: the session has no sandbox, or one from before preview links.
export const previewViewResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    url: z.string(),
    role: z.enum(["control", "watch"]),
    controller: z.object({ userId: z.string(), name: z.string() }).nullable(),
  }),
  z.object({ status: z.literal("asleep") }),
  z.object({ status: z.literal("unavailable") }),
])

export const previewSeenRequestSchema = z.object({
  annotations: z.boolean().default(false),
})

export const previewSeenResponseSchema = z.object({ ok: z.literal(true) })
