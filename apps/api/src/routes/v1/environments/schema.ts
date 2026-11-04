import { z } from "@hono/zod-openapi"
import { CODE_SANDBOX_MEMORY_OPTIONS_MB } from "@repo/lor/dev-env/environments"

// Environments for code sessions (reference/dev-environment-runbook.md §2).
// The model holds several repos per environment; this API takes one until
// sessions can hold several.

export const environmentsParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
})

export const environmentIdParamsSchema = environmentsParamsSchema.extend({
  environmentId: z
    .string()
    .uuid()
    .openapi({ param: { name: "environmentId", in: "path", required: true } }),
})

const REPO_FULL_NAME = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export const listEnvironmentsQuerySchema = z.object({
  // Only environments that include this repo (owner/repo).
  repo: z.string().regex(REPO_FULL_NAME).optional(),
})

export const environmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  // Null: the default size (listEnvironments' `defaultSandboxMemoryMb`).
  sandboxMemoryMb: z.number().int().nullable(),
  updatedAt: z.string(),
  updatedByName: z.string().nullable(),
  repos: z.array(
    z.object({
      repoFullName: z.string(),
      // Keys only: values never leave the server except through reveal.
      files: z.array(
        z.object({
          id: z.string().uuid(),
          path: z.string(),
          keys: z.array(z.string()),
        })
      ),
    })
  ),
})

// The sandbox sizes an environment can pick, with what each costs while it
// runs, so the editor shows the price without its own copy of the rate.
export const listEnvironmentsResponseSchema = z.object({
  environments: z.array(environmentSchema),
  canManage: z.boolean(),
  defaultSandboxMemoryMb: z.number().int(),
  sandboxSizes: z.array(
    z.object({ memoryMb: z.number().int(), creditsPerHour: z.number() })
  ),
})

export const environmentResponseSchema = z.object({
  environment: environmentSchema,
})

const nameSchema = z.string().trim().min(1).max(80)
const pathSchema = z.string().trim().min(1).max(200)
const variablesSchema = z
  .array(
    z.object({
      key: z.string().regex(ENV_KEY, "Keys are letters, digits and _"),
      // Missing on update: keep the saved value, so editing never needs a
      // reveal. Required for a new key.
      value: z
        .string()
        .max(32 * 1024)
        .optional(),
    })
  )
  .max(300)

// Null: the default. Left out on update: unchanged.
const sandboxMemorySchema = z
  .number()
  .int()
  .refine(
    (mb) => (CODE_SANDBOX_MEMORY_OPTIONS_MB as readonly number[]).includes(mb),
    "Pick one of the listed sandbox sizes"
  )
  .nullable()
  .optional()

export const createEnvironmentRequestSchema = z.object({
  name: nameSchema,
  sandboxMemoryMb: sandboxMemorySchema,
  repo: z.string().regex(REPO_FULL_NAME),
  files: z
    .array(z.object({ path: pathSchema, variables: variablesSchema }))
    .min(1)
    .max(10),
})

// The whole file list for the environment's repo: files left out are
// deleted; a file without an id is new.
export const updateEnvironmentRequestSchema = z.object({
  name: nameSchema,
  sandboxMemoryMb: sandboxMemorySchema,
  files: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        path: pathSchema,
        variables: variablesSchema,
      })
    )
    .min(1)
    .max(10),
})

export const revealEnvironmentResponseSchema = z.object({
  files: z.array(
    z.object({
      id: z.string().uuid(),
      path: z.string(),
      variables: z.array(z.object({ key: z.string(), value: z.string() })),
    })
  ),
})

export const deleteEnvironmentResponseSchema = z.object({
  success: z.literal(true),
})
