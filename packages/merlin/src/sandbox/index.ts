import { Sandbox, type SandboxTemplate } from "railway"
import { logger } from "../logger"

// Railway does not export create options; derive them from Sandbox.create.
export type SandboxOptions = NonNullable<Parameters<typeof Sandbox.create>[0]>

// ISOLATED blocks private service access; project tokens need project-token auth.
const DEFAULTS: SandboxOptions = {
  networkIsolation: "ISOLATED",
  authType: "project-token",
}

export async function withSandbox<T>(
  fn: (sandbox: Sandbox) => Promise<T>,
  options?: SandboxOptions,
  // Boot from a named checkpoint (string) or a template instead of the base
  // image — how the workbench gets its provisioned toolchain.
  from?: SandboxTemplate | string
): Promise<T> {
  const merged = { ...DEFAULTS, ...options }
  const sandbox =
    from === undefined
      ? await Sandbox.create(merged)
      : typeof from === "string"
        ? await Sandbox.create(from, merged)
        : await Sandbox.create(from, merged)
  logger.info({ sandboxId: sandbox.id }, "Sandbox: created")
  try {
    return await fn(sandbox)
  } finally {
    await sandbox.destroy().then(
      () => logger.info({ sandboxId: sandbox.id }, "Sandbox: destroyed"),
      (err) =>
        logger.error({ err, sandboxId: sandbox.id }, "Sandbox: destroy failed")
    )
  }
}

export type { Sandbox }
