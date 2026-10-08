import { z } from "@hono/zod-openapi"
import { normalizeDomain } from "@repo/utils/domain"

export const companySiteQuerySchema = z.object({
  domain: z
    .string()
    .max(2048)
    .refine((value) => normalizeDomain(value) !== null, {
      message: "Enter a website like acme.com",
    })
    .openapi({
      param: { name: "domain", in: "query", required: true },
      example: "acme.com",
    }),
})

export const companySiteResponseSchema = z.object({
  name: z.string().nullable(),
  description: z.string().nullable(),
})
