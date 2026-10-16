import { z } from "@hono/zod-openapi"
import {
  mcpServerAuthModeEnum,
  mcpServerOAuthStatusEnum,
} from "@repo/db/schema"

export const mcpServersWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const mcpServerIdParamsSchema = mcpServersWorkspaceParamsSchema.extend({
  mcpServerId: z
    .string()
    .uuid()
    .openapi({ param: { name: "mcpServerId", in: "path", required: true } }),
})

const nameSchema = z.string().trim().min(1).max(80)
const descriptionSchema = z.string().trim().max(500)

// Secret names are identifier-shaped — they're referenced as {{secrets.NAME}}.
const secretNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)

// RFC 7230 token — also excludes CR/LF so a header name can't split a request.
const HEADER_NAME_REGEX = /^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/
// Any C0 control (except tab) or DEL would corrupt the wire format, and
// anything above latin-1 can't be encoded as a header byte at all. Rendered
// values get the same check at substitution time (renderTemplate), since
// secrets and args aren't seen here.
function invalidHeaderValueChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if ((code < 0x20 && code !== 0x09) || code === 0x7f || code > 0xff) {
      return true
    }
  }
  return false
}
const headersSchema = z
  .record(
    z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(HEADER_NAME_REGEX, { message: "Invalid header name" }),
    z
      .string()
      .max(4096)
      .refine((v) => !invalidHeaderValueChar(v), {
        message:
          "Header values must not contain control or non-latin-1 characters",
      })
  )
  .refine((v) => Object.keys(v).length <= 20, {
    message: "At most 20 headers",
  })

// Secret values are write-only: accepted here, returned as names only.
const secretsSchema = z
  .record(secretNameSchema, z.string().min(1).max(4096))
  .refine((v) => Object.keys(v).length <= 20, {
    message: "At most 20 secrets",
  })

const enabledToolsSchema = z.array(z.string().trim().min(1).max(128)).max(200)

export const mcpServerAuthModeSchema = z.enum(mcpServerAuthModeEnum.enumValues)
export const mcpServerOAuthStatusSchema = z.enum(
  mcpServerOAuthStatusEnum.enumValues
)

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  url: z.string(),
  authMode: mcpServerAuthModeSchema,
  oauthStatus: mcpServerOAuthStatusSchema.nullable(),
  oauthAuthorizedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  oauthAuthorizedAt: z.string().nullable(),
  headers: z.record(z.string(), z.string()),
  secretNames: z.array(z.string()),
  enabledTools: z.array(z.string()),
  // How many agent profiles grant this server explicitly — shown in the
  // delete confirmation (deleting cascades those grants away).
  usedByProfiles: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listMcpServersResponseSchema = z.object({
  servers: z.array(mcpServerSchema),
})

export const mcpServerResponseSchema = z.object({
  server: mcpServerSchema,
})

export const createMcpServerRequestSchema = z
  .object({
    name: nameSchema,
    // Workspace context for Lor ("our production Postgres — use for
    // signup/usage questions"); optional but recommended.
    description: descriptionSchema.default(""),
    url: z.string().trim().min(1).max(2048),
    authMode: mcpServerAuthModeSchema.default("static"),
    headers: headersSchema.default({}),
    secrets: secretsSchema.default({}),
    enabledTools: enabledToolsSchema.default([]),
  })
  .superRefine((value, ctx) => {
    if (value.authMode !== "oauth") return
    if (
      Object.keys(value.headers).some(
        (header) => header.toLowerCase() === "authorization"
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["headers"],
        message: "OAuth servers cannot define an Authorization header",
      })
    }
    if (value.enabledTools.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["enabledTools"],
        message: "OAuth tools can only be enabled after authorization",
      })
    }
  })

// Secrets patch merges: string sets/replaces a value, null deletes it.
export const updateMcpServerRequestSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    url: z.string().trim().min(1).max(2048).optional(),
    headers: headersSchema.optional(),
    secrets: z
      .record(secretNameSchema, z.string().min(1).max(4096).nullable())
      .optional(),
    enabledTools: enabledToolsSchema.optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: "Nothing to update",
  })

export const deleteMcpServerResponseSchema = z.object({
  success: z.literal(true),
})

// Pre-save discovery: the form's current url/headers/secrets, nothing
// persisted. Secret values arrive plaintext and are used for this one
// handshake only.
export const discoverMcpServerRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  headers: headersSchema.default({}),
  secrets: secretsSchema.default({}),
})

export const discoverMcpServerResponseSchema = z.object({
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      readOnlyHint: z.boolean().optional(),
    })
  ),
})

// Saved-server discovery: stored url/headers/secrets, optionally overlaid
// with unsaved edits (new plaintext secrets included) so a change can be
// tested before saving.
export const rediscoverMcpServerRequestSchema = z.object({
  url: z.string().trim().min(1).max(2048).optional(),
  headers: headersSchema.optional(),
  secrets: secretsSchema.default({}),
})

export const startMcpServerOAuthRequestSchema = z.object({
  disclosureConfirmed: z.literal(true),
})

export const startMcpServerOAuthResponseSchema = z.object({
  authorizationUrl: z.string().url(),
})

export const mcpServerOAuthCallbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).max(1024),
  error: z.string().max(256).optional(),
})

export const completeMcpServerOAuthRequestSchema = z.object({
  enabledTools: enabledToolsSchema,
})
