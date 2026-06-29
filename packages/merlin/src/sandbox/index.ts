import { Sandbox } from "railway"
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
  options?: SandboxOptions
): Promise<T> {
  const sandbox = await Sandbox.create({ ...DEFAULTS, ...options })
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
