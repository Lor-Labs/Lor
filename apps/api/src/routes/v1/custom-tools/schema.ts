import { z } from "@hono/zod-openapi"
import { customToolMethodEnum } from "@repo/db/schema"
import { CUSTOM_TOOL_NAME_REGEX } from "@repo/merlin/custom-tools"

export const customToolsWorkspaceParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const customToolIdParamsSchema = customToolsWorkspaceParamsSchema.extend(
  {
    toolId: z
      .string()
      .uuid()
      .openapi({ param: { name: "toolId", in: "path", required: true } }),
  }
)

const methodSchema = z.enum(customToolMethodEnum.enumValues)

const nameSchema = z
  .string()
  .regex(
    CUSTOM_TOOL_NAME_REGEX,
    "Names are snake_case identifiers, 3–64 chars (e.g. query_orders)"
  )

// Model-facing JSON Schema for the tool's args. Kept minimal on purpose: it
// must be an object schema; everything else is the author's contract with the
// model. Size-capped so a pathological schema can't bloat every prompt.
const argsSchemaSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => v.type === "object", {
    message: 'argsSchema must be a JSON Schema with "type": "object"',
  })
  .refine((v) => JSON.stringify(v).length <= 16_384, {
    message: "argsSchema is too large (16KB max)",
  })

const headersSchema = z
  .record(z.string().trim().min(1).max(128), z.string().max(4096))
  .refine((v) => Object.keys(v).length <= 20, {
    message: "At most 20 headers",
  })

// Secret values are write-only: accepted here, returned as names only.
const secretsSchema = z
  .record(
    z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
    z.string().min(1).max(4096)
  )
  .refine((v) => Object.keys(v).length <= 20, {
    message: "At most 20 secrets",
  })

export const customToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  argsSchema: z.record(z.string(), z.unknown()),
  method: methodSchema,
  urlTemplate: z.string(),
  headers: z.record(z.string(), z.string()),
  bodyTemplate: z.string().nullable(),
  secretNames: z.array(z.string()),
  // How many agent profiles grant this tool explicitly — shown in the
  // delete confirmation (deleting cascades those grants away).
  usedByProfiles: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const listCustomToolsResponseSchema = z.object({
  tools: z.array(customToolSchema),
})

export const createCustomToolRequestSchema = z.object({
  name: nameSchema,
  description: z.string().trim().min(1).max(1000),
  argsSchema: argsSchemaSchema,
  method: methodSchema,
  urlTemplate: z.string().trim().min(1).max(2048),
  headers: headersSchema.default({}),
  bodyTemplate: z.string().max(8192).nullable().default(null),
  secrets: secretsSchema.default({}),
})

export const customToolResponseSchema = z.object({
  tool: customToolSchema,
})

// Secrets patch merges: string sets/replaces a value, null deletes it.
export const updateCustomToolRequestSchema = z
  .object({
    name: nameSchema.optional(),
    description: z.string().trim().min(1).max(1000).optional(),
    argsSchema: argsSchemaSchema.optional(),
    method: methodSchema.optional(),
    urlTemplate: z.string().trim().min(1).max(2048).optional(),
    headers: headersSchema.optional(),
    bodyTemplate: z.string().max(8192).nullable().optional(),
    secrets: z
      .record(
        z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
        z.string().min(1).max(4096).nullable()
      )
      .optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: "Nothing to update",
  })

export const deleteCustomToolResponseSchema = z.object({
  success: z.literal(true),
})
