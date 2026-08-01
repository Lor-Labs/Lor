import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ track: vi.fn() }))

vi.mock("@repo/db", () => ({ db: {}, eq: vi.fn(), schema: {} }))
vi.mock("./client", () => ({
  getAutumn: () => ({ track: mocks.track }),
}))

import { trackCredits } from "./autumn"

describe("trackCredits", () => {
  beforeEach(() => vi.clearAllMocks())

  it("uses the ledger row id as the provider idempotency key", async () => {
    mocks.track.mockResolvedValue(undefined)

    await expect(trackCredits("workspace-1", 7, "usage-1")).resolves.toBe(
      "debited"
    )
    expect(mocks.track).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "workspace-1", value: 7 }),
      { headers: { "Idempotency-Key": "usage-1" } }
    )
  })

  it("treats a duplicate idempotency key as an already-completed debit", async () => {
    mocks.track.mockRejectedValue({ statusCode: 409 })

    await expect(trackCredits("workspace-1", 7, "usage-1")).resolves.toBe(
      "debited"
    )
  })
})
