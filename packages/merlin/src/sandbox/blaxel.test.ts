import { beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  createIfNotExists: vi.fn(),
  delete: vi.fn(),
  updateLifecycle: vi.fn(),
}))

vi.mock("@blaxel/core", () => ({
  SandboxInstance: sdk,
}))

vi.mock("../logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}))

import { withPersistentSandbox, withTaskSandbox } from "./blaxel"

const healthyProcess = {
  status: "completed",
  exitCode: 0,
  stdout: "",
  stderr: "",
}

function fakeSandbox({
  healthy = true,
  idleTtl = "7d",
  workspaceDisk = true,
}: {
  healthy?: boolean
  idleTtl?: string
  workspaceDisk?: boolean
} = {}) {
  return {
    spec: {
      lifecycle: {
        expirationPolicies: [
          { action: "delete", type: "ttl-idle", value: idleTtl },
        ],
      },
      volumes: workspaceDisk
        ? [
            {
              name: "workspace",
              mountPath: "/workspace",
              type: "ephemeral",
              sizeMb: 8192,
            },
          ]
        : [],
    },
    process: {
      exec: vi
        .fn()
        .mockResolvedValue(
          healthy
            ? healthyProcess
            : { ...healthyProcess, status: "failed", exitCode: 1 }
        ),
    },
    h2Session: { close: vi.fn() },
  }
}

describe("withPersistentSandbox", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sdk.delete.mockResolvedValue({})
  })

  it("uses a healthy sandbox with the configured workspace disk", async () => {
    const sandbox = fakeSandbox()
    sdk.createIfNotExists.mockResolvedValue(sandbox)

    const result = await withPersistentSandbox(
      "code-1",
      "7d",
      async (current) => {
        expect(current).toBe(sandbox)
        return "ok"
      }
    )

    expect(result).toBe("ok")
    expect(sdk.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        lifecycle: {
          expirationPolicies: [
            { action: "delete", type: "ttl-idle", value: "7d" },
          ],
        },
        volumes: [
          expect.objectContaining({
            mountPath: "/workspace",
            sizeMb: 8192,
            type: "ephemeral",
          }),
        ],
      })
    )
    expect(sdk.createIfNotExists).toHaveBeenCalledTimes(1)
    expect(sdk.delete).not.toHaveBeenCalled()
    expect(sandbox.process.exec).toHaveBeenCalledWith(
      expect.objectContaining({ command: "true", waitForCompletion: true })
    )
    expect(sandbox.h2Session.close).toHaveBeenCalledOnce()
  })

  it("uses the short task TTL", async () => {
    const sandbox = fakeSandbox({ idleTtl: "24h" })
    sdk.createIfNotExists.mockResolvedValue(sandbox)

    await withTaskSandbox("1", async (current) => {
      expect(current).toBe(sandbox)
    })

    expect(sdk.createIfNotExists).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "task-1",
        lifecycle: {
          expirationPolicies: [
            { action: "delete", type: "ttl-idle", value: "24h" },
          ],
        },
      })
    )
  })

  it("updates a healthy sandbox to the requested TTL without deleting it", async () => {
    const original = fakeSandbox({ idleTtl: "14d" })
    const updated = fakeSandbox()
    sdk.createIfNotExists.mockResolvedValue(original)
    sdk.updateLifecycle.mockResolvedValue(updated)

    await withPersistentSandbox("code-1", "7d", async (current) => {
      expect(current).toBe(updated)
    })

    expect(sdk.updateLifecycle).toHaveBeenCalledWith("code-1", {
      expirationPolicies: [{ action: "delete", type: "ttl-idle", value: "7d" }],
    })
    expect(sdk.delete).not.toHaveBeenCalled()
    expect(original.process.exec).toHaveBeenCalledOnce()
    expect(original.h2Session.close).toHaveBeenCalledOnce()
    expect(updated.h2Session.close).toHaveBeenCalledOnce()
  })

  it("preserves a sandbox when its lifecycle update fails", async () => {
    const sandbox = fakeSandbox({ idleTtl: "14d" })
    const updateError = new Error("control plane unavailable")
    sdk.createIfNotExists.mockResolvedValue(sandbox)
    sdk.updateLifecycle.mockRejectedValue(updateError)
    const callback = vi.fn()

    await expect(withPersistentSandbox("code-1", "7d", callback)).rejects.toBe(
      updateError
    )

    expect(sdk.delete).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(sandbox.h2Session.close).toHaveBeenCalledOnce()
  })

  it("recreates a sandbox with no workspace disk", async () => {
    const original = fakeSandbox({ workspaceDisk: false })
    const replacement = fakeSandbox()
    sdk.createIfNotExists
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(replacement)

    await withPersistentSandbox("code-1", "7d", async (current) => {
      expect(current).toBe(replacement)
    })

    expect(original.process.exec).not.toHaveBeenCalled()
    expect(original.h2Session.close).toHaveBeenCalledOnce()
    expect(sdk.delete).toHaveBeenCalledWith("code-1")
    expect(replacement.process.exec).toHaveBeenCalledOnce()
    expect(replacement.h2Session.close).toHaveBeenCalledOnce()
  })

  it("recreates a sandbox whose process runtime is unhealthy", async () => {
    const original = fakeSandbox({ healthy: false })
    const replacement = fakeSandbox()
    sdk.createIfNotExists
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(replacement)

    await withPersistentSandbox("code-1", "7d", async (current) => {
      expect(current).toBe(replacement)
    })

    expect(original.process.exec).toHaveBeenCalledOnce()
    expect(sdk.delete).toHaveBeenCalledWith("code-1")
    expect(replacement.process.exec).toHaveBeenCalledOnce()
  })

  it("does not delete a sandbox when the health probe is inconclusive", async () => {
    const sandbox = fakeSandbox()
    const probeError = new Error("connection reset")
    sandbox.process.exec.mockRejectedValue(probeError)
    sdk.createIfNotExists.mockResolvedValue(sandbox)
    const callback = vi.fn()

    await expect(withPersistentSandbox("code-1", "7d", callback)).rejects.toBe(
      probeError
    )

    expect(sdk.delete).not.toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    expect(sandbox.h2Session.close).toHaveBeenCalledOnce()
  })

  it("stops after one unhealthy replacement", async () => {
    const original = fakeSandbox({ healthy: false })
    const replacement = fakeSandbox({ healthy: false })
    sdk.createIfNotExists
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(replacement)
    const callback = vi.fn()

    await expect(
      withPersistentSandbox("code-1", "7d", callback)
    ).rejects.toThrow("replacement sandbox code-1 is unhealthy")

    expect(sdk.createIfNotExists).toHaveBeenCalledTimes(2)
    expect(sdk.delete).toHaveBeenCalledTimes(1)
    expect(callback).not.toHaveBeenCalled()
    expect(replacement.h2Session.close).toHaveBeenCalledOnce()
  })
})
