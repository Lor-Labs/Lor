import { randomUUID } from "node:crypto"
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
}

export function baseConfig(name: string, diskMb: number) {
  return {
    name,
    // Pinned: Blaxel's default region can move, and features differ by
    // region and generation.
    region: env.BL_REGION,
    image: env.LOR_WORKBENCH_IMAGE,
    memory: env.LOR_WORKBENCH_MEMORY_MB,
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

type SandboxHealth = {
  healthy: boolean
  status: string
  exitCode: number
}

export async function probeSandbox(
  sandbox: SandboxInstance
): Promise<SandboxHealth> {
  const result = await sandbox.process.exec({
    name: `health-${randomUUID().slice(0, 8)}`,
    command: "true",
    waitForCompletion: true,
    timeout: SANDBOX_HEALTH_TIMEOUT_SEC,
  })
  return {
    healthy: result.status === "completed" && result.exitCode === 0,
    status: result.status ?? "unknown",
    exitCode: result.exitCode ?? -1,
  }
}

// Close our HTTP/2 session so the sandbox's "active connection" ends now —
// otherwise it idles in active (billed) mode for up to 15 minutes.
export function closeConnection(sandbox: SandboxInstance): void {
  try {
    sandbox.h2Session?.close()
  } catch {}
}
