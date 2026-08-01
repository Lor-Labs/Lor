import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  computeCostUsd: vi.fn(),
  computeCredits: vi.fn(),
  getRate: vi.fn(),
  insertReturning: vi.fn(),
  insertValues: vi.fn(),
  selectLimit: vi.fn(),
  trackCredits: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
}))

vi.mock("@repo/db", () => {
  const usageEvent = {
    creditsDebited: "creditsDebited",
    debitStatus: "debitStatus",
    id: "id",
    idempotencyKey: "idempotencyKey",
    workspaceId: "workspaceId",
  }

  return {
    db: {
      insert: vi.fn(() => ({ values: mocks.insertValues })),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({ limit: mocks.selectLimit })),
        })),
      })),
      update: vi.fn(() => ({ set: mocks.updateSet })),
    },
    eq: vi.fn(),
    schema: { usageEvent },
  }
})

vi.mock("./autumn", () => ({ trackCredits: mocks.trackCredits }))
vi.mock("./credits", () => ({
  computeCostUsd: mocks.computeCostUsd,
  computeCredits: mocks.computeCredits,
}))
vi.mock("./rates", () => ({ getRate: mocks.getRate }))

import { recordUsage } from "./ledger"

const usage = {
  workspaceId: "workspace-1",
  tool: "merlin.respond",
  model: "test-model",
  inputTokens: 100,
}
const refs = { messageId: "message-1" }

describe("recordUsage debit recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getRate.mockResolvedValue({})
    mocks.computeCostUsd.mockReturnValue(0.01)
    mocks.computeCredits.mockReturnValue(7)
    mocks.insertValues.mockReturnValue({
      onConflictDoNothing: vi.fn(() => ({
        returning: mocks.insertReturning,
      })),
    })
    mocks.trackCredits.mockResolvedValue("debited")
    mocks.updateSet.mockReturnValue({ where: mocks.updateWhere })
    mocks.updateWhere.mockResolvedValue(undefined)
  })

  it("persists a pending debit and sends its row id to Autumn", async () => {
    mocks.insertReturning.mockResolvedValue([
      {
        id: "usage-1",
        workspaceId: "workspace-1",
        creditsDebited: 7,
        debitStatus: "pending",
      },
    ])

    await recordUsage(usage, refs)

    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        debitStatus: "pending",
        idempotencyKey: "message-1:merlin.respond",
      })
    )
    expect(mocks.trackCredits).toHaveBeenCalledWith("workspace-1", 7, "usage-1")
    expect(mocks.updateSet).toHaveBeenCalledWith({ debitStatus: "debited" })
    expect(mocks.selectLimit).not.toHaveBeenCalled()
  })

  it("resumes an existing pending debit after an insert conflict", async () => {
    mocks.insertReturning.mockResolvedValue([])
    mocks.selectLimit.mockResolvedValue([
      {
        id: "usage-existing",
        workspaceId: "workspace-1",
        creditsDebited: 11,
        debitStatus: "pending",
      },
    ])

    await recordUsage(usage, refs)

    expect(mocks.trackCredits).toHaveBeenCalledWith(
      "workspace-1",
      11,
      "usage-existing"
    )
    expect(mocks.updateSet).toHaveBeenCalledWith({ debitStatus: "debited" })
  })

  it("does not retry a debit that is already terminal", async () => {
    mocks.insertReturning.mockResolvedValue([])
    mocks.selectLimit.mockResolvedValue([
      {
        id: "usage-existing",
        workspaceId: "workspace-1",
        creditsDebited: 7,
        debitStatus: "debited",
      },
    ])

    await recordUsage(usage, refs)

    expect(mocks.trackCredits).not.toHaveBeenCalled()
    expect(mocks.updateSet).not.toHaveBeenCalled()
  })
})
