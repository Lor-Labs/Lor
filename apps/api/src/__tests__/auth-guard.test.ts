import { describe, expect, it } from "vitest"
import { client } from "./helpers"

describe("Auth Guard — unauthenticated requests return 401", () => {
  it("GET /v1/dms", async () => {
    const res = await client.v1.dms.$get({
      query: {
        page: 1,
        perPage: 50,
      },
    })
    expect(res.status).toBe(401)
  })

  it("GET /v1/notification-settings", async () => {
    const res = await client.v1["notification-settings"].$get()
    expect(res.status).toBe(401)
  })

  it("POST /v1/loops/:loopId/discard-draft", async () => {
    const res = await client.v1.loops[":loopId"]["discard-draft"].$post({
      param: { loopId: "00000000-0000-4000-8000-000000000001" },
    })
    expect(res.status).toBe(401)
  })
})
