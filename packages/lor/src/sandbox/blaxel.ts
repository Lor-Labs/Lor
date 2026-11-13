import { randomUUID } from "node:crypto"
import { setTimeout as sleep } from "node:timers/promises"
import type { SandboxInstance } from "@blaxel/core"
import { env } from "@repo/env/server"

// The one sandbox provider. Sandboxes are Firecracker microVMs booted from
// our custom image (packages/lor/sandbox-image, pushed via `bl push`);
// the SDK authenticates via BL_API_KEY/BL_WORKSPACE from process.env.
export function blaxelConfigured(): boolean {
  return Boolean(env.BL_API_KEY && env.BL_WORKSPACE)
}

export const WORKSPACE_MOUNT = "/workspace"
export const SANDBOX_PROCESS_ENV = {
  BUN_INSTALL_CACHE_DIR: `${WORKSPACE_MOUNT}/.cache/bun`,
  COREPACK_HOME: `${WORKSPACE_MOUNT}/.cache/corepack`,
  npm_config_cache: `${WORKSPACE_MOUNT}/.cache/npm`,
  npm_config_prefix: `${WORKSPACE_MOUNT}/.local`,
  npm_config_store_dir: `${WORKSPACE_MOUNT}/.cache/pnpm`,
  PIP_CACHE_DIR: `${WORKSPACE_MOUNT}/.cache/pip`,
  PYTHONUSERBASE: `${WORKSPACE_MOUNT}/.local`,
  TMPDIR: `${WORKSPACE_MOUNT}/tmp`,
  XDG_CACHE_HOME: `${WORKSPACE_MOUNT}/.cache`,
  XDG_DATA_HOME: `${WORKSPACE_MOUNT}/.local/share`,
  YARN_CACHE_FOLDER: `${WORKSPACE_MOUNT}/.cache/yarn`,
  // Node's fetch ignores HTTP_PROXY without this, so it would get past the
  // egress limits; its "experimental" warning would clutter tool output.
  NODE_USE_ENV_PROXY: "1",
  NODE_OPTIONS: "--disable-warning=UNDICI-EHPA",
  // Vite refuses unknown Host headers; a dev server started anywhere in the
  // sandbox (Lor, the terminal) must accept the Browser tab's preview host.
  __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: [
    ".bl.run",
    ".on.boat.dev",
    env.LOR_PREVIEW_DOMAIN,
  ]
    .filter(Boolean)
    .join(","),
}

export function baseConfig(
  name: string,
  diskMb: number,
  memoryMb: number = env.LOR_WORKBENCH_MEMORY_MB
) {
  return {
    name,
    // Pinned: Blaxel's default region can move, and features differ by
    // region and generation.
    region: env.BL_REGION,
    image: env.LOR_WORKBENCH_IMAGE,
    memory: memoryMb,
    volumes: [
      {
        name: "workspace",
        mountPath: WORKSPACE_MOUNT,
        type: "ephemeral" as const,
        sizeMb: diskMb,
      },
    ],
  }
}

export function persistentLifecycle(idleTtl: string) {
  return {
    expirationPolicies: [
      {
        action: "delete" as const,
        type: "ttl-idle" as const,
        value: idleTtl,
      },
    ],
  }
}

export function hasWorkspaceDisk(
  sandbox: SandboxInstance,
  minMb: number
): boolean {
  return Boolean(
    sandbox.spec.volumes?.some(
      (volume) =>
        volume.mountPath === WORKSPACE_MOUNT &&
        volume.type === "ephemeral" &&
        (volume.sizeMb ?? 0) >= minMb
    )
  )
}

const SANDBOX_HEALTH_TIMEOUT_SEC = 10

function statusOf(err: unknown): unknown {
  return typeof err === "object" && err !== null && "status" in err
    ? err.status
    : undefined
}

// A sandbox that is booting or waking from standby (slower for a large one):
// Blaxel answers 404 WORKLOAD_UNAVAILABLE without dispatching the request, so
// any request is safe to replay, and asks for retries with backoff for about
// a minute. Not a missing file or a deleted sandbox.
export function isWorkloadUnavailable(err: unknown): boolean {
  if (statusOf(err) !== 404 || !(err instanceof Error)) return false
  // The SDK's ResponseError keeps the parsed body in `error`; its message
  // quotes it only when the body has the shape it expects.
  const body = "error" in err ? JSON.stringify(err.error ?? "") : ""
  return `${err.message} ${body}`.includes("WORKLOAD_UNAVAILABLE")
}

// Blaxel's edge could not reach the sandbox (502/503/504): the same boot or
// wake, but the request may have been dispatched.
export function isSandboxGatewayError(err: unknown): boolean {
  return [502, 503, 504].includes(statusOf(err) as number)
}

// The sandbox never became reachable within the wait.
export class SandboxStartingError extends Error {
  constructor(cause: unknown) {
    super("The sandbox did not start in time", { cause })
    this.name = "SandboxStartingError"
  }
}

const SANDBOX_START_WAIT_MS = 90_000
const START_RETRY_MIN_MS = 500
const START_RETRY_MAX_MS = 5_000

// Runs `fn` again while the sandbox boots or wakes, instead of failing the
// turn or panel action on the first answer. `retry` says which errors mean
// that: by default only the one Blaxel never dispatched.
export async function whileSandboxStarts<T>(
  fn: () => Promise<T>,
  options: {
    retry?: (err: unknown) => boolean
    abortSignal?: AbortSignal
  } = {}
): Promise<T> {
  const retry = options.retry ?? isWorkloadUnavailable
  const deadline = Date.now() + SANDBOX_START_WAIT_MS
  let delay = START_RETRY_MIN_MS
  for (;;) {
    options.abortSignal?.throwIfAborted()
    try {
      return await fn()
    } catch (err) {
      if (!retry(err)) throw err
      if (Date.now() + delay > deadline) throw new SandboxStartingError(err)
      await sleep(delay, undefined, { signal: options.abortSignal }).catch(
        () => {}
      )
      delay = Math.min(delay * 2, START_RETRY_MAX_MS)
    }
  }
}

type SandboxHealth = {
  healthy: boolean
  status: string
  exitCode: number
}

// Waits for a sandbox that is still starting. `true` changes nothing, so a
// gateway error is replayed too (each try gets its own process name).
export async function probeSandbox(
  sandbox: SandboxInstance,
  abortSignal?: AbortSignal
): Promise<SandboxHealth> {
  const result = await whileSandboxStarts(
    () =>
      sandbox.process.exec({
        name: `health-${randomUUID().slice(0, 8)}`,
        command: "true",
        waitForCompletion: true,
        timeout: SANDBOX_HEALTH_TIMEOUT_SEC,
      }),
    {
      retry: (err) => isWorkloadUnavailable(err) || isSandboxGatewayError(err),
      ...(abortSignal ? { abortSignal } : {}),
    }
  )
  return {
    healthy: result.status === "completed" && result.exitCode === 0,
    status: result.status ?? "unknown",
    exitCode: result.exitCode ?? -1,
  }
}

// Done with this sandbox: drop our reference to its HTTP/2 session. Never
// close it. The SDK pools one session per region for every sandbox in this
// process (h2pool) and reuses it, pinging it first after 5 seconds idle;
// closing it would break other runs' requests. Same as the SDK's own
// delete(). Standby is per sandbox: it follows requests forwarded to that
// sandbox by Blaxel's edge, so the idle shared session keeps nothing billed.
export function closeConnection(sandbox: SandboxInstance): void {
  sandbox.h2Session = null
}
