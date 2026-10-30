import { createRoute, z } from "@hono/zod-openapi"
import { isFirstAccount } from "@repo/auth"
import { getBetaAvailability } from "@repo/billing"
import { features } from "@repo/utils/features"
import { createRouter } from "@/lib/helpers/app/create-app"
import jsonContent from "@/lib/helpers/openapi/json-content"

const route = createRoute({
  method: "get",
  path: "/beta/availability",
  tags: ["Beta"],
  responses: {
    200: jsonContent({
      schema: z.object({ enabled: z.boolean(), open: z.boolean() }),
      description:
        "Public signup availability; a place is claimed only when a team is created",
    }),
  },
})

export default createRouter().openapi(route, async (c) => {
  const beta = await getBetaAvailability()
  c.header("Cache-Control", "no-store")
  // Mirrors the signup gate in @repo/auth, including the first-account
  // exception for a fresh self-hosted install.
  const open =
    (beta.enabled ? beta.open : features.selfSignups) ||
    (await isFirstAccount())
  return c.json({ ...beta, open }, 200)
})
