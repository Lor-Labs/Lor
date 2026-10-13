import { z } from "@hono/zod-openapi"
import { hintKeyEnum } from "@repo/db/schema"

const hintKeySchema = z.enum(hintKeyEnum.enumValues)

export const hintParamsSchema = z.object({
  key: hintKeySchema.openapi({
    param: { name: "key", in: "path", required: true },
    example: "lor_intro",
  }),
})

export const listHintsResponseSchema = z.object({
  dismissed: z.array(hintKeySchema),
})

export const dismissHintResponseSchema = z.object({
  success: z.literal(true),
})
