import { z } from "@hono/zod-openapi"

export const waitlistRequestSchema = z.object({
  // Postgres text rejects NUL, and control characters are never valid email.
  email: z
    .string()
    .refine(
      (value) => !/\p{Cc}/u.test(value),
      "Email contains invalid characters"
    ),
})

export const waitlistSuccessSchema = z.object({
  success: z.literal(true),
})

export const waitlistErrorSchema = z.object({
  error: z.string(),
})
