import { Sandbox } from "railway"
import { logger } from "../logger"

// Derived from the SDK's own create() so it can't drift (the SDK declares its
// options type but doesn't export it). Parameters<> resolves to create's last
// overload — `create(options?: CreateOptions)` — giving token / environmentId /
// networkIsolation / idleTimeoutMinutes / env. If a future SDK reorders those
// overloads this line fails loudly at build time rather than drifting silently.
export type SandboxOptions = NonNullable<Parameters<typeof Sandbox.create>[0]>

// Default to ISOLATED so a sandbox running customer code can't reach our private
// services (Postgres, etc.). NOTE: ISOLATED still has full *outbound* internet —
// Railway has no egress allowlist — so this isn't sufficient isolation for
// untrusted code on its own; that gap is addressed before Phase B (§7.4).
//
// authType "project-token": RAILWAY_API_TOKEN is a Railway *project* token (scoped
// to one project+environment — the tight scope we want for a sandbox runner), so
// it authenticates via the `project-access-token` header. The SDK otherwise
// defaults to "bearer" (account/team tokens), which a project token can't satisfy
// — that mismatch is what surfaces as a "Not Authorized" GraphQL error on create.
const DEFAULTS: SandboxOptions = {
  networkIsolation: "ISOLATED",
  authType: "project-token",
}

// The general execution primitive (§7.4): create an ephemeral Railway sandbox,
// run `fn` against it, then ALWAYS tear it down — even on throw. Nothing
// persists. `destroy()` is the primary reaper — we deliberately don't force a low
// idleTimeoutMinutes, since the idle timer only counts client interactions (not
// the running command), so a low value would kill a long agent run; the
// plan-default idle timeout is just the crash backstop if this process dies.
export async function withSandbox<T>(
  fn: (sandbox: Sandbox) => Promise<T>,
  options?: SandboxOptions
): Promise<T> {
  const sandbox = await Sandbox.create({ ...DEFAULTS, ...options })
  logger.info({ sandboxId: sandbox.id }, "Sandbox: created")
  try {
    return await fn(sandbox)
  } finally {
    // Always tear down so we stop being billed; log it so teardown is auditable.
    await sandbox.destroy().then(
      () => logger.info({ sandboxId: sandbox.id }, "Sandbox: destroyed"),
      (err) =>
        logger.error({ err, sandboxId: sandbox.id }, "Sandbox: destroy failed")
    )
  }
}

export type { Sandbox }
