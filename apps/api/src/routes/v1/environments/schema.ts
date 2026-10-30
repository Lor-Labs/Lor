import { z } from "@hono/zod-openapi"

// A repo's environment for code sessions
// (reference/dev-environment-runbook.md §2). The repo is two path segments,
// so its slash needs no encoding.
export const environmentParamsSchema = z.object({
  workspaceSlug: z.string().openapi({
    param: { name: "workspaceSlug", in: "path", required: true },
  }),
  owner: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/)
    .openapi({ param: { name: "owner", in: "path", required: true } }),
  repo: z
    .string()
    .regex(/^[A-Za-z0-9._-]+$/)
    .openapi({ param: { name: "repo", in: "path", required: true } }),
})

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

export const environmentResponseSchema = z.object({
  environment: z
    .object({
      fileName: z.string(),
      updatedAt: z.string(),
      updatedByName: z.string().nullable(),
    })
    .nullable(),
  // Keys only: values never leave the server except through reveal.
  variables: z.array(z.object({ key: z.string() })),
  canManage: z.boolean(),
})

export const saveEnvironmentRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  // The whole list: keys left out are deleted. A missing value keeps the
  // saved one, so editing never needs to reveal values.
  variables: z
    .array(
      z.object({
        key: z.string().regex(ENV_KEY, "Keys are letters, digits and _"),
        value: z
          .string()
          .max(32 * 1024)
          .optional(),
      })
    )
    .max(300),
})

export const revealEnvironmentResponseSchema = z.object({
  variables: z.array(z.object({ key: z.string(), value: z.string() })),
})
