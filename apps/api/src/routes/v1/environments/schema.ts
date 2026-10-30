import { z } from "@hono/zod-openapi"

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

export const listEnvironmentsResponseSchema = z.object({
  environments: z.array(environmentSchema),
  canManage: z.boolean(),
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

export const createEnvironmentRequestSchema = z.object({
  name: nameSchema,
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
